"""Attendance: the connection ledger and the per-participant projection.

Every LiveKit connection (participant SID) contributes one join and, eventually,
one leave to ``LiveSessionEvent``. ``LiveSessionParticipant`` is recomputed from
the whole ledger each time — never incremented — as the union of a user's
connection intervals:

* a refresh or network drop opens a new SID; its interval overlaps or follows
  the old one and overlap is counted once;
* duplicate deliveries (webhook retries, webhook + reconciler) are rejected by
  the unique ``external_id`` and the per-SID duplicate check, and would be
  harmless anyway since recomputation is idempotent;
* a leave that arrives before its join simply pairs up once the join lands;
* connections still open when the session ends are closed at ``ended_at``.

Writes for one (session, user) are serialised by locking the participant row, so
two concurrent webhooks cannot each recompute from a view missing the other's
event.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.live_sessions import (
    CONNECTION_EVENT_TYPES,
    LiveParticipantRole,
    LiveSession,
    LiveSessionEvent,
    LiveSessionEventType,
    LiveSessionParticipant,
    utcnow,
)

logger = logging.getLogger(__name__)


def _log_attendance(**fields) -> None:
    from src.services.live.telemetry import log_event

    log_event("attendance.recorded", **fields)


def as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Normalise to aware UTC (SQLite hands timestamptz back naive)."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@dataclass
class AttendanceSummary:
    joined_at: Optional[datetime]
    left_at: Optional[datetime]
    duration_seconds: int
    connection_count: int
    is_connected: bool
    connected_since: Optional[datetime]
    role: Optional[LiveParticipantRole]


def summarize_connections(
    events: Iterable[LiveSessionEvent], ended_at: Optional[datetime]
) -> AttendanceSummary:
    """Fold a user's join/leave events into attendance totals (pure)."""
    starts: dict[str, datetime] = {}
    ends: dict[str, datetime] = {}
    role: Optional[LiveParticipantRole] = None
    role_at: Optional[datetime] = None

    for event in events:
        sid = event.participant_sid
        if not sid:
            continue
        at = as_utc(event.occurred_at)
        if event.event_type == LiveSessionEventType.PARTICIPANT_JOINED:
            starts[sid] = min(starts.get(sid, at), at)
            raw_role = (event.data or {}).get("role")
            if raw_role in LiveParticipantRole._value2member_map_ and (role_at is None or at >= role_at):
                role = LiveParticipantRole(raw_role)
                role_at = at
        elif event.event_type == LiveSessionEventType.PARTICIPANT_LEFT:
            ends[sid] = max(ends.get(sid, at), at)

    ended_at = as_utc(ended_at)
    intervals: list[tuple[datetime, Optional[datetime]]] = []
    for sid, start in starts.items():
        end = ends.get(sid)
        if end is None and ended_at is not None:
            end = ended_at
        if end is not None and end < start:
            end = start
        intervals.append((start, end))

    if not intervals:
        return AttendanceSummary(None, None, 0, 0, False, None, role)

    intervals.sort(key=lambda iv: iv[0])
    merged: list[list] = []
    for start, end in intervals:
        if merged:
            last = merged[-1]
            if last[1] is None or start <= last[1]:
                if last[1] is not None and (end is None or end > last[1]):
                    last[1] = end
                continue
        merged.append([start, end])

    duration = 0.0
    connected_since: Optional[datetime] = None
    for start, end in merged:
        if end is None:
            connected_since = start
        else:
            duration += (end - start).total_seconds()

    is_connected = connected_since is not None
    closed_ends = [end for _, end in merged if end is not None]
    return AttendanceSummary(
        joined_at=merged[0][0],
        left_at=None if is_connected else (max(closed_ends) if closed_ends else None),
        duration_seconds=int(duration),
        connection_count=len(starts),
        is_connected=is_connected,
        connected_since=connected_since,
        role=role,
    )


async def locked_participant(
    db: AsyncSession, session: LiveSession, user_id: int, role: Optional[LiveParticipantRole]
) -> LiveSessionParticipant:
    """Fetch-or-create the participant row and hold a row lock on it."""
    stmt = (
        select(LiveSessionParticipant)
        .where(
            LiveSessionParticipant.session_id == session.id,
            LiveSessionParticipant.user_id == user_id,
        )
        .with_for_update()
    )
    participant = (await db.execute(stmt)).scalars().first()
    if participant is not None:
        return participant

    try:
        async with db.begin_nested():
            db.add(
                LiveSessionParticipant(
                    session_id=session.id,
                    user_id=user_id,
                    org_id=session.org_id,
                    role=role or LiveParticipantRole.LEARNER,
                )
            )
    except IntegrityError:
        pass  # a concurrent writer created it; lock theirs
    return (await db.execute(stmt)).scalars().one()


async def recompute_participant(
    db: AsyncSession, session: LiveSession, participant: LiveSessionParticipant
) -> None:
    events = (
        await db.execute(
            select(LiveSessionEvent)
            .where(
                LiveSessionEvent.session_id == session.id,
                LiveSessionEvent.user_id == participant.user_id,
                LiveSessionEvent.event_type.in_(CONNECTION_EVENT_TYPES),
            )
            .order_by(LiveSessionEvent.occurred_at, LiveSessionEvent.id)
        )
    ).scalars().all()
    summary = summarize_connections(events, session.ended_at)
    participant.joined_at = summary.joined_at
    participant.left_at = summary.left_at
    participant.duration_seconds = summary.duration_seconds
    participant.connection_count = summary.connection_count
    participant.is_connected = summary.is_connected
    participant.connected_since = summary.connected_since
    if summary.role is not None:
        participant.role = summary.role
    participant.updated_at = utcnow()
    db.add(participant)


async def record_connection_event(
    db: AsyncSession,
    session: LiveSession,
    *,
    user_id: int,
    event_type: str,
    participant_sid: str,
    occurred_at: datetime,
    source: str,
    external_id: Optional[str] = None,
    role: Optional[LiveParticipantRole] = None,
) -> bool:
    """Append a join/leave to the ledger and refresh the projection.

    Returns False (and changes nothing) for a duplicate. Commits.
    """
    if event_type not in CONNECTION_EVENT_TYPES:
        raise ValueError(f"not a connection event: {event_type}")

    if external_id is not None:
        seen = (
            await db.execute(
                select(LiveSessionEvent.id).where(LiveSessionEvent.external_id == external_id)
            )
        ).scalars().first()
        if seen is not None:
            return False

    participant = await locked_participant(db, session, user_id, role)

    duplicate = (
        await db.execute(
            select(LiveSessionEvent.id).where(
                LiveSessionEvent.session_id == session.id,
                LiveSessionEvent.participant_sid == participant_sid,
                LiveSessionEvent.event_type == event_type,
            )
        )
    ).scalars().first()
    if duplicate is not None:
        await db.commit()  # release the row lock
        return False

    db.add(
        LiveSessionEvent(
            session_id=session.id,
            org_id=session.org_id,
            user_id=user_id,
            event_type=event_type,
            participant_sid=participant_sid,
            source=source,
            external_id=external_id,
            occurred_at=as_utc(occurred_at),
            data={"role": role.value} if role is not None else None,
        )
    )
    try:
        await db.flush()
    except IntegrityError:
        # Same webhook delivered concurrently; the other copy won.
        await db.rollback()
        # rollback expires loaded instances; reload so callers can keep using it.
        await db.refresh(session)
        return False

    await recompute_participant(db, session, participant)
    await db.commit()
    _log_attendance(
        session=session.session_uuid,
        user_id=user_id,
        kind="join" if event_type == LiveSessionEventType.PARTICIPANT_JOINED else "leave",
        participant_sid=participant_sid,
        source=source,
        connections=participant.connection_count,
        connected=participant.is_connected,
        attended_seconds=participant.duration_seconds,
    )
    return True


async def recompute_session(db: AsyncSession, session: LiveSession) -> None:
    """Recompute every participant (e.g. to close connections at ``ended_at``). Commits."""
    participants = (
        await db.execute(
            select(LiveSessionParticipant)
            .where(LiveSessionParticipant.session_id == session.id)
            .with_for_update()
        )
    ).scalars().all()
    for participant in participants:
        await recompute_participant(db, session, participant)
    await db.commit()


async def open_connections(db: AsyncSession, session: LiveSession) -> dict[str, int]:
    """SIDs the ledger considers connected, mapped to their user id."""
    rows = (
        await db.execute(
            select(
                LiveSessionEvent.participant_sid,
                LiveSessionEvent.user_id,
                LiveSessionEvent.event_type,
            ).where(
                LiveSessionEvent.session_id == session.id,
                LiveSessionEvent.event_type.in_(CONNECTION_EVENT_TYPES),
                LiveSessionEvent.participant_sid.is_not(None),
            )
        )
    ).all()
    joined: dict[str, int] = {}
    left: set[str] = set()
    for sid, user_id, event_type in rows:
        if event_type == LiveSessionEventType.PARTICIPANT_JOINED and user_id is not None:
            joined[sid] = user_id
        elif event_type == LiveSessionEventType.PARTICIPANT_LEFT:
            left.add(sid)
    return {sid: uid for sid, uid in joined.items() if sid not in left}


async def known_sids(db: AsyncSession, session: LiveSession) -> set[str]:
    """Every SID the ledger has a join for."""
    rows = (
        await db.execute(
            select(LiveSessionEvent.participant_sid).where(
                LiveSessionEvent.session_id == session.id,
                LiveSessionEvent.event_type == LiveSessionEventType.PARTICIPANT_JOINED,
            )
        )
    ).scalars().all()
    return {sid for sid in rows if sid}
