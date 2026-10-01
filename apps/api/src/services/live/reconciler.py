"""Periodic reconciliation of live sessions against LiveKit.

Webhooks are the fast path; this loop is what makes session state correct when
they are missed — API restarts, LiveKit restarts, dropped deliveries — and it
applies the time-based rules no event would ever trigger:

* ledger ↔ LiveKit participant sync (synthesised joins/leaves);
* READY → LIVE once staff are actually connected;
* READY expiry, LIVE host-absence grace and maximum duration → end;
* ENDED sessions whose teardown failed → retry finalisation;
* PROCESSING sessions stuck on a recording → complete.

Runs inside the API (no external scheduler), one pod per tick via a Redis lock;
without Redis every pod runs it, which is safe because all writes are
idempotent.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.live_sessions import (
    ACTIVE_STATUSES,
    STAFF_ROLES,
    LiveRecordingStatus,
    LiveSession,
    LiveSessionEventType,
    LiveSessionParticipant,
    LiveSessionStatus,
    utcnow,
)
from src.services.live import livekit
from src.services.live.attendance import as_utc, known_sids, open_connections, record_connection_event
from src.services.live.config import (
    LiveKitSettings,
    get_livekit_settings,
    host_absent_grace_seconds,
    max_duration_seconds,
    processing_timeout_seconds,
    ready_timeout_seconds,
    reconcile_interval_seconds,
)
from src.services.live.sessions import (
    ensure_room,
    end_and_finalize,
    finalize_session,
    mark_live,
    set_recording_status,
)
from src.services.live.classroom import expire_polls
from src.services.live.recordings import reconcile_recordings
from src.services.live.webhooks import record_join, role_from_metadata

from src.services.live.telemetry import log_event

logger = logging.getLogger(__name__)

_LOCK_KEY = "validbridge:live:reconcile"
_task: Optional[asyncio.Task] = None


async def _sync_participants(
    db: AsyncSession, settings: LiveKitSettings, session: LiveSession, now: datetime
) -> None:
    # A READY room can vanish before staff arrive (LiveKit restart, empty
    # timeout); re-provision it so the lecturer can still get in.
    if session.status == LiveSessionStatus.READY and not await livekit.room_exists(
        settings, session.livekit_room_name
    ):
        try:
            await ensure_room(settings, session)
        except Exception:
            logger.warning("Live session %s: could not re-provision room", session.session_uuid)

    # A missing room simply has no participants: everyone's connections close.
    present = await livekit.list_participants(settings, session.livekit_room_name) or []

    by_sid = {p.get("sid"): p for p in present if p.get("sid")}

    for sid, user_id in (await open_connections(db, session)).items():
        if sid not in by_sid:
            await record_connection_event(
                db,
                session,
                user_id=user_id,
                event_type=LiveSessionEventType.PARTICIPANT_LEFT,
                participant_sid=sid,
                occurred_at=now,
                source="reconcile",
            )

    seen = await known_sids(db, session)
    for sid, participant in by_sid.items():
        if sid not in seen:
            await record_join(db, session, participant, source="reconcile", fallback_at=now)

    await db.refresh(session)
    if session.status == LiveSessionStatus.READY:
        if any(role_from_metadata(p.get("metadata")) in STAFF_ROLES for p in by_sid.values()):
            await mark_live(db, session, now, "reconcile")


async def _staff_last_present(db: AsyncSession, session: LiveSession, now: datetime) -> Optional[datetime]:
    """``now`` if staff are connected, else when the last one left (None if never)."""
    staff = (
        await db.execute(
            select(LiveSessionParticipant).where(
                LiveSessionParticipant.session_id == session.id,
                LiveSessionParticipant.role.in_(list(STAFF_ROLES)),
            )
        )
    ).scalars().all()
    if any(p.is_connected for p in staff):
        return now
    left = [as_utc(p.left_at) for p in staff if p.left_at is not None]
    return max(left) if left else None


async def _apply_expiry(db: AsyncSession, session: LiveSession, now: datetime) -> None:
    if session.status == LiveSessionStatus.READY:
        ready_at = as_utc(session.ready_at) or as_utc(session.updated_at)
        if ready_at and now - ready_at > timedelta(seconds=ready_timeout_seconds()):
            log_event("session.auto_ended", session=session.session_uuid, reason="staff_never_joined")
            await end_and_finalize(db, session, "reconcile", ended_at=now)
        return

    if session.status != LiveSessionStatus.LIVE:
        return
    started_at = as_utc(session.started_at) or now
    if now - started_at > timedelta(seconds=max_duration_seconds()):
        log_event("session.auto_ended", session=session.session_uuid, reason="max_duration")
        await end_and_finalize(db, session, "reconcile", ended_at=now)
        return

    last_present = await _staff_last_present(db, session, now) or started_at
    if now - last_present > timedelta(seconds=host_absent_grace_seconds()):
        log_event("session.auto_ended", session=session.session_uuid, reason="host_absent")
        await end_and_finalize(db, session, "reconcile", ended_at=now)


async def reconcile_once(db: AsyncSession, now: Optional[datetime] = None) -> None:
    settings = get_livekit_settings()
    if settings is None:
        return
    now = now or utcnow()

    active = (
        await db.execute(select(LiveSession).where(LiveSession.status.in_(list(ACTIVE_STATUSES))))
    ).scalars().all()
    for session in active:
        try:
            await _sync_participants(db, settings, session, now)
        except livekit.LiveKitError as exc:
            # Without LiveKit's view we cannot judge presence; only the
            # absolute duration cap still applies.
            log_event("livekit.unreachable", logging.WARNING, session=session.session_uuid, error=str(exc))
            await db.rollback()
            await db.refresh(session)
            started_at = as_utc(session.started_at)
            if (
                session.status == LiveSessionStatus.LIVE
                and started_at
                and now - started_at > timedelta(seconds=max_duration_seconds())
            ):
                await end_and_finalize(db, session, "reconcile", ended_at=now)
            continue
        except Exception:
            logger.exception("Live session %s: reconcile failed", session.session_uuid)
            await db.rollback()
            continue
        try:
            await _apply_expiry(db, session, now)
        except Exception:
            logger.exception("Live session %s: expiry check failed", session.session_uuid)
            await db.rollback()
        try:
            # Timed polls close on time even if nobody opens the panel.
            await expire_polls(db, session)
        except Exception:
            logger.exception("Live session %s: poll expiry failed", session.session_uuid)
            await db.rollback()

    ended = (
        await db.execute(select(LiveSession).where(LiveSession.status == LiveSessionStatus.ENDED))
    ).scalars().all()
    for session in ended:
        try:
            await finalize_session(db, session, "reconcile")
        except Exception:
            logger.exception("Live session %s: finalize failed", session.session_uuid)
            await db.rollback()

    # Recordings: finalize what webhooks missed.
    await reconcile_recordings(db, now)

    cutoff = now - timedelta(seconds=processing_timeout_seconds())
    processing = (
        await db.execute(select(LiveSession).where(LiveSession.status == LiveSessionStatus.PROCESSING))
    ).scalars().all()
    for session in processing:
        ended_at = as_utc(session.ended_at)
        if ended_at and ended_at < cutoff:
            logger.warning("Live session %s: recording never finished; completing", session.session_uuid)
            await fail_stuck_recordings(db, session)


async def _claim_tick(interval: int) -> bool:
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return True
        acquired = await asyncio.to_thread(
            client.set, _LOCK_KEY, "1", nx=True, ex=max(1, interval - 1)
        )
        return bool(acquired)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("Live reconcile lock unavailable, running anyway: %s", exc)
        return True


async def _loop() -> None:
    from src.core.events.database import _async_session_factory

    interval = reconcile_interval_seconds()
    while True:
        await asyncio.sleep(interval)
        try:
            if await _claim_tick(interval):
                async with _async_session_factory() as db:
                    await reconcile_once(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Live reconcile tick failed")


def start_reconciler() -> None:
    """Start the loop when LiveKit is configured. Never raises."""
    global _task
    try:
        if get_livekit_settings() is None:
            logger.info("Live reconciler idle: LiveKit is not configured")
            return
        _task = asyncio.create_task(_loop())
        logger.info("Live reconciler started (every %ss)", reconcile_interval_seconds())
    except Exception as exc:
        logger.warning("Live reconciler not started: %s", exc)


async def stop_reconciler() -> None:
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


async def fail_stuck_recordings(db: AsyncSession, session: LiveSession) -> None:
    """Give up on recordings that never finished so the lesson can complete."""
    from src.db.live_sessions import IN_FLIGHT_RECORDING_STATES, LiveRecording
    from src.services.live.recordings import sync_session_recording_status

    stuck = (
        await db.execute(
            select(LiveRecording).where(
                LiveRecording.session_id == session.id,
                LiveRecording.status.in_(list(IN_FLIGHT_RECORDING_STATES)),
            )
        )
    ).scalars().all()
    now = utcnow()
    for recording in stuck:
        recording.status = "failed"
        recording.error = "timeout"
        recording.updated_at = now
        db.add(recording)
    await db.commit()
    await sync_session_recording_status(db, session, "reconcile")
    # A session with no recording rows at all (e.g. legacy state) still completes.
    await db.refresh(session)
    if session.status == LiveSessionStatus.PROCESSING and not stuck:
        await set_recording_status(db, session, LiveRecordingStatus.FAILED, "reconcile")
