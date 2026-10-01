"""
Runs platform billing from inside the API, so no external cron is needed:

* every hour, the reconciler finishes payments whose webhook never arrived;
* once a day (from 00:30 UTC), the billing cycle issues due invoices,
  collects them and runs dunning.

No-op unless ``VALIDBRIDGE_BILLING_ENABLED``. Correctness never depends on a
single replica: invoice numbers and payment idempotency keys are unique in the
database, so replicas racing each other collide there and the loser skips. The
Redis locks only save duplicate work. ``cli.py billing-run-cycle`` stays the
operator's manual interface.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

logger = logging.getLogger(__name__)

TICK_SECONDS = 60 * 60
STARTUP_DELAY_SECONDS = 45
_LOCK_TTL_SECONDS = 50 * 60

_task: asyncio.Task | None = None


async def _claim(key: str) -> bool:
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return True
        return bool(await asyncio.to_thread(client.set, key, "1", nx=True, ex=_LOCK_TTL_SECONDS))
    except Exception:  # pragma: no cover - defensive
        return True


async def run_tick(now: datetime | None = None) -> dict:
    from src.core.billing_flags import billing_enabled
    from src.core.events.database import _async_session_factory
    from src.services.billing.cycle import run_cycle
    from src.services.billing.engine import reconcile_pending

    if not billing_enabled():
        return {"skipped": "billing disabled"}
    now = now or datetime.now(UTC)
    out: dict = {}
    if await _claim(f"validbridge:billing:reconcile:{now:%Y%m%d%H}"):
        async with _async_session_factory() as db:
            out["reconcile"] = await reconcile_pending(db)
    if (now.hour, now.minute) >= (0, 30) and await _claim(f"validbridge:billing:cycle:{now:%Y%m%d}"):
        async with _async_session_factory() as db:
            out["cycle"] = await run_cycle(db, now=now)
        # Storage truth for the meter and for next month's overage lines.
        from src.services.billing.storage_meter import run_storage_scan

        try:
            async with _async_session_factory() as db:
                out["storage_scan"] = await run_storage_scan(db)
        except Exception:
            logger.exception("Storage scan failed")
    return out


async def _loop() -> None:
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    while True:
        try:
            result = await run_tick()
            if result and "skipped" not in result:
                logger.info("Billing tick: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Billing tick failed")
        await asyncio.sleep(TICK_SECONDS)


def start_scheduler() -> None:
    global _task
    from src.core.billing_flags import billing_enabled

    if not billing_enabled() or _task is not None:
        return
    _task = asyncio.create_task(_loop())
    logger.info("Billing scheduler started (hourly)")


async def stop_scheduler() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
