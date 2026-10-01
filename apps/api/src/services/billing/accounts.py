"""
Billing account, subscription state and the wallet ledger.

Money moves take a row lock on the org's ``billing_account``
(``SELECT … FOR UPDATE``) so two concurrent purchases cannot both spend the
same wallet balance or both slip under the spending limit. The ledger is
append-only: the wallet balance is the sum of an org's entries, and
``balance_after_cents`` is written under the same lock.
"""

from __future__ import annotations

from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.billing import BillingAccount, BillingSubscription, LedgerEntry
from src.db.billing._common import utcnow
from src.security.features_utils.plans import DEFAULT_PLAN, normalize_plan
from src.services.billing.pricing import MONTHLY, PlanState, aware, month_start


async def ensure_account(org_id: int, db: AsyncSession, *, lock: bool = False) -> BillingAccount:
    """The org's billing account, created on first use. ``lock`` takes a row
    lock for the rest of the transaction (ignored by SQLite)."""
    stmt = select(BillingAccount).where(BillingAccount.org_id == org_id)
    if lock:
        stmt = stmt.with_for_update()
    account = (await db.execute(stmt)).scalars().first()
    if account is None:
        account = BillingAccount(org_id=org_id)
        db.add(account)
        await db.flush()
        if lock:
            account = (await db.execute(stmt)).scalars().first()
    return account


async def get_subscription(org_id: int, db: AsyncSession) -> BillingSubscription | None:
    return (
        await db.execute(
            select(BillingSubscription).where(BillingSubscription.org_id == org_id)
        )
    ).scalars().first()


async def current_plan(org_id: int, db: AsyncSession) -> str:
    """The plan in the org config (the value every feature check reads)."""
    from src.db.organization_config import OrganizationConfig

    config = (
        await db.execute(
            select(OrganizationConfig.config).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first() or {}
    if str(config.get("config_version", "1.0")).startswith("2"):
        return normalize_plan(config.get("plan", DEFAULT_PLAN))
    return normalize_plan((config.get("cloud") or {}).get("plan", DEFAULT_PLAN))


async def plan_state(org_id: int, db: AsyncSession) -> PlanState:
    plan = await current_plan(org_id, db)
    sub = await get_subscription(org_id, db)
    if sub is None or sub.plan != plan:
        # Plan set outside billing (superadmin, Public Education): no paid period.
        return PlanState(plan=plan, cycle=(sub.cycle if sub else MONTHLY))
    return PlanState(
        plan=plan,
        cycle=sub.cycle or MONTHLY,
        period_start=aware(sub.period_start),
        period_end=aware(sub.period_end),
    )


async def wallet_balance(org_id: int, db: AsyncSession) -> int:
    total = (
        await db.execute(
            select(func.coalesce(func.sum(LedgerEntry.amount_cents), 0)).where(
                LedgerEntry.org_id == org_id
            )
        )
    ).scalar_one()
    return int(total or 0)


async def append_ledger(
    org_id: int,
    amount_cents: int,
    kind: str,
    db: AsyncSession,
    *,
    ref_type: str | None = None,
    ref_id: str | None = None,
    actor_id: int | None = None,
) -> LedgerEntry:
    """Append one entry. Call with the account row already locked."""
    balance = await wallet_balance(org_id, db) + int(amount_cents)
    entry = LedgerEntry(
        org_id=org_id,
        amount_cents=int(amount_cents),
        kind=kind,
        ref_type=ref_type,
        ref_id=ref_id,
        balance_after_cents=balance,
        actor_id=actor_id,
    )
    db.add(entry)
    await db.flush()
    return entry


async def spent_this_month(org_id: int, db: AsyncSession) -> int:
    """Purchases that count toward the school's spending limit this month
    (positive cents)."""
    total = (
        await db.execute(
            select(func.coalesce(func.sum(LedgerEntry.amount_cents), 0)).where(
                LedgerEntry.org_id == org_id,
                LedgerEntry.kind == "charge",
                LedgerEntry.ref_type == "overage",
                LedgerEntry.created_at >= month_start(utcnow()),
            )
        )
    ).scalar_one()
    return -int(total or 0)


async def within_spending_limit(
    account: BillingAccount, amount_cents: int, db: AsyncSession
) -> bool:
    if account.spending_limit_cents is None:
        return True
    spent = await spent_this_month(account.org_id, db)
    return spent + int(amount_cents) <= int(account.spending_limit_cents)
