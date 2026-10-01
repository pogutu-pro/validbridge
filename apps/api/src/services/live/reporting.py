"""Attendance classification and analytics for live sessions.

Everything here is derived from server-side data: the connection ledger
projection (``LiveSessionParticipant``) and the session's own timestamps. No
client-reported presence is trusted.

Analytics are emitted once per lesson, when it finishes: a Tinybird event per
learner (``live_session_attended``) plus a durable ``UserAuditEvent`` so the
per-student dossier shows it, and one ``live_session_ended`` summary.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.live_sessions import (
    LiveParticipantRole,
    LiveSession,
    LiveSessionParticipant,
    utcnow,
)
from src.db.trail_runs import TrailRun
from src.db.user_audit_events import UserAuditEventType
from src.services.analytics import events as analytics_events
from src.services.analytics.analytics import track
from src.services.audit.audit import record_audit_event
from src.services.live.attendance import as_utc
from src.services.live.config import (
    early_leave_grace_seconds,
    late_grace_seconds,
    present_threshold_percent,
)

logger = logging.getLogger(__name__)

STATUS_PRESENT = "present"
STATUS_LATE = "late"
STATUS_LEFT_EARLY = "left_early"
STATUS_PARTIAL = "partial"
STATUS_ABSENT = "absent"


@dataclass
class AttendanceFigures:
    duration_seconds: int
    attendance_percent: Optional[float]
    late_by_seconds: int
    left_early_by_seconds: int
    status: str


def session_window(session: LiveSession, now: datetime) -> tuple[Optional[datetime], Optional[datetime], Optional[int]]:
    """(start, end, seconds) of the lesson's live period; end is now while live."""
    start = as_utc(session.started_at)
    if start is None:
        return None, None, None
    end = as_utc(session.ended_at) or now
    return start, end, max(0, int((end - start).total_seconds()))


def classify(participant: LiveSessionParticipant, session: LiveSession, now: datetime) -> AttendanceFigures:
    start, end, session_seconds = session_window(session, now)

    duration = participant.duration_seconds
    connected_since = as_utc(participant.connected_since)
    if participant.is_connected and connected_since is not None:
        duration += max(0, int((now - connected_since).total_seconds()))

    percent = None
    if session_seconds:
        percent = round(min(100.0, duration * 100.0 / session_seconds), 1)

    joined_at = as_utc(participant.joined_at)
    late_by = max(0, int((joined_at - start).total_seconds())) if start and joined_at else 0

    left_at = as_utc(participant.left_at)
    left_early_by = 0
    if session.ended_at is not None and not participant.is_connected and left_at and end:
        left_early_by = max(0, int((end - left_at).total_seconds()))

    if participant.connection_count == 0:
        status = STATUS_ABSENT
    elif percent is not None and percent < present_threshold_percent():
        status = STATUS_PARTIAL
    elif late_by > late_grace_seconds():
        status = STATUS_LATE
    elif left_early_by > early_leave_grace_seconds():
        status = STATUS_LEFT_EARLY
    else:
        status = STATUS_PRESENT

    return AttendanceFigures(
        duration_seconds=duration,
        attendance_percent=percent,
        late_by_seconds=late_by,
        left_early_by_seconds=left_early_by,
        status=status,
    )


async def enrolled_user_ids(db: AsyncSession, course_id: int) -> list[int]:
    return list(
        (await db.execute(select(TrailRun.user_id).where(TrailRun.course_id == course_id).distinct()))
        .scalars()
        .all()
    )


async def track_session_started(session: LiveSession) -> None:
    try:
        await track(
            analytics_events.LIVE_SESSION_STARTED,
            org_id=session.org_id,
            user_id=session.instructor_id or 0,
            properties={"session_uuid": session.session_uuid, "course_id": session.course_id},
        )
    except Exception:  # pragma: no cover - analytics never breaks the lesson
        logger.warning("live_session_started analytics failed", exc_info=True)


async def emit_session_finished(db: AsyncSession, session: LiveSession) -> None:
    """Emit per-learner attendance + a lesson summary. Called once, on finalize.

    Never raises: analytics must not be able to block a lesson from closing.
    """
    try:
        now = utcnow()
        course = await db.get(Course, session.course_id)
        participants = (
            await db.execute(
                select(LiveSessionParticipant).where(LiveSessionParticipant.session_id == session.id)
            )
        ).scalars().all()
        _, _, session_seconds = session_window(session, now)

        learner_percents: list[float] = []
        learners = 0
        for participant in participants:
            if participant.role != LiveParticipantRole.LEARNER:
                continue
            figures = classify(participant, session, now)
            learners += 1
            if figures.attendance_percent is not None:
                learner_percents.append(figures.attendance_percent)
            properties = {
                "session_uuid": session.session_uuid,
                "course_uuid": course.course_uuid if course else None,
                "duration_seconds": figures.duration_seconds,
                "attendance_percent": figures.attendance_percent,
                "late_by_seconds": figures.late_by_seconds,
                "left_early_by_seconds": figures.left_early_by_seconds,
                "status": figures.status,
                "connections": participant.connection_count,
            }
            await track(
                analytics_events.LIVE_SESSION_ATTENDED,
                org_id=session.org_id,
                user_id=participant.user_id,
                properties=properties,
            )
            await record_audit_event(
                event_type=UserAuditEventType.LIVE_SESSION_ATTENDED,
                user_id=participant.user_id,
                org_id=session.org_id,
                target_uuid=session.session_uuid,
                metadata={
                    **properties,
                    "session_title": session.title,
                    "course_name": course.name if course else None,
                },
            )

        enrolled = await enrolled_user_ids(db, session.course_id)
        await track(
            analytics_events.LIVE_SESSION_ENDED,
            org_id=session.org_id,
            user_id=session.instructor_id or 0,
            properties={
                "session_uuid": session.session_uuid,
                "course_uuid": course.course_uuid if course else None,
                "duration_seconds": session_seconds,
                "learners_attended": learners,
                "enrolled": len(enrolled),
                "average_attendance_percent": (
                    round(sum(learner_percents) / len(learner_percents), 1) if learner_percents else None
                ),
            },
        )
    except Exception:
        logger.warning("Live session %s: attendance analytics failed", session.session_uuid, exc_info=True)
