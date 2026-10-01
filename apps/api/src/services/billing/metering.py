"""
Monthly metering with pack drawdown (pricing-implementation.md W4d).

Mirrors ``record_live_usage`` (services/live/sessions.py): ``entitlements``
measures a monthly limit as *allowance + packs left* against ``usage_counter``,
so usage past the allowance is taken from the matching pack and the counter
records only what the pack did not cover. Recording pack-paid usage as well
would count it twice (the limit shrinks by the draw while usage grows by it).
"""

from __future__ import annotations

import logging

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.billing._common import utcnow

logger = logging.getLogger(__name__)


def _metered() -> bool:
    from src.core.deployment_mode import get_deployment_mode

    return get_deployment_mode() == "saas"


async def check_monthly(org_id: int, metric: str, amount: int, db: AsyncSession) -> None:
    """Refuse ``amount`` more of a monthly metric when allowance + packs are
    spent (enforce mode); shadow logs and allows. No-op outside SaaS."""
    if not _metered() or amount <= 0:
        return
    from src.security.features_utils.entitlements import check

    (await check(org_id, metric, amount, db)).raise_if_blocked()


def _allowance(ent, metric: str) -> int | None:
    from src.security.features_utils.entitlements import (
        METRIC_CODE_RUNS,
        METRIC_PREMIUM_AI_CREDITS,
    )

    return {
        METRIC_CODE_RUNS: ent.code_runs_month,
        METRIC_PREMIUM_AI_CREDITS: ent.premium_ai_credits_month,
    }[metric]


async def draw_pack(org_id: int, pack_kind: str, units: int, db: AsyncSession) -> int:
    """Take up to ``units`` from the org's pack (row-locked, never below 0).
    Returns what was taken. Does not commit."""
    from src.db.billing import PackBalance

    if units <= 0:
        return 0
    pack = (
        await db.execute(
            select(PackBalance)
            .where(PackBalance.org_id == org_id, PackBalance.kind == pack_kind)
            .with_for_update()
        )
    ).scalars().first()
    if pack is None or int(pack.remaining or 0) <= 0:
        return 0
    drawn = min(int(units), int(pack.remaining))
    pack.remaining = int(pack.remaining) - drawn
    pack.updated_at = utcnow()
    db.add(pack)
    return drawn


async def record_monthly(
    org_id: int, metric: str, pack_kind: str, amount: int, db: AsyncSession
) -> int:
    """Count ``amount`` used this month; overflow past the allowance comes out
    of the pack first. Commits. Returns the amount recorded in the counter."""
    if not _metered() or amount <= 0:
        return 0
    from src.security.features_utils.entitlements import (
        get_entitlements,
        get_usage,
        invalidate_entitlements,
        record_usage,
    )

    ent = await get_entitlements(org_id, db, use_cache=False)
    allowance = _allowance(ent, metric)
    drawn = 0
    if not ent.exempt and allowance is not None:
        used_before = await get_usage(org_id, metric, db)
        overflow = min(amount, max(0, used_before + amount - int(allowance)))
        drawn = await draw_pack(org_id, pack_kind, overflow, db)

    recorded = amount - drawn
    await record_usage(org_id, metric, recorded, db, commit=False)
    await db.commit()
    invalidate_entitlements(org_id)
    if drawn:
        logger.info("Metering %s org=%s amount=%s from_pack=%s", metric, org_id, amount, drawn)
    return recorded
