"""LiveKit webhook handling: the server-side source of truth for who is in a
room and when rooms close. Callers must verify the signature first
(``livekit.verify_webhook``).

LiveKit retries failed deliveries and may deliver out of order; every handler
here is idempotent (ledger ``external_id`` + conditional transitions).
"""

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.live_sessions import (
    ACTIVE_STATUSES,
    STAFF_ROLES,
    LiveParticipantRole,
    LiveSession,
    LiveSessionEventType,
    LiveSessionStatus,
    utcnow,
)
from src.db.users import User
from src.services.live.attendance import record_connection_event
from src.services.live.telemetry import log_event
from src.services.live.sessions import (
    end_and_finalize,
    get_session_by_room,
    mark_live,
)

logger = logging.getLogger(__name__)

_LEAVE_EVENTS = ("participant_left", "participant_connection_aborted")
_EGRESS_EVENTS = ("egress_started", "egress_updated", "egress_ended")


def _field(obj: dict, snake: str, camel: str) -> Any:
    """Protobuf JSON may arrive camelCase (webhooks) or snake_case (Twirp)."""
    value = obj.get(camel)
    return obj.get(snake) if value is None else value


def parse_timestamp(value: Any) -> Optional[datetime]:
    """LiveKit int64 seconds (JSON-encoded as a string); tolerate milliseconds."""
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    if number > 10**12:
        number //= 1000
    return datetime.fromtimestamp(number, tz=timezone.utc)


def role_from_metadata(raw: Any) -> LiveParticipantRole:
    """Role from the server-signed token metadata; defaults to learner."""
    try:
        data = json.loads(raw) if isinstance(raw, str) and raw else {}
    except ValueError:
        data = {}
    value = data.get("role") if isinstance(data, dict) else None
    if value in LiveParticipantRole._value2member_map_:
        return LiveParticipantRole(value)
    return LiveParticipantRole.LEARNER


async def user_id_for_identity(db: AsyncSession, identity: Optional[str]) -> Optional[int]:
    if not identity:
        return None
    return (
        await db.execute(select(User.id).where(User.user_uuid == identity))
    ).scalars().first()


async def record_join(
    db: AsyncSession,
    session: LiveSession,
    participant: dict,
    *,
    source: str,
    fallback_at: datetime,
    external_id: Optional[str] = None,
) -> None:
    sid = participant.get("sid")
    user_id = await user_id_for_identity(db, participant.get("identity"))
    if not sid or user_id is None:
        return
    role = role_from_metadata(participant.get("metadata"))
    joined_at = parse_timestamp(_field(participant, "joined_at", "joinedAt")) or fallback_at
    await record_connection_event(
        db,
        session,
        user_id=user_id,
        event_type=LiveSessionEventType.PARTICIPANT_JOINED,
        participant_sid=sid,
        occurred_at=joined_at,
        source=source,
        external_id=external_id,
        role=role,
    )
    if role in STAFF_ROLES and session.status == LiveSessionStatus.READY:
        await mark_live(db, session, joined_at, source)


async def record_leave(
    db: AsyncSession,
    session: LiveSession,
    participant: dict,
    *,
    source: str,
    left_at: datetime,
    external_id: Optional[str] = None,
) -> None:
    sid = participant.get("sid")
    user_id = await user_id_for_identity(db, participant.get("identity"))
    if not sid or user_id is None:
        return
    await record_connection_event(
        db,
        session,
        user_id=user_id,
        event_type=LiveSessionEventType.PARTICIPANT_LEFT,
        participant_sid=sid,
        occurred_at=left_at,
        source=source,
        external_id=external_id,
    )


async def handle_webhook(db: AsyncSession, payload: dict) -> None:
    event = payload.get("event") or ""
    egress = _field(payload, "egress_info", "egressInfo") or {}
    room = payload.get("room") or {}
    room_name = room.get("name") or _field(egress, "room_name", "roomName")

    session = await get_session_by_room(db, room_name)
    participant = payload.get("participant") or {}
    if session is None:
        log_event("webhook.ignored", event=event, room=room_name, reason="unknown_room")
        return  # not a ValidBridge live room
    started = time.monotonic()
    log_event(
        "webhook.received",
        event=event,
        session=session.session_uuid,
        status=session.status,
        participant_sid=participant.get("sid"),
        egress_id=_field(egress, "egress_id", "egressId"),
    )

    event_id = payload.get("id") or None
    at = parse_timestamp(_field(payload, "created_at", "createdAt")) or utcnow()

    if event == "participant_joined":
        if session.status in ACTIVE_STATUSES:
            await record_join(db, session, participant, source="webhook", fallback_at=at, external_id=event_id)
    elif event in _LEAVE_EVENTS:
        await record_leave(db, session, participant, source="webhook", left_at=at, external_id=event_id)
    elif event == "room_finished":
        # A READY room can close before staff arrive (empty timeout); the
        # reconciler and staff joins re-provision it, and the READY timeout
        # decides expiry. Only a LIVE session ends with its room.
        if session.status == LiveSessionStatus.LIVE:
            await end_and_finalize(db, session, "webhook", ended_at=at)
    elif event in _EGRESS_EVENTS:
        from src.services.live.recordings import handle_egress_update

        await handle_egress_update(db, egress)
    log_event(
        "webhook.processed",
        event=event,
        session=session.session_uuid,
        elapsed_ms=round((time.monotonic() - started) * 1000),
    )
