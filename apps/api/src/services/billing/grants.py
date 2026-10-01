"""
Grants: what a completed payment unlocks.

Every function here runs inside the caller's transaction and never commits,
so a payment is marked complete and its grant applied atomically. Callers
invalidate caches after the commit (``invalidate_org_billing_caches``).
"""

from __future__ import annotations

import copy
import logging
from datetime import datetime

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.billing import BillingSubscription, Invoice, OrgAddon, PackBalance
from src.db.billing._common import utcnow
from src.services.billing.accounts import ensure_account, get_subscription

logger = logging.getLogger(__name__)


async def set_org_plan(org_id: int, plan: str, db: AsyncSession) -> str:
    """Write ``plan`` into the org config (v1 or v2 layout) and record the
    transition for arrears billing. Returns the previous plan."""
    from src.db.organization_config import OrganizationConfig
    from src.security.features_utils.usage import _plan_from_config_dict
    from src.services.orgs.plan_history import record_plan_change

    row = (
        await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()
    if row is None:
        raise ValueError(f"Organization {org_id} has no config")
    config = copy.deepcopy(row.config or {})
    before = _plan_from_config_dict(config)
    if str(config.get("config_version", "1.0")).startswith("2"):
        config["plan"] = plan
    else:
        cloud = dict(config.get("cloud") or {})
        cloud["plan"] = plan
        config["cloud"] = cloud
    await record_plan_change(org_id, before, plan, db)
    row.config = config
    row.update_date = str(datetime.now())
    db.add(row)
    return before


def invalidate_org_billing_caches(org_id: int) -> None:
    """Drop every cache that holds a plan, limit or entitlement for the org."""
    from src.security.features_utils.entitlements import invalidate_entitlements

    invalidate_entitlements(org_id)
    try:
        from src.services.orgs.cache import invalidate_org_config_cache
        from src.services.orgs.usage import invalidate_usage_cache

        invalidate_org_config_cache(org_id)
        invalidate_usage_cache(org_id)
    except Exception:  # pragma: no cover - cache best-effort
        logger.debug("billing cache invalidation failed", exc_info=True)


async def grant_plan(
    org_id: int,
    plan: str,
    cycle: str,
    period_start: datetime | None,
    period_end: datetime | None,
    db: AsyncSession,
) -> None:
    await set_org_plan(org_id, plan, db)
    sub = await get_subscription(org_id, db)
    if sub is None:
        sub = BillingSubscription(org_id=org_id, plan=plan, cycle=cycle)
    sub.plan = plan
    sub.cycle = cycle
    if period_start is not None:
        sub.period_start = period_start
    if period_end is not None:
        sub.period_end = period_end
    sub.pending_plan = None
    sub.pending_cycle = None
    sub.updated_at = utcnow()
    db.add(sub)


async def grant_pack(org_id: int, kind: str, units: int, db: AsyncSession) -> None:
    row = (
        await db.execute(
            select(PackBalance)
            .where(PackBalance.org_id == org_id, PackBalance.kind == kind)
            .with_for_update()
        )
    ).scalars().first()
    if row is None:
        row = PackBalance(org_id=org_id, kind=kind, remaining=0)
    row.remaining = int(row.remaining or 0) + int(units)
    row.updated_at = utcnow()
    db.add(row)


async def grant_addon(org_id: int, addon: str, quantity: int, db: AsyncSession) -> None:
    db.add(OrgAddon(org_id=org_id, addon=addon, quantity=int(quantity), started_at=utcnow()))
    if addon == "sso":
        await db.flush()
        await sync_sso_addon(org_id, db)


async def sync_sso_addon(org_id: int, db: AsyncSession) -> None:
    """Keep SSO switched on exactly while the org holds the SSO add-on.

    SSO availability is read from ``overrides.sso.force_enabled`` in the org
    config. The add-on marks what it switched on (``source: addon``), so a
    superadmin's free grant (no source) is never switched off here.
    """
    from src.db.organization_config import OrganizationConfig

    now = utcnow()
    holds = any(
        (a.ends_at is None or (a.ends_at if a.ends_at.tzinfo else a.ends_at.replace(tzinfo=now.tzinfo)) > now)
        for a in (
            await db.execute(select(OrgAddon).where(OrgAddon.org_id == org_id, OrgAddon.addon == "sso"))
        ).scalars().all()
    )
    row = (
        await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()
    if row is None:
        return
    config = copy.deepcopy(row.config or {})
    overrides = dict(config.get("overrides") or {})
    entry = dict(overrides.get("sso") or {})
    if holds and not entry.get("force_enabled"):
        entry.update({"force_enabled": True, "source": "addon"})
    elif not holds and entry.get("source") == "addon":
        entry.pop("force_enabled", None)
        entry.pop("source", None)
    else:
        return
    overrides["sso"] = entry
    config["overrides"] = overrides
    row.config = config
    db.add(row)


async def mark_invoice_paid(invoice: Invoice, paid_via: str, db: AsyncSession) -> None:
    invoice.status = "paid"
    invoice.paid_via = paid_via
    invoice.updated_at = utcnow()
    db.add(invoice)
    # An invoice that bills a plan period extends the subscription when it is
    # paid, however late (wallet on the 1st, card on a retry, pay link later).
    for line in invoice.lines or []:
        period = line.get("period") if isinstance(line, dict) else None
        if not period:
            continue
        sub = await get_subscription(invoice.org_id, db)
        if sub is None:
            continue
        sub.period_start = datetime.fromisoformat(period["start"])
        sub.period_end = datetime.fromisoformat(period["end"])
        sub.updated_at = utcnow()
        db.add(sub)
    # Paying the last unpaid invoice lifts a pause immediately.
    unpaid = (
        await db.execute(
            select(Invoice.id).where(
                Invoice.org_id == invoice.org_id,
                Invoice.status.in_(("open", "failed")),
                Invoice.id != invoice.id,
            )
        )
    ).scalars().first()
    if unpaid is None:
        account = await ensure_account(invoice.org_id, db)
        if account.status != "active":
            account.status = "active"
            account.updated_at = utcnow()
            db.add(account)
        sub = await get_subscription(invoice.org_id, db)
        if sub is not None and sub.paused_at is not None:
            sub.paused_at = None
            db.add(sub)


async def apply_grant(
    org_id: int,
    item: dict,
    db: AsyncSession,
    *,
    covers_until: datetime | None,
    period_start: datetime | None,
    invoice: Invoice | None = None,
    paid_via: str = "card",
) -> None:
    """Apply the grant for a paid ``item`` (as normalised by pricing.quote)."""
    kind = item.get("type")
    if kind == "plan":
        await grant_plan(
            org_id, item["plan"], item["cycle"], period_start, covers_until, db
        )
    elif kind == "pack":
        await grant_pack(
            org_id, item["kind"], int(item["units"]) * int(item["quantity"]), db
        )
    elif kind == "addon":
        await grant_addon(org_id, item["addon"], int(item["quantity"]), db)
    elif kind == "invoice":
        if invoice is not None:
            await mark_invoice_paid(invoice, paid_via, db)
    elif kind == "wallet_topup":
        pass  # the ledger top-up entry is the grant
    else:  # pragma: no cover - quote() only produces the kinds above
        raise ValueError(f"Unknown item type {kind!r}")
