"""Live session lifecycle, access resolution and join tokens.

Lifecycle::

    SCHEDULED --start--> READY --staff connects--> LIVE --end--> ENDED --> PROCESSING --> COMPLETED
                                                                   \\______(no recording)______/

READY → LIVE is driven by LiveKit (webhook or reconciler seeing an instructor or
moderator connected), never by a client claim. Every status change goes through
``_transition``, a conditional UPDATE, so the API, webhooks and the reconciler
can race without two of them both "winning" a transition.

Roles are derived server-side on every request:

* INSTRUCTOR — the session's instructor, while they still have write access to
  the course;
* MODERATOR — anyone else with write access to the course (authors, org
  admins/maintainers);
* LEARNER — course read access (paywall, usergroup and activity locks included)
  AND a course enrollment.
"""

import logging
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import uuid4

from fastapi import HTTPException, Request, status as http_status
from sqlalchemy import update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.live_sessions import (
    ACTIVE_STATUSES,
    STAFF_ROLES,
    LiveAbsentRead,
    LiveAttendanceRead,
    LiveAttendanceSummary,
    LiveClassroomRead,
    LiveJoinResponse,
    LiveParticipantRead,
    LiveParticipantRole,
    LiveRecordingStatus,
    LiveSession,
    LiveSessionCreate,
    LiveSessionEvent,
    LiveSessionEventType,
    LiveSessionParticipant,
    LiveSessionRead,
    LiveSessionStatus,
    utcnow,
)
from src.db.trail_runs import TrailRun
from src.db.users import PublicUser, User
from src.security.rbac import AccessAction, check_resource_access
from src.services.live import livekit
from src.services.live.attendance import as_utc, recompute_session
from src.services.live.telemetry import log_event
from src.services.live.config import (
    LiveKitSettings,
    get_livekit_settings,
    room_empty_timeout_seconds,
    room_max_participants,
    token_ttl_seconds,
)

logger = logging.getLogger(__name__)

ROOM_PREFIX = "vb-live-"
_ABSENT_LIST_LIMIT = 500

STAFF_SOURCES = ["camera", "microphone", "screen_share", "screen_share_audio"]
LEARNER_SOURCES = ["camera", "microphone"]


# ---------------------------------------------------------------------------
# Lookups and helpers
# ---------------------------------------------------------------------------


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def require_livekit() -> LiveKitSettings:
    settings = get_livekit_settings()
    if settings is None:
        raise _error(503, "LIVE_NOT_CONFIGURED", "Live classrooms are not configured on this server")
    return settings


def _require_user(user) -> PublicUser:
    if not isinstance(user, PublicUser) or not user.id:
        raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return user


async def get_session_by_uuid(db: AsyncSession, session_uuid: str) -> LiveSession:
    session = (
        await db.execute(select(LiveSession).where(LiveSession.session_uuid == session_uuid))
    ).scalars().first()
    if session is None:
        raise HTTPException(status_code=404, detail="Live session not found")
    return session


async def get_session_by_room(db: AsyncSession, room_name: str) -> Optional[LiveSession]:
    if not room_name or not room_name.startswith(ROOM_PREFIX):
        return None
    return (
        await db.execute(select(LiveSession).where(LiveSession.livekit_room_name == room_name))
    ).scalars().first()


async def _get_course(db: AsyncSession, course_id: int) -> Course:
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def to_read(session: LiveSession) -> LiveSessionRead:
    return LiveSessionRead(
        id=session.id,
        session_uuid=session.session_uuid,
        org_id=session.org_id,
        course_id=session.course_id,
        activity_id=session.activity_id,
        instructor_id=session.instructor_id,
        title=session.title,
        description=session.description,
        status=session.status,
        recording_status=session.recording_status,
        record_automatically=bool(session.record_automatically),
        publish_recordings=bool(session.publish_recordings),
        scheduled_at=as_utc(session.scheduled_at),
        ready_at=as_utc(session.ready_at),
        started_at=as_utc(session.started_at),
        ended_at=as_utc(session.ended_at),
        created_at=as_utc(session.created_at),
        updated_at=as_utc(session.updated_at),
    )


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


async def has_staff_access(request: Request, db: AsyncSession, user: PublicUser, course: Course) -> bool:
    decision = await check_resource_access(
        request, db, user, course.course_uuid, AccessAction.UPDATE, raise_on_deny=False
    )
    return decision.allowed


async def _require_staff(request: Request, db: AsyncSession, user: PublicUser, course: Course) -> None:
    if not await has_staff_access(request, db, user, course):
        raise _error(403, "LIVE_STAFF_REQUIRED", "Only course instructors can manage live sessions")


async def is_enrolled(db: AsyncSession, user_id: int, course_id: int) -> bool:
    run = (
        await db.execute(
            select(TrailRun.id).where(TrailRun.user_id == user_id, TrailRun.course_id == course_id)
        )
    ).scalars().first()
    return run is not None


async def _require_learner_access(
    request: Request, db: AsyncSession, user: PublicUser, session: LiveSession, course: Course
) -> None:
    """Course read access (+ activity locks/paywall when linked) and enrollment."""
    activity = await db.get(Activity, session.activity_id) if session.activity_id else None
    if activity is not None:
        # Reuse the activity read path: course RBAC (402 paywall included),
        # paid-content gate and chapter/activity lock_type.
        from src.services.courses.activities.activities import get_activity

        activity_read = await get_activity(request, activity.activity_uuid, user, db)
        if activity_read.is_locked:
            raise _error(403, "ACTIVITY_LOCKED", "You do not have access to this lesson")
        if activity_read.content == {"paid_access": False}:
            raise _error(402, "PAYMENT_REQUIRED", "This lesson requires a purchase")
    else:
        await check_resource_access(request, db, user, course.course_uuid, AccessAction.READ)

    if not await is_enrolled(db, user.id, course.id):
        raise _error(403, "ENROLLMENT_REQUIRED", "Enroll in this course to join its live sessions")


async def resolve_role(
    request: Request, db: AsyncSession, user: PublicUser, session: LiveSession, course: Course
) -> LiveParticipantRole:
    """The caller's role in this session, or raise if they may not join it."""
    if await has_staff_access(request, db, user, course):
        if session.instructor_id == user.id:
            return LiveParticipantRole.INSTRUCTOR
        return LiveParticipantRole.MODERATOR
    await _require_learner_access(request, db, user, session, course)
    return LiveParticipantRole.LEARNER


async def get_participant_row(
    db: AsyncSession, session_id: int, user_id: int
) -> Optional[LiveSessionParticipant]:
    return (
        await db.execute(
            select(LiveSessionParticipant).where(
                LiveSessionParticipant.session_id == session_id,
                LiveSessionParticipant.user_id == user_id,
            )
        )
    ).scalars().first()


def require_not_removed(participant: Optional[LiveSessionParticipant]) -> None:
    if participant is not None and participant.removed_at is not None:
        raise _error(403, "REMOVED_FROM_SESSION", "You were removed from this live session")


def publish_sources(role: LiveParticipantRole, media_allowed: bool) -> list[str]:
    if role in STAFF_ROLES:
        return STAFF_SOURCES
    return LEARNER_SOURCES if media_allowed else []


async def get_classroom(
    request: Request, db: AsyncSession, user, session_uuid: str
) -> LiveClassroomRead:
    """Everything the classroom needs before connecting: the session, the
    caller's role (raises if they may not take part) and moderation state."""
    user = _require_user(user)
    session = await get_session_by_uuid(db, session_uuid)
    course = await _get_course(db, session.course_id)
    role = await resolve_role(request, db, user, session, course)
    participant = await get_participant_row(db, session.id, user.id)
    require_not_removed(participant)
    from src.services.live.recordings import recording_unavailable_reason

    return LiveClassroomRead(
        session=to_read(session),
        course_uuid=course.course_uuid,
        course_name=course.name,
        role=role,
        user_uuid=user.user_uuid,
        media_allowed=participant.media_allowed if participant is not None else True,
        recording_available=role in STAFF_ROLES and recording_unavailable_reason() is None,
    )


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------


async def _transition(
    db: AsyncSession,
    session: LiveSession,
    from_statuses: Iterable[LiveSessionStatus],
    to_status: LiveSessionStatus,
    source: str,
    **values,
) -> bool:
    """Atomically move ``session`` to ``to_status`` if it is in ``from_statuses``.

    Returns False when another actor already moved it. Commits and refreshes.
    """
    previous = session.status
    now = utcnow()
    result = await db.execute(
        update(LiveSession)
        .where(LiveSession.id == session.id, LiveSession.status.in_(list(from_statuses)))
        .values(status=to_status, updated_at=now, **values)
    )
    if result.rowcount == 0:
        # Nothing changed. Commit (not rollback): a rollback expires every
        # loaded instance, and callers still holding one would then trigger
        # lazy loads, which async sessions cannot do.
        await db.commit()
        await db.refresh(session)
        return False
    db.add(
        LiveSessionEvent(
            session_id=session.id,
            org_id=session.org_id,
            event_type=LiveSessionEventType.STATUS_CHANGED,
            source=source,
            occurred_at=now,
            data={"from": previous.value if previous else None, "to": to_status.value},
        )
    )
    await db.commit()
    await db.refresh(session)
    log_event(
        "session.status_changed",
        session=session.session_uuid,
        from_status=previous,
        to_status=to_status,
        source=source,
    )
    if to_status in (LiveSessionStatus.ENDED, LiveSessionStatus.PROCESSING, LiveSessionStatus.COMPLETED):
        log_event(
            "session.terminated" if to_status == LiveSessionStatus.ENDED else "session.finalized",
            session=session.session_uuid,
            status=to_status,
            source=source,
            recording_status=session.recording_status,
        )
    return True


async def mark_live(db: AsyncSession, session: LiveSession, at: datetime, source: str) -> bool:
    went_live = await _transition(
        db, session, (LiveSessionStatus.READY,), LiveSessionStatus.LIVE, source, started_at=at
    )
    if went_live:
        from src.services.live.reporting import track_session_started

        await track_session_started(session)
        if session.record_automatically:
            from src.services.live.recordings import RecordingError, recording_unavailable_reason, start_recording_for

            if recording_unavailable_reason() is None:
                try:
                    await start_recording_for(db, session, started_by_id=session.instructor_id, source=source)
                except RecordingError as exc:
                    log_event(
                        "recording.auto_start_failed",
                        logging.WARNING,
                        session=session.session_uuid,
                        code=exc.code,
                    )
    return went_live


async def finalize_session(db: AsyncSession, session: LiveSession, source: str) -> bool:
    """ENDED → PROCESSING/COMPLETED: close attendance, tear the room down.

    Attendance is closed first so it is correct even while LiveKit is
    unreachable; the session stays ENDED (and the reconciler retries) until
    the room is confirmed gone, so nobody lingers in a "finished" room.
    """
    await db.refresh(session)
    if session.status != LiveSessionStatus.ENDED:
        return False

    await recompute_session(db, session)

    # Stop recording before the room goes away; the file is finalized when
    # LiveKit reports the egress complete (session waits in PROCESSING).
    from src.services.live.recordings import stop_recordings_for

    await stop_recordings_for(db, session, source)
    await db.refresh(session)

    settings = get_livekit_settings()
    if settings is not None:
        try:
            await livekit.delete_room(settings, session.livekit_room_name)
        except livekit.LiveKitError as exc:
            log_event(
                "livekit.room_teardown_deferred",
                logging.WARNING,
                session=session.session_uuid,
                room=session.livekit_room_name,
                error=str(exc),
            )
            return False

    await db.refresh(session)
    if session.recording_status in (LiveRecordingStatus.RECORDING, LiveRecordingStatus.PROCESSING):
        target = LiveSessionStatus.PROCESSING
    else:
        target = LiveSessionStatus.COMPLETED
    finalized = await _transition(db, session, (LiveSessionStatus.ENDED,), target, source)
    if finalized:
        # Exactly once per lesson (the transition is conditional): close any
        # open poll/quiz so their results are final, then emit analytics.
        from src.services.live.classroom import close_open_interactions
        from src.services.live.reporting import emit_session_finished

        await close_open_interactions(db, session, source)
        await emit_session_finished(db, session)
        try:
            await record_live_usage(db, session)
        except Exception:
            log_event("billing.live_usage_failed", logging.WARNING, session=session.session_uuid)
    return finalized


# ---------------------------------------------------------------------------
# Live-hour metering (pricing-implementation.md W4c)
# ---------------------------------------------------------------------------


def _metered() -> bool:
    from src.core.deployment_mode import get_deployment_mode

    return get_deployment_mode() == "saas"


async def check_live_allowance(db: AsyncSession, session: LiveSession) -> None:
    """Refuse to open a new classroom past the plan's live limits.

    Runs when an instructor starts a session. Never runs for a class already
    open (``start_session`` returns before this for active sessions, and the
    READY → LIVE step driven by LiveKit is never refused), so a class in
    progress is never cut off. Outside SaaS mode, or for exempt orgs, the
    entitlement checks allow everything.

    LiveBridge Unlimited is simplified to "the org holds it": any instructor
    of an org with the add-on skips the hours check, rather than matching the
    add-on's instructor count to specific instructors.
    """
    if not _metered():
        return
    from sqlalchemy import func

    from src.security.features_utils.entitlements import (
        METRIC_LIVE_CONCURRENCY,
        METRIC_LIVE_SECONDS,
        check,
        get_entitlements,
    )

    open_now = (
        await db.execute(
            select(func.count()).where(
                LiveSession.org_id == session.org_id,
                LiveSession.status.in_(list(ACTIVE_STATUSES)),
                LiveSession.id != session.id,
            )
        )
    ).scalar_one()
    (await check(session.org_id, METRIC_LIVE_CONCURRENCY, 1, db, used=int(open_now))).raise_if_blocked()

    ent = await get_entitlements(session.org_id, db)
    if ent.live_unlimited_instructors > 0:
        return
    # A minute is enough to ask "is there any time left this month?".
    (await check(session.org_id, METRIC_LIVE_SECONDS, 60, db)).raise_if_blocked()


async def record_live_usage(db: AsyncSession, session: LiveSession) -> int:
    """Count a finished class against the month's live hours. Called once per
    session (from the conditional ENDED → PROCESSING/COMPLETED transition).

    Time past the plan allowance is taken from purchased hour packs first.
    ``entitlements`` measures the limit as allowance + packs left, so the
    counter records only what packs did not cover — recording pack-paid time
    as well would count it twice. Returns the seconds recorded.
    """
    if not _metered():
        return 0
    started, ended = as_utc(session.started_at), as_utc(session.ended_at)
    if started is None or ended is None:
        return 0  # never went live
    seconds = int((ended - started).total_seconds())
    if seconds <= 0:
        return 0

    from src.db.billing import PackBalance
    from src.db.billing._common import current_period
    from src.security.features_utils.entitlements import (
        METRIC_LIVE_SECONDS,
        get_entitlements,
        get_usage,
        invalidate_entitlements,
        record_usage,
    )

    period = current_period(ended)
    ent = await get_entitlements(session.org_id, db, use_cache=False)
    drawn = 0
    if not ent.exempt and ent.live_unlimited_instructors == 0 and ent.live_seconds_month is not None:
        used_before = await get_usage(session.org_id, METRIC_LIVE_SECONDS, db, period=period)
        overflow = min(seconds, max(0, used_before + seconds - int(ent.live_seconds_month)))
        if overflow > 0:
            pack = (
                await db.execute(
                    select(PackBalance)
                    .where(PackBalance.org_id == session.org_id, PackBalance.kind == "live_seconds")
                    .with_for_update()
                )
            ).scalars().first()
            if pack is not None and int(pack.remaining or 0) > 0:
                drawn = min(overflow, int(pack.remaining))
                pack.remaining = int(pack.remaining) - drawn
                pack.updated_at = utcnow()
                db.add(pack)

    recorded = seconds - drawn
    await record_usage(session.org_id, METRIC_LIVE_SECONDS, recorded, db, period=period, commit=False)
    await db.commit()
    invalidate_entitlements(session.org_id)
    log_event(
        "billing.live_usage_recorded",
        session=session.session_uuid,
        seconds=seconds,
        from_packs=drawn,
    )
    return recorded


async def end_and_finalize(
    db: AsyncSession, session: LiveSession, source: str, ended_at: Optional[datetime] = None
) -> None:
    await _transition(
        db,
        session,
        ACTIVE_STATUSES,
        LiveSessionStatus.ENDED,
        source,
        ended_at=as_utc(ended_at) or utcnow(),
    )
    await finalize_session(db, session, source)


async def set_recording_status(
    db: AsyncSession, session: LiveSession, recording_status: LiveRecordingStatus, source: str
) -> None:
    if session.recording_status == recording_status:
        return
    previous = session.recording_status
    session.recording_status = recording_status
    session.updated_at = utcnow()
    db.add(session)
    db.add(
        LiveSessionEvent(
            session_id=session.id,
            org_id=session.org_id,
            event_type=LiveSessionEventType.RECORDING_STATUS_CHANGED,
            source=source,
            data={"from": previous.value, "to": recording_status.value},
        )
    )
    await db.commit()
    await db.refresh(session)
    if recording_status in (LiveRecordingStatus.READY, LiveRecordingStatus.FAILED):
        await _transition(
            db, session, (LiveSessionStatus.PROCESSING,), LiveSessionStatus.COMPLETED, source
        )


# ---------------------------------------------------------------------------
# Service API
# ---------------------------------------------------------------------------


async def create_session(
    request: Request, db: AsyncSession, user, payload: LiveSessionCreate
) -> LiveSessionRead:
    user = _require_user(user)
    course = (
        await db.execute(select(Course).where(Course.course_uuid == payload.course_uuid))
    ).scalars().first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    await _require_staff(request, db, user, course)

    activity_id = None
    if payload.activity_uuid:
        activity = (
            await db.execute(select(Activity).where(Activity.activity_uuid == payload.activity_uuid))
        ).scalars().first()
        if activity is None or activity.course_id != course.id:
            raise HTTPException(status_code=404, detail="Activity not found in this course")
        activity_id = activity.id

    session = LiveSession(
        session_uuid=f"livesession_{uuid4()}",
        org_id=course.org_id,
        course_id=course.id,
        activity_id=activity_id,
        instructor_id=user.id,
        title=payload.title.strip(),
        description=payload.description,
        scheduled_at=as_utc(payload.scheduled_at),
        livekit_room_name=f"{ROOM_PREFIX}{uuid4().hex}",
        record_automatically=payload.record_automatically,
        publish_recordings=payload.publish_recordings,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    log_event(
        "session.created",
        session=session.session_uuid,
        course=course.course_uuid,
        org_id=course.org_id,
        instructor_id=user.id,
        scheduled_at=session.scheduled_at.isoformat() if session.scheduled_at else None,
        record_automatically=session.record_automatically,
    )
    return to_read(session)


async def list_course_sessions(
    request: Request, db: AsyncSession, user, course_uuid: str
) -> list[LiveSessionRead]:
    user = _require_user(user)
    course = (
        await db.execute(select(Course).where(Course.course_uuid == course_uuid))
    ).scalars().first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    await check_resource_access(request, db, user, course.course_uuid, AccessAction.READ)
    sessions = (
        await db.execute(
            select(LiveSession)
            .where(LiveSession.course_id == course.id)
            .order_by(LiveSession.scheduled_at, LiveSession.id)
        )
    ).scalars().all()
    return [to_read(s) for s in sessions]


async def get_session(request: Request, db: AsyncSession, user, session_uuid: str) -> LiveSessionRead:
    user = _require_user(user)
    session = await get_session_by_uuid(db, session_uuid)
    course = await _get_course(db, session.course_id)
    await check_resource_access(request, db, user, course.course_uuid, AccessAction.READ)
    return to_read(session)


def room_metadata(session: LiveSession) -> dict:
    """What every participant (late joiners included) reads from the room."""
    return {
        "session_uuid": session.session_uuid,
        "focus": session.stage_focus or "presentation",
        "recording": session.recording_status == LiveRecordingStatus.RECORDING,
    }


async def push_room_metadata(session: LiveSession) -> bool:
    """Best effort: returns False if LiveKit is unreachable or the room is gone."""
    settings = get_livekit_settings()
    if settings is None:
        return False
    try:
        return await livekit.update_room_metadata(settings, session.livekit_room_name, room_metadata(session))
    except livekit.LiveKitError as exc:
        log_event("livekit.metadata_update_failed", logging.WARNING, session=session.session_uuid, error=str(exc))
        return False


async def ensure_room(settings: LiveKitSettings, session: LiveSession) -> None:
    try:
        await livekit.create_room(
            settings,
            session.livekit_room_name,
            empty_timeout=room_empty_timeout_seconds(),
            max_participants=room_max_participants(),
            metadata=room_metadata(session),
        )
    except livekit.LiveKitError as exc:
        log_event(
            "livekit.room_provision_failed",
            logging.ERROR,
            session=session.session_uuid,
            room=session.livekit_room_name,
            error=str(exc),
        )
        raise _error(502, "LIVE_SERVER_UNAVAILABLE", "The live classroom server is unavailable") from exc


async def start_session(request: Request, db: AsyncSession, user, session_uuid: str) -> LiveSessionRead:
    user = _require_user(user)
    session = await get_session_by_uuid(db, session_uuid)
    course = await _get_course(db, session.course_id)
    await _require_staff(request, db, user, course)

    if session.status in ACTIVE_STATUSES:
        return to_read(session)  # idempotent
    if session.status != LiveSessionStatus.SCHEDULED:
        raise _error(409, "SESSION_ENDED", "This live session has already ended")

    # Plan limits apply to opening a new classroom, never to one in progress.
    await check_live_allowance(db, session)

    settings = require_livekit()
    await ensure_room(settings, session)
    await _transition(
        db,
        session,
        (LiveSessionStatus.SCHEDULED,),
        LiveSessionStatus.READY,
        "api",
        ready_at=utcnow(),
    )
    return to_read(session)


async def join_session(request: Request, db: AsyncSession, user, session_uuid: str) -> LiveJoinResponse:
    """Issue a LiveKit token for the *calling* user only.

    Every outcome is logged: ``live.join.authorized`` / ``live.token.issued``
    on success, ``live.join.denied`` with the machine code on refusal. The
    token itself is never logged.
    """
    try:
        return await _join_session(request, db, user, session_uuid)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        log_event(
            "join.denied",
            logging.WARNING if exc.status_code in (401, 403) else logging.INFO,
            session=session_uuid,
            user_id=getattr(user, "id", None),
            http_status=exc.status_code,
            code=detail.get("code") or str(exc.detail)[:80],
        )
        raise


async def _join_session(request: Request, db: AsyncSession, user, session_uuid: str) -> LiveJoinResponse:
    user = _require_user(user)
    session = await get_session_by_uuid(db, session_uuid)
    course = await _get_course(db, session.course_id)
    # Authorization before status, so unauthorised callers learn nothing about
    # the session's state.
    role = await resolve_role(request, db, user, session, course)
    is_staff = role in STAFF_ROLES
    participant = await get_participant_row(db, session.id, user.id)
    require_not_removed(participant)
    media_allowed = participant.media_allowed if participant is not None else True

    if session.status == LiveSessionStatus.SCHEDULED:
        raise _error(409, "SESSION_NOT_STARTED", "This live session has not started yet")
    if session.status not in ACTIVE_STATUSES:
        raise _error(409, "SESSION_ENDED", "This live session has ended")
    if not is_staff and session.status != LiveSessionStatus.LIVE:
        raise _error(409, "SESSION_NOT_LIVE", "Waiting for the instructor to start the session")

    settings = require_livekit()
    if is_staff:
        # Staff may be first in; make sure the room survived (LiveKit restart,
        # empty-room timeout before anyone arrived).
        await ensure_room(settings, session)

    if not user.user_uuid:
        raise HTTPException(status_code=400, detail="User has no identity")
    display_name = f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username
    token, exp = livekit.create_participant_token(
        settings,
        identity=user.user_uuid,
        name=display_name,
        room=session.livekit_room_name,
        metadata={"role": role.value, "session_uuid": session.session_uuid},
        ttl_seconds=token_ttl_seconds(),
        can_publish_sources=publish_sources(role, media_allowed),
        can_publish_data=is_staff,
    )
    log_event(
        "join.authorized",
        session=session.session_uuid,
        user_id=user.id,
        role=role,
        status=session.status,
    )
    log_event(
        "token.issued",
        session=session.session_uuid,
        user_id=user.id,
        identity=user.user_uuid,
        room=session.livekit_room_name,
        role=role,
        ttl_seconds=token_ttl_seconds(),
        can_publish=",".join(publish_sources(role, media_allowed)) or "none",
        can_publish_data=is_staff,
    )
    return LiveJoinResponse(
        server_url=settings.url,
        token=token,
        expires_at=datetime.fromtimestamp(exp, tz=timezone.utc),
        role=role,
    )


async def end_session(request: Request, db: AsyncSession, user, session_uuid: str) -> LiveSessionRead:
    user = _require_user(user)
    session = await get_session_by_uuid(db, session_uuid)
    course = await _get_course(db, session.course_id)
    await _require_staff(request, db, user, course)

    if session.status == LiveSessionStatus.SCHEDULED:
        raise _error(409, "SESSION_NOT_STARTED", "This live session has not started")
    if session.status in ACTIVE_STATUSES:
        await end_and_finalize(db, session, "api")
    return to_read(session)


async def get_attendance(
    request: Request, db: AsyncSession, user, session_uuid: str
) -> LiveAttendanceRead:
    from src.services.live.reporting import STATUS_ABSENT, classify, enrolled_user_ids, session_window

    user = _require_user(user)
    session = await get_session_by_uuid(db, session_uuid)
    course = await _get_course(db, session.course_id)
    await _require_staff(request, db, user, course)

    now = utcnow()
    started_at, _, session_seconds = session_window(session, now)

    rows = (
        await db.execute(
            select(LiveSessionParticipant, User)
            .join(User, User.id == LiveSessionParticipant.user_id)
            .where(LiveSessionParticipant.session_id == session.id)
        )
    ).all()

    summary = LiveAttendanceSummary()
    learner_percents: list[float] = []
    participants: list[LiveParticipantRead] = []
    for participant, member in rows:
        if participant.connection_count == 0:
            continue  # a row created by moderation before they ever connected
        figures = classify(participant, session, now)
        if participant.role == LiveParticipantRole.LEARNER:
            setattr(summary, figures.status, getattr(summary, figures.status) + 1)
            if figures.attendance_percent is not None:
                learner_percents.append(figures.attendance_percent)
        participants.append(
            LiveParticipantRead(
                user_id=member.id,
                user_uuid=member.user_uuid,
                username=member.username,
                first_name=member.first_name,
                last_name=member.last_name,
                role=participant.role,
                joined_at=as_utc(participant.joined_at),
                left_at=as_utc(participant.left_at),
                duration_seconds=figures.duration_seconds,
                connection_count=participant.connection_count,
                is_connected=participant.is_connected,
                attendance_percent=figures.attendance_percent,
                late_by_seconds=figures.late_by_seconds,
                left_early_by_seconds=figures.left_early_by_seconds,
                attendance_status=figures.status,
            )
        )

    role_order = {LiveParticipantRole.INSTRUCTOR: 0, LiveParticipantRole.MODERATOR: 1, LiveParticipantRole.LEARNER: 2}
    far_future = datetime.max.replace(tzinfo=timezone.utc)
    participants.sort(key=lambda p: (role_order[p.role], p.joined_at or far_future))

    enrolled_ids = await enrolled_user_ids(db, session.course_id)
    absent: list[LiveAbsentRead] = []
    if started_at is not None:
        attended_ids = {p.user_id for p in participants}
        missing = [uid for uid in enrolled_ids if uid not in attended_ids]
        if missing:
            members = (
                await db.execute(select(User).where(User.id.in_(missing[:_ABSENT_LIST_LIMIT])).order_by(User.first_name, User.username))
            ).scalars().all()
            absent = [
                LiveAbsentRead(
                    user_id=m.id, user_uuid=m.user_uuid, username=m.username,
                    first_name=m.first_name, last_name=m.last_name,
                )
                for m in members
            ]
        setattr(summary, STATUS_ABSENT, len(missing))
    if learner_percents:
        summary.average_attendance_percent = round(sum(learner_percents) / len(learner_percents), 1)

    return LiveAttendanceRead(
        session_uuid=session.session_uuid,
        status=session.status,
        started_at=started_at,
        ended_at=as_utc(session.ended_at),
        session_duration_seconds=session_seconds,
        enrolled_count=len(enrolled_ids),
        attended_count=sum(1 for p in participants if p.role == LiveParticipantRole.LEARNER),
        summary=summary,
        participants=participants,
        absent=absent,
    )
