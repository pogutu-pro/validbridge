"""Exam mode: timed, supervised sittings of an assessment.

Rules the rest of the platform relies on:

* The SERVER owns the clock. A student's deadline is fixed when they start
  (``min(now + duration, closes_at)``) and every answer write after it is refused.
* An assessment in exam mode cannot be read or answered except through a live
  session (``enforce_exam_mode``), so the normal assignment screen is not a way
  around the exam screen. Staff are not restricted, so they can author and mark.
* One sitting per student. Dropping the connection or closing the tab does not
  end it: the student can come back until their own deadline, and the clock
  never pauses.
* When the clock runs out the server submits for the student (``sweep_expired``),
  so a student who never returns is still graded on what they saved.
* Nothing here records camera or screen pictures; the browser only reports
  whether they are still running.
"""

import asyncio
import contextvars
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.assignments import Assignment
from src.db.courses.courses import Course
from src.db.courses.exams import (
    ExamClient,
    ExamEvent,
    ExamEventCreate,
    ExamEventRead,
    ExamHeartbeat,
    ExamMonitorRead,
    ExamRosterRow,
    ExamSession,
    ExamSessionStatus,
    ExamSettings,
    ExamSettingsRead,
    ExamSettingsWrite,
    ExamStatusRead,
    utcnow,
)
from src.db.trail_runs import TrailRun
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User
from src.security.rbac import AccessAction, authorization_verify_based_on_roles, check_resource_access

logger = logging.getLogger(__name__)

# A save that was already in flight when the clock ran out still counts.
GRACE_SECONDS = 5
# A browser that has not reported for this long is shown as disconnected.
CONNECTED_WITHIN_SECONDS = 10
# A gap this long between reports is recorded as a connection gap.
GAP_RECORDED_AFTER_SECONDS = 15
MAX_EVENTS_PER_SESSION = 3000
SWEEP_INTERVAL_SECONDS = 30

# Events the browser may report, and which of them count as violations.
VIOLATION_KINDS = frozenset({
    "tab_hidden", "window_blur", "copy_attempt", "paste_attempt", "cut_attempt", "context_menu",
    "print_attempt", "devtools_suspected", "extension_injection",
})
INFO_KINDS = frozenset({"tab_visible", "window_focus", "key_shortcut_blocked", "page_closed"})
CLIENT_EVENT_KINDS = VIOLATION_KINDS | INFO_KINDS
# Written by the server from heartbeats and lifecycle changes, never accepted from the client.
STATE_VIOLATIONS = {"camera_off", "screen_share_stopped", "fullscreen_exit"}

# While the server itself submits for a student whose time ran out, the answer
# gate must let that one submission through.
_FINALIZING: contextvars.ContextVar[bool] = contextvars.ContextVar("exam_finalizing", default=False)


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _require_user(user) -> PublicUser:
    if isinstance(user, (AnonymousUser, APITokenUser)) or user is None:
        raise HTTPException(status_code=401, detail="Sign in to take an exam")
    return user


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------


async def _assignment_and_course(db: AsyncSession, assignment_uuid: str) -> tuple[Assignment, Course]:
    assignment = (
        await db.execute(select(Assignment).where(Assignment.assignment_uuid == assignment_uuid))
    ).scalars().first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    course = await db.get(Course, assignment.course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return assignment, course


async def get_settings(db: AsyncSession, assignment_id: int) -> Optional[ExamSettings]:
    return (
        await db.execute(select(ExamSettings).where(ExamSettings.assignment_id == assignment_id))
    ).scalars().first()


async def _get_session(db: AsyncSession, assignment_id: int, user_id: int) -> Optional[ExamSession]:
    return (
        await db.execute(
            select(ExamSession).where(ExamSession.assignment_id == assignment_id, ExamSession.user_id == user_id)
        )
    ).scalars().first()


async def _is_staff(request: Request, db: AsyncSession, user, course: Course) -> bool:
    if isinstance(user, APITokenUser):
        return False
    if isinstance(user, AnonymousUser):
        return False
    return await authorization_verify_based_on_roles(request, user.id, "update", course.course_uuid, db)


async def _require_staff(request: Request, db: AsyncSession, user, course: Course) -> None:
    _require_user(user)
    await check_resource_access(request, db, user, course.course_uuid, AccessAction.UPDATE)


def window_state(settings: Optional[ExamSettings], now: datetime) -> str:
    if settings is None or not settings.enabled:
        return "none"
    opens, closes = _aware(settings.opens_at), _aware(settings.closes_at)
    if opens and now < opens:
        return "not_open"
    if closes and now >= closes:
        return "closed"
    return "open"


def _other_window(session: ExamSession, client_id: Optional[str]) -> bool:
    """True when a different browser window has taken over this sitting."""
    return bool(client_id and session.active_client and session.active_client != client_id)


def _seconds_left(session: ExamSession, now: datetime) -> Optional[int]:
    if session.status != ExamSessionStatus.IN_PROGRESS.value:
        return None
    return max(0, int((_aware(session.deadline_at) - now).total_seconds()))


def _settings_read(settings: ExamSettings, assignment_uuid: str) -> ExamSettingsRead:
    return ExamSettingsRead(
        assignment_uuid=assignment_uuid,
        enabled=settings.enabled,
        duration_minutes=settings.duration_minutes,
        opens_at=_aware(settings.opens_at),
        closes_at=_aware(settings.closes_at),
        require_camera=settings.require_camera,
        require_screen_share=settings.require_screen_share,
        require_fullscreen=settings.require_fullscreen,
        watermark=settings.watermark,
    )


def _status_read(settings: Optional[ExamSettings], assignment_uuid: str, session: Optional[ExamSession], now: datetime) -> ExamStatusRead:
    return ExamStatusRead(
        settings=_settings_read(settings, assignment_uuid) if settings is not None else None,
        window=window_state(settings, now),
        session_status=session.status if session else None,
        started_at=_aware(session.started_at) if session else None,
        deadline_at=_aware(session.deadline_at) if session else None,
        seconds_left=_seconds_left(session, now) if session else None,
        server_time=now,
    )


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


async def _add_event(db: AsyncSession, session: ExamSession, kind: str, detail: Optional[str] = None, *, violation: bool = False) -> None:
    db.add(ExamEvent(session_id=session.id, kind=kind, detail=(detail or None) and detail[:300], is_violation=violation))
    if violation:
        session.violation_count = int(session.violation_count or 0) + 1
    db.add(session)


async def _event_count(db: AsyncSession, session_id: int) -> int:
    return int((await db.execute(select(func.count()).select_from(ExamEvent).where(ExamEvent.session_id == session_id))).scalar() or 0)


async def record_event(request: Request, db: AsyncSession, user, assignment_uuid: str, payload: ExamEventCreate) -> dict:
    user = _require_user(user)
    if payload.kind not in CLIENT_EVENT_KINDS:
        raise HTTPException(status_code=422, detail="Unknown exam event")
    assignment, _ = await _assignment_and_course(db, assignment_uuid)
    session = await _get_session(db, assignment.id, user.id)
    if session is None or session.status != ExamSessionStatus.IN_PROGRESS.value or _other_window(session, payload.client_id):
        return {"recorded": False}
    if await _event_count(db, session.id) >= MAX_EVENTS_PER_SESSION:
        return {"recorded": False}
    violation = payload.kind in VIOLATION_KINDS
    # Leaving a tab fires a window blur and then a visibility change: count the pair once.
    if payload.kind == "tab_hidden":
        recent = (
            await db.execute(
                select(ExamEvent).where(ExamEvent.session_id == session.id).order_by(ExamEvent.id.desc()).limit(1)
            )
        ).scalars().first()
        if recent and recent.kind == "window_blur" and (utcnow() - _aware(recent.created_at)).total_seconds() < 2:
            violation = False
    await _add_event(db, session, payload.kind, payload.detail, violation=violation)
    await db.commit()
    return {"recorded": True}


# ---------------------------------------------------------------------------
# Staff: settings and monitor
# ---------------------------------------------------------------------------


async def read_settings(request: Request, db: AsyncSession, user, assignment_uuid: str) -> ExamStatusRead:
    """Anyone who can see the assessment may see its exam rules (never the questions)."""
    user = _require_user(user)
    assignment, course = await _assignment_and_course(db, assignment_uuid)
    await check_resource_access(request, db, user, course.course_uuid, AccessAction.READ)
    settings = await get_settings(db, assignment.id)
    now = utcnow()
    session = await _get_session(db, assignment.id, user.id) if settings else None
    if session is not None and session.status == ExamSessionStatus.IN_PROGRESS.value and now > _aware(session.deadline_at) + timedelta(seconds=GRACE_SECONDS):
        await finalize_session(request, db, session, assignment, course)
        session = await _get_session(db, assignment.id, user.id)
    return _status_read(settings, assignment_uuid, session, now)


async def write_settings(request: Request, db: AsyncSession, user, assignment_uuid: str, payload: ExamSettingsWrite) -> ExamSettingsRead:
    user = _require_user(user)
    assignment, course = await _assignment_and_course(db, assignment_uuid)
    await _require_staff(request, db, user, course)
    opens, closes = _aware(payload.opens_at), _aware(payload.closes_at)
    if opens and closes and closes <= opens:
        raise HTTPException(status_code=422, detail="The exam must close after it opens")
    if closes and closes <= utcnow() and payload.enabled:
        raise HTTPException(status_code=422, detail="The closing time is already in the past")
    settings = await get_settings(db, assignment.id)
    if settings is None:
        settings = ExamSettings(assignment_id=assignment.id, org_id=assignment.org_id, course_id=assignment.course_id)
    for field in ("enabled", "duration_minutes", "require_camera", "require_screen_share", "require_fullscreen", "watermark"):
        setattr(settings, field, getattr(payload, field))
    settings.opens_at, settings.closes_at = opens, closes
    settings.updated_at = utcnow()
    db.add(settings)
    await db.commit()
    await db.refresh(settings)
    return _settings_read(settings, assignment_uuid)


async def monitor(request: Request, db: AsyncSession, user, assignment_uuid: str) -> ExamMonitorRead:
    user = _require_user(user)
    assignment, course = await _assignment_and_course(db, assignment_uuid)
    await _require_staff(request, db, user, course)
    return await build_monitor(request, db, assignment)


async def build_monitor(request: Optional[Request], db: AsyncSession, assignment: Assignment) -> ExamMonitorRead:
    """The roster for one exam. The caller has already decided the viewer may see it."""
    assignment_uuid = assignment.assignment_uuid
    settings = await get_settings(db, assignment.id)
    if settings is None:
        raise HTTPException(status_code=404, detail="This assessment is not an exam")
    await sweep_expired(db, assignment_id=assignment.id, request=request)

    now = utcnow()
    sessions = {
        s.user_id: s
        for s in (await db.execute(select(ExamSession).where(ExamSession.assignment_id == assignment.id))).scalars().all()
    }
    enrolled = set(
        (await db.execute(select(TrailRun.user_id).where(TrailRun.course_id == assignment.course_id).distinct())).scalars().all()
    )
    user_ids = enrolled | set(sessions)
    users = {}
    if user_ids:
        users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()}

    rows: list[ExamRosterRow] = []
    for uid in user_ids:
        u = users.get(uid)
        if u is None:
            continue
        s = sessions.get(uid)
        name = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username
        if s is None:
            status = "not_started"
        elif s.status == ExamSessionStatus.SUBMITTED.value:
            status = "submitted"
        else:
            status = "in_progress"
        seen = _aware(s.last_seen_at) if s else None
        rows.append(ExamRosterRow(
            user_uuid=u.user_uuid, username=u.username, name=name, status=status,
            connected=bool(s and status == "in_progress" and seen and (now - seen).total_seconds() <= CONNECTED_WITHIN_SECONDS),
            started_at=_aware(s.started_at) if s else None, deadline_at=_aware(s.deadline_at) if s else None,
            seconds_left=_seconds_left(s, now) if s else None, submitted_at=_aware(s.submitted_at) if s else None,
            auto_submitted=bool(s and s.auto_submitted), last_seen_at=seen,
            camera_on=s.camera_on if s else None, screen_shared=s.screen_shared if s else None, fullscreen=s.fullscreen if s else None,
            violation_count=int(s.violation_count or 0) if s else 0, resume_count=int(s.resume_count or 0) if s else 0,
        ))
    order = {"in_progress": 0, "not_started": 1, "submitted": 2}
    rows.sort(key=lambda r: (order[r.status], -r.violation_count, r.name.lower()))
    counts = {k: sum(1 for r in rows if r.status == k) for k in ("not_started", "in_progress", "submitted")}
    counts["disconnected"] = sum(1 for r in rows if r.status == "in_progress" and not r.connected)
    counts["flagged"] = sum(1 for r in rows if r.violation_count > 0)
    return ExamMonitorRead(assignment_uuid=assignment_uuid, title=assignment.title, server_time=now, counts=counts, students=rows)


async def student_events(request: Request, db: AsyncSession, user, assignment_uuid: str, user_uuid: str) -> list[ExamEventRead]:
    user = _require_user(user)
    assignment, course = await _assignment_and_course(db, assignment_uuid)
    await _require_staff(request, db, user, course)
    student = (await db.execute(select(User).where(User.user_uuid == user_uuid))).scalars().first()
    session = await _get_session(db, assignment.id, student.id) if student else None
    if session is None:
        raise HTTPException(status_code=404, detail="No exam session for this student")
    events = (
        await db.execute(select(ExamEvent).where(ExamEvent.session_id == session.id).order_by(ExamEvent.id.asc()))
    ).scalars().all()
    return [ExamEventRead(kind=e.kind, detail=e.detail, is_violation=e.is_violation, created_at=_aware(e.created_at)) for e in events]


# ---------------------------------------------------------------------------
# Student: start, heartbeat, finish
# ---------------------------------------------------------------------------


async def start_exam(request: Request, db: AsyncSession, user, assignment_uuid: str, client: Optional[ExamClient] = None) -> ExamStatusRead:
    client_id = client.client_id if client else None
    user = _require_user(user)
    assignment, course = await _assignment_and_course(db, assignment_uuid)
    await check_resource_access(request, db, user, course.course_uuid, AccessAction.READ)
    settings = await get_settings(db, assignment.id)
    if settings is None or not settings.enabled:
        raise _error(404, "NOT_AN_EXAM", "This assessment is not an exam")
    if not assignment.published and not await _is_staff(request, db, user, course):
        raise HTTPException(status_code=404, detail="Assignment not found")

    now = utcnow()
    session = await _get_session(db, assignment.id, user.id)
    if session is not None:
        if session.status == ExamSessionStatus.SUBMITTED.value:
            raise _error(409, "EXAM_ALREADY_TAKEN", "You have already taken this exam")
        if now > _aware(session.deadline_at) + timedelta(seconds=GRACE_SECONDS):
            await finalize_session(request, db, session, assignment, course)
            raise _error(409, "EXAM_TIME_UP", "Your time for this exam is over; your answers were submitted")
        session.resume_count = int(session.resume_count or 0) + 1
        if _other_window(session, client_id):
            # The newest window wins; the older one closes itself on its next report.
            seen = _aware(session.last_seen_at)
            was_live = bool(seen and (now - seen).total_seconds() <= CONNECTED_WITHIN_SECONDS)
            await _add_event(
                db, session, "second_window",
                "opened in another browser or tab while the first was still open" if was_live else "continued in a new browser or tab",
                violation=was_live,
            )
        if client_id:
            session.active_client = client_id
        await _add_event(db, session, "resumed", f"back after {session.resume_count} interruption(s)")
        await db.commit()
        return _status_read(settings, assignment_uuid, session, now)

    state = window_state(settings, now)
    if state == "not_open":
        raise _error(403, "EXAM_NOT_OPEN", "This exam has not opened yet")
    if state == "closed":
        raise _error(403, "EXAM_CLOSED", "This exam is closed")
    deadline = now + timedelta(minutes=settings.duration_minutes)
    closes = _aware(settings.closes_at)
    if closes:
        deadline = min(deadline, closes)
    session = ExamSession(assignment_id=assignment.id, user_id=user.id, started_at=now, deadline_at=deadline, last_seen_at=now, active_client=client_id)
    db.add(session)
    try:
        await db.flush()
    except Exception:  # a double click started two sittings at once: the unique row won
        await db.rollback()
        session = await _get_session(db, assignment.id, user.id)
        if session is None:
            raise
        return _status_read(settings, assignment_uuid, session, now)
    await _add_event(db, session, "started")
    await db.commit()
    await db.refresh(session)
    return _status_read(settings, assignment_uuid, session, now)


async def heartbeat(request: Request, db: AsyncSession, user, assignment_uuid: str, report: ExamHeartbeat) -> ExamStatusRead:
    user = _require_user(user)
    assignment, course = await _assignment_and_course(db, assignment_uuid)
    settings = await get_settings(db, assignment.id)
    session = await _get_session(db, assignment.id, user.id)
    if settings is None or session is None:
        raise _error(404, "NO_EXAM_SESSION", "You have not started this exam")
    now = utcnow()
    if session.status == ExamSessionStatus.IN_PROGRESS.value:
        if now > _aware(session.deadline_at) + timedelta(seconds=GRACE_SECONDS):
            await finalize_session(request, db, session, assignment, course)
            session = await _get_session(db, assignment.id, user.id)
        elif _other_window(session, report.client_id):
            status = _status_read(settings, assignment_uuid, session, now)
            status.superseded = True
            return status
        else:
            last = _aware(session.last_seen_at)
            if last and (now - last).total_seconds() > GAP_RECORDED_AFTER_SECONDS:
                await _add_event(db, session, "connection_gap", f"no report for {int((now - last).total_seconds())}s")
            await _apply_report(db, session, settings, report)
            session.last_seen_at = now
            db.add(session)
            await db.commit()
    return _status_read(settings, assignment_uuid, session, now)


async def _apply_report(db: AsyncSession, session: ExamSession, settings: ExamSettings, report: ExamHeartbeat) -> None:
    """Record a change in camera / screen share / fullscreen as an event, once."""
    changes = (
        ("camera_on", report.camera_on, "camera_off", "camera_on", settings.require_camera),
        ("screen_shared", report.screen_shared, "screen_share_stopped", "screen_share_started", settings.require_screen_share),
        ("fullscreen", report.fullscreen, "fullscreen_exit", "fullscreen_enter", settings.require_fullscreen),
    )
    for field, value, off_kind, on_kind, required in changes:
        if value is None:
            continue
        previous = getattr(session, field)
        setattr(session, field, bool(value))
        if previous is None or previous == bool(value):
            if previous is None and not value and required:
                await _add_event(db, session, off_kind, "not on when the exam started", violation=True)
            continue
        if value:
            await _add_event(db, session, on_kind)
        else:
            await _add_event(db, session, off_kind, violation=bool(required))


async def finish_exam(request: Request, db: AsyncSession, user, assignment_uuid: str, client: Optional[ExamClient] = None) -> ExamStatusRead:
    user = _require_user(user)
    from src.services.courses.activities.assignments import create_assignment_submission

    assignment, course = await _assignment_and_course(db, assignment_uuid)
    settings = await get_settings(db, assignment.id)
    session = await _get_session(db, assignment.id, user.id)
    if settings is None or session is None:
        raise _error(404, "NO_EXAM_SESSION", "You have not started this exam")
    now = utcnow()
    if session.status == ExamSessionStatus.IN_PROGRESS.value and _other_window(session, client.client_id if client else None):
        raise _error(409, "EXAM_OTHER_WINDOW", "This exam was opened in another window, so this one can no longer hand it in")
    if session.status == ExamSessionStatus.IN_PROGRESS.value:
        try:
            await create_assignment_submission(request, assignment_uuid, user, db)
        except HTTPException as exc:
            # A submission already on file means the work is in; anything else is a real failure.
            if "already exists" not in str(exc.detail):
                raise
        session = await _get_session(db, assignment.id, user.id)
        session.status = ExamSessionStatus.SUBMITTED.value
        session.submitted_at = now
        await _add_event(db, session, "submitted")
        await db.commit()
    return _status_read(settings, assignment_uuid, session, now)


# ---------------------------------------------------------------------------
# Deadline: the server submits for students whose time ran out
# ---------------------------------------------------------------------------


def _system_request() -> Request:
    """A minimal request for server-side work that has no browser request behind it."""
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [], "query_string": b"", "state": {}})


async def finalize_session(request: Optional[Request], db: AsyncSession, session: ExamSession, assignment: Assignment, course: Course) -> None:
    """Submit what the student saved and close their sitting. Idempotent."""
    if session.status != ExamSessionStatus.IN_PROGRESS.value:
        return
    from src.services.courses.activities.assignments import create_assignment_submission

    student = await db.get(User, session.user_id)
    token = _FINALIZING.set(True)
    try:
        if student is not None:
            try:
                await create_assignment_submission(
                    request or _system_request(), assignment.assignment_uuid, PublicUser.model_validate(student), db
                )
            except HTTPException as exc:
                if "already exists" not in str(exc.detail):
                    logger.warning("Exam %s: auto-submit for user %s failed: %s", assignment.assignment_uuid, session.user_id, exc.detail)
            except Exception:
                logger.warning("Exam %s: auto-submit for user %s failed", assignment.assignment_uuid, session.user_id, exc_info=True)
                await db.rollback()
    finally:
        _FINALIZING.reset(token)
    session = await db.get(ExamSession, session.id)
    session.status = ExamSessionStatus.SUBMITTED.value
    session.submitted_at = utcnow()
    session.auto_submitted = True
    await _add_event(db, session, "auto_submitted", "time ran out")
    await db.commit()


async def sweep_expired(db: AsyncSession, assignment_id: Optional[int] = None, request: Optional[Request] = None) -> int:
    """Close every sitting whose clock has run out. Returns how many were closed."""
    cutoff = utcnow() - timedelta(seconds=GRACE_SECONDS)
    query = select(ExamSession).where(
        ExamSession.status == ExamSessionStatus.IN_PROGRESS.value, ExamSession.deadline_at < cutoff
    )
    if assignment_id is not None:
        query = query.where(ExamSession.assignment_id == assignment_id)
    closed = 0
    for session in (await db.execute(query)).scalars().all():
        assignment = await db.get(Assignment, session.assignment_id)
        course = await db.get(Course, assignment.course_id) if assignment else None
        if assignment is None or course is None:
            continue
        try:
            await finalize_session(request, db, session, assignment, course)
            closed += 1
        except Exception:
            logger.warning("Exam sweep: could not close session %s", session.id, exc_info=True)
            await db.rollback()
    return closed


_task: Optional[asyncio.Task] = None


async def _loop() -> None:
    from src.core.events.database import _async_session_factory

    while True:
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
        try:
            async with _async_session_factory() as db:
                await sweep_expired(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Exam sweep tick failed")


def start_sweeper() -> None:
    global _task
    try:
        _task = asyncio.get_running_loop().create_task(_loop())
    except Exception as exc:  # never stop the API from starting
        logger.warning("Exam sweeper not started: %s", exc)


async def stop_sweeper() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    finally:
        _task = None


# ---------------------------------------------------------------------------
# The gate used by the assignment service
# ---------------------------------------------------------------------------


async def enforce_exam_mode(
    db: AsyncSession, assignment: Assignment, current_user, *, action: str, is_staff: bool
) -> None:
    """Refuse learner access to an exam unless they are in a live sitting.

    ``action`` is one of ``read_questions``, ``write_answer``, ``submit``, ``retry``.
    Not an exam, or staff: no restriction.
    """
    if _FINALIZING.get() or is_staff:
        return
    settings = await get_settings(db, assignment.id)
    if settings is None or not settings.enabled:
        return
    if isinstance(current_user, (AnonymousUser, APITokenUser)):
        raise _error(403, "EXAM_SESSION_REQUIRED", "This exam can only be taken in the exam screen")
    if action == "retry":
        raise _error(403, "EXAM_NO_RETRY", "An exam cannot be retried")
    session = await _get_session(db, assignment.id, current_user.id)
    if session is None:
        raise _error(403, "EXAM_SESSION_REQUIRED", "Start the exam to see the questions")
    now = utcnow()
    over = now > _aware(session.deadline_at) + timedelta(seconds=GRACE_SECONDS)
    in_progress = session.status == ExamSessionStatus.IN_PROGRESS.value
    if action == "submit":
        if not in_progress:
            raise _error(409, "EXAM_ALREADY_TAKEN", "You have already submitted this exam")
        return
    if action == "write_answer":
        if not in_progress or over:
            raise _error(403, "EXAM_TIME_UP", "Time is up; answers can no longer be changed")
        return
    # read_questions
    if in_progress and not over:
        return
    closes = _aware(settings.closes_at)
    if not in_progress and closes and now >= closes:
        return  # the exam is over for everyone: students may review
    raise _error(403, "EXAM_TIME_UP" if in_progress else "EXAM_SUBMITTED", "The questions are not available right now")
