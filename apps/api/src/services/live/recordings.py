"""Live lesson recordings.

Flow::

    Live lesson ──start──▶ LiveKit Egress (room composite, MP4)
                                │ writes straight to object storage (R2)
                                ▼
       content/orgs/{org}/courses/{course}/activities/{activity}/video/recording.mp4
                                │ egress_ended webhook (or reconciler)
                                ▼
        verify the object exists ─▶ create a hosted-video course lesson
                                    (TYPE_VIDEO / SUBTYPE_VIDEO_HOSTED)
                                ▼
        the existing video pipeline takes over: player, RBAC/paywall,
        HLS transcoding, AI captions, progress + course history.

The recording never touches the API's filesystem: the egress uploads it and
the lesson points at the same key a normal video upload would use, so nothing
is copied. A recording is reported "ready" only after the file is verified in
storage *and* the lesson exists.

States: pending → recording → processing → ready | failed.

Future AI (not built here): captions on the recording lesson are the
transcript; ``rag.content_extraction`` indexes transcripts into the course
knowledge base (pgvector), so "what did I miss?" questions are answered by the
existing course AI.
"""

import asyncio
import logging
import os
from datetime import datetime
from typing import Optional
from uuid import uuid4

from botocore.exceptions import BotoCoreError, ClientError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_validbridge_config
from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.live_sessions import (
    IN_FLIGHT_RECORDING_STATES,
    LiveRecording,
    LiveRecordingRead,
    LiveRecordingState,
    LiveRecordingStatus,
    LiveSession,
    utcnow,
)
from src.db.organizations import Organization
from src.services.analytics import events as analytics_events
from src.services.analytics.analytics import track
from src.services.courses.transfer.storage_utils import get_s3_bucket_name, get_storage_client, is_s3_enabled
from src.services.live import livekit
from src.services.live.attendance import as_utc
from src.services.live.config import (
    get_livekit_settings,
    recording_enabled_flag,
    recording_finalize_timeout_seconds,
    recording_layout,
)

logger = logging.getLogger(__name__)


def _log(event: str, level: int = logging.INFO, **fields) -> None:
    from src.services.live.telemetry import log_event

    log_event(f"recording.{event}", level, **fields)

RECORDING_FILENAME = "recording.mp4"
RECORDINGS_CHAPTER_NAME = "Live lesson recordings"

TOPIC_RECORDING = "vb.recording"


# ---------------------------------------------------------------------------
# Availability + storage
# ---------------------------------------------------------------------------


def recording_unavailable_reason() -> Optional[str]:
    """None when recording can start; otherwise a stable error code."""
    if get_livekit_settings() is None:
        return "LIVE_NOT_CONFIGURED"
    if not recording_enabled_flag():
        return "RECORDING_NOT_ENABLED"
    if not is_s3_enabled():
        # Recordings are large; they must go to object storage, never the
        # application filesystem.
        return "RECORDING_STORAGE_UNAVAILABLE"
    return None


def _egress_s3_config() -> dict:
    """LiveKit S3Upload for the same bucket the platform serves content from."""
    s3cfg = get_validbridge_config().hosting_config.content_delivery.s3api
    upload = {
        "bucket": get_s3_bucket_name(),
        "endpoint": s3cfg.endpoint_url or "",
        "region": os.environ.get("VALIDBRIDGE_S3_API_REGION") or "auto",
        "force_path_style": True,
    }
    access_key = os.environ.get("AWS_ACCESS_KEY_ID")
    secret = os.environ.get("AWS_SECRET_ACCESS_KEY")
    if access_key and secret:
        upload["access_key"] = access_key
        upload["secret"] = secret
    return upload


def _object_size(key: str) -> Optional[int]:
    """Size of an object in storage, or None if it isn't there (yet)."""
    client = get_storage_client()
    if client is None:
        return None
    try:
        head = client.head_object(Bucket=get_s3_bucket_name(), Key=key)
    except (ClientError, BotoCoreError):
        return None
    return int(head.get("ContentLength") or 0)


async def _org_and_course(db: AsyncSession, session: LiveSession) -> tuple[Organization, Course]:
    course = await db.get(Course, session.course_id)
    org = await db.get(Organization, session.org_id)
    return org, course


def _storage_key(org: Organization, course: Course, activity_uuid: str) -> str:
    # Exactly where upload_video() puts a hosted video, so the lesson, stream
    # route, HLS and captions pipelines find it without any copying.
    return (
        f"content/orgs/{org.org_uuid}/courses/{course.course_uuid}"
        f"/activities/{activity_uuid}/video/{RECORDING_FILENAME}"
    )


# ---------------------------------------------------------------------------
# Session-level state + room signal
# ---------------------------------------------------------------------------


async def _recordings_for(db: AsyncSession, session: LiveSession) -> list[LiveRecording]:
    return list(
        (
            await db.execute(
                select(LiveRecording)
                .where(LiveRecording.session_id == session.id)
                .order_by(LiveRecording.created_at, LiveRecording.id)
            )
        ).scalars().all()
    )


def aggregate_status(recordings: list[LiveRecording]) -> LiveRecordingStatus:
    states = {r.status for r in recordings}
    if states & {LiveRecordingState.PENDING, LiveRecordingState.RECORDING}:
        return LiveRecordingStatus.RECORDING
    if LiveRecordingState.PROCESSING in states:
        return LiveRecordingStatus.PROCESSING
    if LiveRecordingState.READY in states:
        return LiveRecordingStatus.READY
    if recordings:
        return LiveRecordingStatus.FAILED
    return LiveRecordingStatus.NONE


async def sync_session_recording_status(db: AsyncSession, session: LiveSession, source: str) -> None:
    """Derive the session's recording status from its recordings; completes a
    PROCESSING session once nothing is in flight. Also refreshes the room's
    metadata so every participant sees the REC indicator change."""
    from src.services.live.sessions import push_room_metadata, set_recording_status

    await db.refresh(session)
    target = aggregate_status(await _recordings_for(db, session))
    changed = session.recording_status != target
    await set_recording_status(db, session, target, source)
    if changed:
        await push_room_metadata(session)


def _read(recording: LiveRecording, session: LiveSession, activity: Optional[Activity]) -> LiveRecordingRead:
    ready = recording.status == LiveRecordingState.READY
    return LiveRecordingRead(
        recording_uuid=recording.recording_uuid,
        session_uuid=session.session_uuid,
        session_title=session.title,
        status=recording.status,
        started_at=as_utc(recording.started_at),
        ended_at=as_utc(recording.ended_at),
        ready_at=as_utc(recording.ready_at),
        duration_seconds=recording.duration_seconds,
        activity_uuid=recording.activity_uuid if ready and activity is not None else None,
        published=bool(activity.published) if ready and activity is not None else None,
    )


# ---------------------------------------------------------------------------
# Start / stop
# ---------------------------------------------------------------------------


class RecordingError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.message = message


async def start_recording_for(
    db: AsyncSession, session: LiveSession, *, started_by_id: Optional[int], source: str
) -> LiveRecording:
    reason = recording_unavailable_reason()
    if reason:
        raise RecordingError(409, reason, "Recording is not available on this server")
    active = [r for r in await _recordings_for(db, session) if r.status in (LiveRecordingState.PENDING, LiveRecordingState.RECORDING)]
    if active:
        raise RecordingError(409, "RECORDING_ACTIVE", "This lesson is already being recorded")

    org, course = await _org_and_course(db, session)
    activity_uuid = f"activity_{uuid4()}"
    recording = LiveRecording(
        recording_uuid=f"liverec_{uuid4()}",
        session_id=session.id,
        org_id=session.org_id,
        started_by_id=started_by_id,
        status=LiveRecordingState.PENDING,
        activity_uuid=activity_uuid,
        storage_key=_storage_key(org, course, activity_uuid),
        started_at=utcnow(),
    )
    db.add(recording)
    await db.commit()
    await db.refresh(recording)

    settings = get_livekit_settings()
    try:
        egress_id = await livekit.start_room_recording(
            settings,
            session.livekit_room_name,
            filepath=recording.storage_key,
            s3=_egress_s3_config(),
            layout=recording_layout(),
        )
    except livekit.LiveKitError as exc:
        _log(
            "start_failed",
            logging.ERROR,
            session=session.session_uuid,
            recording=recording.recording_uuid,
            source=source,
            error=str(exc),
        )
        recording.status = LiveRecordingState.FAILED
        recording.error = "egress_start_failed"
        recording.updated_at = utcnow()
        db.add(recording)
        await db.commit()
        await sync_session_recording_status(db, session, source)
        raise RecordingError(502, "RECORDING_FAILED_TO_START", "The recording could not be started") from exc

    recording.egress_id = egress_id
    recording.updated_at = utcnow()
    db.add(recording)
    await db.commit()
    await db.refresh(recording)
    await sync_session_recording_status(db, session, source)
    _log(
        "started",
        session=session.session_uuid,
        recording=recording.recording_uuid,
        egress_id=egress_id,
        started_by=started_by_id,
        source=source,
        layout=recording_layout(),
    )
    return recording


async def stop_recordings_for(db: AsyncSession, session: LiveSession, source: str) -> int:
    """Stop every active egress of the session. The file is finalized when
    LiveKit reports the egress complete. Returns how many were stopped."""
    settings = get_livekit_settings()
    stopped = 0
    for recording in await _recordings_for(db, session):
        if recording.status not in (LiveRecordingState.PENDING, LiveRecordingState.RECORDING):
            continue
        if settings is not None and recording.egress_id:
            try:
                await livekit.stop_egress(settings, recording.egress_id)
            except livekit.LiveKitError as exc:
                # Already ending on LiveKit's side (e.g. room closing) — fine.
                _log("stop_reported", recording=recording.recording_uuid, error=str(exc))
        recording.status = LiveRecordingState.PROCESSING
        recording.ended_at = recording.ended_at or utcnow()
        recording.updated_at = utcnow()
        db.add(recording)
        stopped += 1
        _log("stopped", session=session.session_uuid, recording=recording.recording_uuid, source=source)
    if stopped:
        await db.commit()
        await sync_session_recording_status(db, session, source)
    return stopped


# ---------------------------------------------------------------------------
# Egress events
# ---------------------------------------------------------------------------


def _field(obj: dict, snake: str, camel: str):
    value = obj.get(camel)
    return obj.get(snake) if value is None else value


def _file_result(egress: dict) -> dict:
    results = _field(egress, "file_results", "fileResults") or []
    if results and isinstance(results[0], dict):
        return results[0]
    single = egress.get("file")
    return single if isinstance(single, dict) else {}


def _int(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def handle_egress_update(db: AsyncSession, egress: dict) -> None:
    """Apply an egress_started/updated/ended webhook to its recording."""
    egress_id = _field(egress, "egress_id", "egressId")
    if not egress_id:
        return
    recording = (
        await db.execute(select(LiveRecording).where(LiveRecording.egress_id == egress_id))
    ).scalars().first()
    if recording is None or recording.status in (LiveRecordingState.READY, LiveRecordingState.FAILED):
        return
    session = await db.get(LiveSession, recording.session_id)
    status = str(egress.get("status") or "")
    now = utcnow()

    if status == "EGRESS_ACTIVE" and recording.status == LiveRecordingState.PENDING:
        recording.status = LiveRecordingState.RECORDING
    elif status == "EGRESS_ENDING":
        recording.status = LiveRecordingState.PROCESSING
        recording.ended_at = recording.ended_at or now
    elif status in ("EGRESS_COMPLETE", "EGRESS_LIMIT_REACHED"):
        result = _file_result(egress)
        duration_ns = _int(result.get("duration"))
        if duration_ns:
            recording.duration_seconds = max(1, duration_ns // 1_000_000_000)
        size = _int(result.get("size"))
        if size:
            recording.file_size = size
        recording.status = LiveRecordingState.PROCESSING
        recording.ended_at = recording.ended_at or now
    elif status in ("EGRESS_FAILED", "EGRESS_ABORTED"):
        recording.status = LiveRecordingState.FAILED
        recording.error = "egress_failed" if status == "EGRESS_FAILED" else "egress_aborted"
        recording.ended_at = recording.ended_at or now
    else:
        return

    recording.updated_at = now
    db.add(recording)
    await db.commit()
    await db.refresh(recording)
    _log(
        "egress_update",
        logging.WARNING if recording.status == LiveRecordingState.FAILED else logging.INFO,
        recording=recording.recording_uuid,
        egress_id=egress_id,
        egress_status=status,
        state=recording.status,
        error=recording.error,
        duration_seconds=recording.duration_seconds,
        file_size=recording.file_size,
    )

    if status in ("EGRESS_COMPLETE", "EGRESS_LIMIT_REACHED"):
        await finalize_recording(db, recording)
    elif session is not None:
        await sync_session_recording_status(db, session, "webhook")


# ---------------------------------------------------------------------------
# Finalize: verified file → course lesson
# ---------------------------------------------------------------------------


async def _recording_chapter(db: AsyncSession, session: LiveSession, course: Course) -> Chapter:
    """Where the lesson goes: next to the session's linked activity, else the
    course's last chapter, else a dedicated "Live lesson recordings" chapter."""
    if session.activity_id:
        link = (
            await db.execute(select(ChapterActivity).where(ChapterActivity.activity_id == session.activity_id))
        ).scalars().first()
        if link:
            chapter = await db.get(Chapter, link.chapter_id)
            if chapter:
                return chapter

    last = (
        await db.execute(
            select(Chapter)
            .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)
            .where(CourseChapter.course_id == course.id)
            .order_by(CourseChapter.order.desc(), CourseChapter.id.desc())
        )
    ).scalars().first()
    if last:
        return last

    now = str(datetime.now())
    chapter = Chapter(
        name=RECORDINGS_CHAPTER_NAME,
        description="",
        org_id=course.org_id,
        course_id=course.id,
        chapter_uuid=f"chapter_{uuid4()}",
        creation_date=now,
        update_date=now,
    )
    db.add(chapter)
    await db.commit()
    await db.refresh(chapter)
    db.add(CourseChapter(chapter_id=chapter.id, course_id=course.id, org_id=course.org_id, order=1, creation_date=now, update_date=now))
    await db.commit()
    return chapter


def recording_lesson_name(session: LiveSession, recording: LiveRecording) -> str:
    when = as_utc(recording.started_at or session.started_at or session.scheduled_at)
    return f"Recording: {session.title} ({when:%d %b %Y})"[:255]


async def _ensure_lesson(db: AsyncSession, session: LiveSession, course: Course, recording: LiveRecording) -> Activity:
    existing = (
        await db.execute(select(Activity).where(Activity.activity_uuid == recording.activity_uuid))
    ).scalars().first()
    if existing is not None:
        return existing

    chapter = await _recording_chapter(db, session, course)
    now = str(datetime.now())
    activity = Activity(
        name=recording_lesson_name(session, recording),
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        activity_uuid=recording.activity_uuid,
        org_id=course.org_id,
        course_id=course.id,
        content={"filename": RECORDING_FILENAME, "activity_uuid": recording.activity_uuid},
        details={},
        published=bool(session.publish_recordings),
        creation_date=now,
        update_date=now,
        last_modified_by_id=recording.started_by_id,
        # Provenance for the course history and, later, the AI knowledge base.
        extra_metadata={
            "live_recording": {
                "session_uuid": session.session_uuid,
                "recording_uuid": recording.recording_uuid,
                "session_title": session.title,
                "recorded_at": as_utc(recording.started_at).isoformat() if recording.started_at else None,
                "duration_seconds": recording.duration_seconds,
            }
        },
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    last = (
        await db.execute(
            select(ChapterActivity)
            .where(ChapterActivity.chapter_id == chapter.id)
            .order_by(ChapterActivity.order.desc())
        )
    ).scalars().first()
    db.add(
        ChapterActivity(
            chapter_id=chapter.id,
            activity_id=activity.id,
            course_id=course.id,
            org_id=course.org_id,
            order=(last.order if last else 0) + 1,
            creation_date=now,
            update_date=now,
        )
    )
    await db.commit()
    return activity


async def finalize_recording(db: AsyncSession, recording: LiveRecording) -> bool:
    """PROCESSING → READY once the file is in storage and the lesson exists.

    Safe to call repeatedly (webhook, reconciler). Gives up with FAILED if the
    file never shows up within the finalize timeout.
    """
    if recording.status != LiveRecordingState.PROCESSING:
        return recording.status == LiveRecordingState.READY
    session = await db.get(LiveSession, recording.session_id)
    if session is None:
        return False

    recording.finalize_attempts += 1
    size = await asyncio.to_thread(_object_size, recording.storage_key)
    if size is None:
        ended = as_utc(recording.ended_at) or as_utc(recording.updated_at)
        overdue = ended is not None and (utcnow() - ended).total_seconds() > recording_finalize_timeout_seconds()
        if overdue:
            recording.status = LiveRecordingState.FAILED
            recording.error = "storage_missing"
        recording.updated_at = utcnow()
        db.add(recording)
        await db.commit()
        if overdue:
            _log("failed", logging.ERROR, recording=recording.recording_uuid, reason="file_never_reached_storage")
            await sync_session_recording_status(db, session, "reconcile")
        return False

    org, course = await _org_and_course(db, session)
    if course is None:
        return False
    activity = await _ensure_lesson(db, session, course, recording)

    recording.status = LiveRecordingState.READY
    recording.activity_id = activity.id
    recording.file_size = size or recording.file_size
    recording.ready_at = utcnow()
    recording.error = None
    recording.updated_at = utcnow()
    db.add(recording)
    await db.commit()
    await db.refresh(recording)

    # The existing video pipeline: adaptive streaming for the recording.
    try:
        from src.services.utils.hls_jobs import enqueue as enqueue_hls

        enqueue_hls(activity.activity_uuid)
    except Exception:
        logger.exception("Live recording %s: HLS enqueue failed", recording.recording_uuid)

    try:
        await track(
            analytics_events.LIVE_RECORDING_READY,
            org_id=session.org_id,
            user_id=recording.started_by_id or 0,
            properties={
                "session_uuid": session.session_uuid,
                "recording_uuid": recording.recording_uuid,
                "activity_uuid": activity.activity_uuid,
                "course_uuid": course.course_uuid,
                "duration_seconds": recording.duration_seconds,
                "file_size": recording.file_size,
                "published": bool(activity.published),
            },
        )
    except Exception:  # pragma: no cover - analytics never blocks
        logger.warning("live_recording_ready analytics failed", exc_info=True)

    await sync_session_recording_status(db, session, "webhook")
    _log(
        "ready",
        recording=recording.recording_uuid,
        activity=activity.activity_uuid,
        duration_seconds=recording.duration_seconds,
        file_size=recording.file_size,
    )
    return True


async def reconcile_recordings(db: AsyncSession, now: Optional[datetime] = None) -> None:
    """Finish what webhooks missed: finalize processing recordings, and fail
    recordings whose egress went silent after the lesson ended."""
    from src.db.live_sessions import ACTIVE_STATUSES

    now = now or utcnow()
    in_flight = (
        await db.execute(select(LiveRecording).where(LiveRecording.status.in_(list(IN_FLIGHT_RECORDING_STATES))))
    ).scalars().all()
    for recording in in_flight:
        try:
            if recording.status == LiveRecordingState.PROCESSING:
                await finalize_recording(db, recording)
                continue
            session = await db.get(LiveSession, recording.session_id)
            if session is None or session.status in ACTIVE_STATUSES:
                continue
            # The lesson is over but we never heard the egress finish: treat
            # it as done and let finalize look for the file.
            quiet_for = (now - (as_utc(recording.updated_at) or now)).total_seconds()
            if quiet_for > 600:
                recording.status = LiveRecordingState.PROCESSING
                recording.ended_at = recording.ended_at or now
                recording.updated_at = now
                db.add(recording)
                await db.commit()
                await finalize_recording(db, recording)
        except Exception:
            logger.exception("Live recording %s: reconcile failed", recording.recording_uuid)
            await db.rollback()


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def recordings_for_sessions(
    db: AsyncSession, sessions: list[LiveSession], *, staff: bool
) -> list[LiveRecordingRead]:
    """Recordings of these sessions as the caller may see them: staff see every
    state; learners only ready recordings whose lesson is published."""
    if not sessions:
        return []
    by_id = {s.id: s for s in sessions}
    rows = (
        await db.execute(
            select(LiveRecording, Activity)
            .outerjoin(Activity, Activity.id == LiveRecording.activity_id)
            .where(LiveRecording.session_id.in_(list(by_id)))
            .order_by(LiveRecording.created_at.desc(), LiveRecording.id.desc())
        )
    ).all()
    out = []
    for recording, activity in rows:
        if not staff and not (
            recording.status == LiveRecordingState.READY and activity is not None and activity.published
        ):
            continue
        out.append(_read(recording, by_id[recording.session_id], activity))
    return out


# ---------------------------------------------------------------------------
# Request-level API (authorization reused from the classroom and course RBAC)
# ---------------------------------------------------------------------------


def _http_error(exc: RecordingError):
    from src.services.live.sessions import _error

    return _error(exc.status_code, exc.code, exc.message)


async def start_recording(request, db: AsyncSession, user, session_uuid: str) -> LiveRecordingRead:
    from src.services.live.classroom import _context, _require_staff

    ctx = await _context(request, db, user, session_uuid, interactive=True)
    _require_staff(ctx)
    try:
        recording = await start_recording_for(db, ctx.session, started_by_id=ctx.user.id, source="api")
    except RecordingError as exc:
        raise _http_error(exc) from exc
    return _read(recording, ctx.session, None)


async def stop_recording(request, db: AsyncSession, user, session_uuid: str) -> int:
    from src.services.live.classroom import _context, _require_staff

    ctx = await _context(request, db, user, session_uuid)
    _require_staff(ctx)
    return await stop_recordings_for(db, ctx.session, "api")


async def list_session_recordings(request, db: AsyncSession, user, session_uuid: str) -> list[LiveRecordingRead]:
    from src.services.live.classroom import _context

    ctx = await _context(request, db, user, session_uuid)
    return await recordings_for_sessions(db, [ctx.session], staff=ctx.is_staff)


async def list_course_recordings(request, db: AsyncSession, user, course_uuid: str) -> list[LiveRecordingRead]:
    """Recordings for a course page. Anyone who can read the course sees ready,
    published recordings (the lesson itself enforces paywall/locks when
    opened); course staff also see pending/processing/failed ones."""
    from fastapi import HTTPException

    from src.security.rbac import AccessAction, check_resource_access
    from src.services.live.sessions import _require_user, has_staff_access

    user = _require_user(user)
    course = (await db.execute(select(Course).where(Course.course_uuid == course_uuid))).scalars().first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    await check_resource_access(request, db, user, course.course_uuid, AccessAction.READ)
    staff = await has_staff_access(request, db, user, course)
    sessions = list((await db.execute(select(LiveSession).where(LiveSession.course_id == course.id))).scalars().all())
    return await recordings_for_sessions(db, sessions, staff=staff)
