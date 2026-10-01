"""
The billing cycle (pricing-implementation.md W3.7–W3.8).

``run_cycle`` is safe to run any number of times a day, from any number of
workers: every invoice has a deterministic number (unique in the database)
and every collection attempt a deterministic idempotency key (unique per org),
so a second run finds the work already done instead of repeating it.

On each run, per org:
1. a plan change scheduled for the end of a paid period takes effect;
2. an invoice is issued for anything now due — the monthly bill on the 1st
   (base, extra seats, add-ons, storage over the allowance) or a yearly
   renewal when a yearly period ends;
3. unpaid invoices are collected: the wallet first, then the default card,
   else the school is emailed a pay link (M-Pesa can't be charged unattended);
4. dunning: the card is retried on day 1, 3 and 5 with an email each time;
   after day 5 paid features pause (the org falls back to Starter limits;
   nothing is deleted) until the invoice is paid.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.billing_flags import billing_enabled
from src.db.billing import (
    BillingAccount,
    BillingSubscription,
    Invoice,
    OrgAddon,
    PaymentAttempt,
    StorageSnapshot,
)
from src.db.billing._common import current_period, utcnow
from src.security.features_utils.entitlements import get_active_catalog
from src.services.billing import accounts, engine, grants, notify, pricing

logger = logging.getLogger(__name__)

DUNNING_DAYS = (1, 3, 5)
PAUSE_AFTER_DAYS = 5


# ── Invoice building ─────────────────────────────────────────────────────────

def _line(code: str, description: str, amount_cents: int, **extra) -> dict:
    return {"code": code, "description": description, "amount_cents": int(amount_cents), **extra}


async def _active_addons(org_id: int, now: datetime, db: AsyncSession) -> list[OrgAddon]:
    rows = (await db.execute(select(OrgAddon).where(OrgAddon.org_id == org_id))).scalars().all()
    return [
        a for a in rows
        if (pricing.aware(a.started_at) or now) <= now
        and (a.ends_at is None or pricing.aware(a.ends_at) > now)
    ]


async def _storage_overage_line(
    org_id: int, plan_cfg: dict, catalog: dict, db: AsyncSession
) -> dict | None:
    allowance = plan_cfg.get("storage_bytes")
    if allowance is None:
        return None
    used = (
        await db.execute(
            select(StorageSnapshot.bytes)
            .where(StorageSnapshot.org_id == org_id)
            .order_by(StorageSnapshot.measured_at.desc())
            .limit(1)
        )
    ).scalars().first()
    over = int(used or 0) - int(allowance)
    if over <= 0:
        return None
    rule = catalog.get("storage_overage") or {}
    gb = int(rule.get("gb_bytes") or 1024 ** 3)
    over_gb = math.ceil(over / gb)
    price = int(rule.get("price_cents_per_gb_month") or 0) * over_gb
    return _line("storage", f"Storage over allowance ({over_gb} GB)", price, quantity=over_gb)


async def _end_unbillable_addons(
    addons: list[OrgAddon], plan: str, catalog: dict, now: datetime, db: AsyncSession
) -> list[OrgAddon]:
    """Add-ons the current plan can't hold (e.g. extra seats after moving to
    Starter) end now instead of being billed. Only the add-on ends; no data."""
    kept = []
    for addon in addons:
        if pricing.addon_monthly_price(catalog, plan, addon.addon, addon.quantity) is None:
            addon.ends_at = now
            db.add(addon)
        else:
            kept.append(addon)
    return kept


async def _apply_pending_change(sub: BillingSubscription, now: datetime, db: AsyncSession) -> None:
    end = pricing.aware(sub.period_end)
    if not sub.pending_plan or end is None or end > now:
        return
    await grants.set_org_plan(sub.org_id, sub.pending_plan, db)
    sub.plan = sub.pending_plan
    sub.cycle = sub.pending_cycle or sub.cycle
    sub.pending_plan = None
    sub.pending_cycle = None
    sub.updated_at = now
    db.add(sub)


async def _custom_price(org_id: int, db: AsyncSession) -> dict | None:
    from src.db.organization_config import OrganizationConfig

    config = (
        await db.execute(select(OrganizationConfig.config).where(OrganizationConfig.org_id == org_id))
    ).scalars().first() or {}
    billing = ((config.get("overrides") or {}).get("billing")) or {}
    if isinstance(billing.get("custom_price_cents"), int):
        return billing
    return None


async def build_due_invoice(
    org_id: int, now: datetime, db: AsyncSession
) -> tuple[str, list[dict], int] | None:
    """(number, lines, catalog_version) of the invoice due now, or None."""
    catalog_version, catalog = await get_active_catalog(db)
    sub = await accounts.get_subscription(org_id, db)
    plan = await accounts.current_plan(org_id, db)
    if sub is not None:
        await _apply_pending_change(sub, now, db)
        plan = await accounts.current_plan(org_id, db)
    plan_cfg = (catalog.get("plans") or {}).get(plan) or {}
    # A custom deal (superadmin-set price, e.g. Enterprise) replaces the list
    # price; its amount is per cycle as agreed, with no yearly discount on top.
    custom = await _custom_price(org_id, db)
    base_price = custom["custom_price_cents"] if custom else (plan_cfg.get("price_cents") or 0)
    paid_plan = bool(base_price) and sub is not None and sub.plan == plan
    cycle = (sub.cycle if sub else pricing.MONTHLY) or pricing.MONTHLY
    label = plan_cfg.get("label", plan)
    addons = await _end_unbillable_addons(
        await _active_addons(org_id, now, db), plan, catalog, now, db
    )
    await grants.sync_sso_addon(org_id, db)

    period_end = pricing.aware(sub.period_end) if sub else None
    yearly_due = paid_plan and cycle == pricing.YEARLY and (period_end is None or period_end <= now)
    if yearly_due:
        start = period_end or now
        end = pricing.add_years(start)
        lines = [
            _line(
                "base", f"{label} plan (yearly)",
                int(base_price) if custom else pricing.cycle_price(catalog, plan, pricing.YEARLY),
                period={"start": start.isoformat(), "end": end.isoformat(),
                        "plan": plan, "cycle": pricing.YEARLY},
            )
        ]
        seat_monthly = pricing.extra_seat_price(catalog, plan)
        seats = sum(a.quantity for a in addons if a.addon == "extra_seat")
        if seats and seat_monthly:
            discount = int(catalog.get("yearly_discount_percent") or 0)
            lines.append(_line(
                "extra_seat", f"{seats} extra instructor seat(s) (yearly)",
                seat_monthly * 12 * (100 - discount) // 100 * seats, quantity=seats,
            ))
        return f"VB-Y{start:%Y%m%d}-{org_id}", lines, catalog_version

    # The monthly bill. It is safe to build on any day, so a job that was down
    # on the 1st still bills the month: it only charges a base period that has
    # ended, and add-ons held since before this month. Anything bought during
    # the month was already charged pro rata up to the next 1st.
    period = current_period(now)
    this_month = pricing.month_start(now)
    lines: list[dict] = []
    if paid_plan and cycle == pricing.MONTHLY and (period_end is None or period_end <= now):
        start, end = this_month, pricing.next_month_start(now)
        lines.append(_line(
            "base", f"{label} plan ({period})", int(base_price),
            period={"start": start.isoformat(), "end": end.isoformat(),
                    "plan": plan, "cycle": pricing.MONTHLY},
        ))
    for addon in addons:
        if (pricing.aware(addon.started_at) or now) >= this_month:
            continue  # bought this month; prepaid up to the next 1st
        if addon.addon == "extra_seat" and cycle == pricing.YEARLY and paid_plan:
            continue  # covered by the yearly period
        price = pricing.addon_monthly_price(catalog, plan, addon.addon, addon.quantity)
        if price:
            lines.append(_line(
                addon.addon, pricing._addon_label(addon.addon, addon.quantity)
                if addon.addon != "extra_seat" else f"{addon.quantity} extra instructor seat(s)",
                price, quantity=addon.quantity,
            ))
    if paid_plan:
        storage = await _storage_overage_line(org_id, plan_cfg, catalog, db)
        if storage:
            lines.append(storage)
    if not lines:
        return None
    return f"VB-{period.replace('-', '')}-{org_id}", lines, catalog_version


async def issue_invoice(org_id: int, now: datetime, db: AsyncSession) -> Invoice | None:
    """Create the due invoice once. Returns the invoice (new or existing)."""
    built = await build_due_invoice(org_id, now, db)
    if built is None:
        await db.commit()  # keep any pending-change / add-on end applied above
        return None
    number, lines, catalog_version = built
    existing = (
        await db.execute(select(Invoice).where(Invoice.number == number))
    ).scalars().first()
    if existing is not None:
        await db.commit()
        return existing
    subtotal = sum(int(line["amount_cents"]) for line in lines)
    invoice = Invoice(
        org_id=org_id,
        number=number,
        period=current_period(now),
        lines=lines,
        subtotal_cents=subtotal,
        tax_cents=0,  # VAT/eTIMS pending the accountant (pricechange.md §8)
        total_cents=subtotal,
        status="open",
        catalog_version=catalog_version,
        # Dunning counts days from issue; issue time is the run's clock.
        created_at=now,
        updated_at=now,
    )
    db.add(invoice)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return (await db.execute(select(Invoice).where(Invoice.number == number))).scalars().first()
    return invoice


# ── Collection ───────────────────────────────────────────────────────────────

async def _pay_from_wallet(invoice: Invoice, db: AsyncSession) -> bool:
    await accounts.ensure_account(invoice.org_id, db, lock=True)
    await db.refresh(invoice)
    if invoice.status == "paid":
        return True
    if await accounts.wallet_balance(invoice.org_id, db) < int(invoice.total_cents):
        await db.rollback()
        return False
    await accounts.append_ledger(
        invoice.org_id, -int(invoice.total_cents), "charge", db,
        ref_type="invoice", ref_id=invoice.number,
    )
    await grants.mark_invoice_paid(invoice, "wallet", db)
    await db.commit()
    grants.invalidate_org_billing_caches(invoice.org_id)
    return True


async def _billing_email(org_id: int, db: AsyncSession) -> str | None:
    recipients = await notify._recipients(org_id, db)
    return recipients[0] if recipients else None


async def _charge_invoice_card(invoice: Invoice, key: str, db: AsyncSession) -> str:
    """One unattended card attempt for ``invoice`` under idempotency ``key``.
    Returns paid | failed | no_card | skipped (this attempt already made)."""
    card = await engine.default_card(invoice.org_id, db)
    email = await _billing_email(invoice.org_id, db)
    if card is None or email is None:
        return "no_card"
    if (
        await db.execute(
            select(PaymentAttempt.id).where(
                PaymentAttempt.org_id == invoice.org_id,
                PaymentAttempt.idempotency_key == key,
            )
        )
    ).scalars().first() is not None:
        return "skipped"
    quote = pricing.Quote(
        {"type": "invoice", "invoice_id": invoice.id},
        int(invoice.total_cents),
        f"Invoice {invoice.number}",
    )
    try:
        result = await engine.charge_card(
            invoice.org_id, quote, card, email=email, user_id=None,
            idempotency_key=key, invoice=invoice, db=db, prefix="vbi",
        )
    except IntegrityError:
        await db.rollback()  # another worker took this attempt
        return "skipped"
    return "paid" if result.get("status") == "paid" else "failed"


async def collect(invoice: Invoice, now: datetime, db: AsyncSession) -> str:
    """Try to settle an open invoice; returns its resulting status."""
    # A rollback (a short wallet, or a failure on an earlier invoice in the
    # same run) expires every loaded object; reload before reading fields.
    await db.refresh(invoice)
    if invoice.status == "paid":
        return "paid"
    if await _pay_from_wallet(invoice, db):
        await notify.receipt(invoice, db)
        return "paid"
    await db.refresh(invoice)

    created = pricing.aware(invoice.created_at) or now
    age_days = (now - created).days
    outcome = await _charge_invoice_card(invoice, f"invoice:{invoice.id}:d0", db)
    if outcome == "paid":
        await db.refresh(invoice)
        await notify.receipt(invoice, db)
        return "paid"
    await _mark_past_due(invoice, db)
    await _notify_once(invoice, "due", db, notify.invoice_due)

    for day in DUNNING_DAYS:
        if age_days >= day:
            outcome = await _charge_invoice_card(invoice, f"invoice:{invoice.id}:d{day}", db)
            if outcome == "paid":
                await db.refresh(invoice)
                await notify.receipt(invoice, db)
                return "paid"
            if outcome == "failed":
                await notify.payment_failed(invoice, day, db)
            elif outcome == "no_card":
                # M-Pesa payers can't be charged unattended: remind instead.
                await _notify_once(
                    invoice, f"reminder_d{day}", db,
                    lambda inv, session, d=day: notify.payment_failed(inv, d, session),
                )

    await db.refresh(invoice)
    if invoice.status != "paid" and age_days >= PAUSE_AFTER_DAYS:
        await _pause(invoice, now, db)
    return invoice.status


async def _notify_once(invoice: Invoice, kind: str, db: AsyncSession, sender) -> None:
    """Send an invoice email at most once, keyed like a payment attempt so a
    re-run of the job doesn't re-send it."""
    key = f"invoice:{invoice.id}:email:{kind}"
    exists = (
        await db.execute(
            select(PaymentAttempt.id).where(
                PaymentAttempt.org_id == invoice.org_id, PaymentAttempt.idempotency_key == key
            )
        )
    ).scalars().first()
    if exists is not None:
        return
    db.add(PaymentAttempt(
        reference=engine.new_reference("vbn", invoice.org_id),
        org_id=invoice.org_id, purpose="notice", amount_cents=0,
        status="sent", idempotency_key=key,
    ))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return
    await sender(invoice, db)


async def _mark_past_due(invoice: Invoice, db: AsyncSession) -> None:
    account = await accounts.ensure_account(invoice.org_id, db, lock=True)
    if account.status == "active":
        account.status = "past_due"
        account.updated_at = utcnow()
        db.add(account)
    await db.commit()


async def _pause(invoice: Invoice, now: datetime, db: AsyncSession) -> None:
    account = await accounts.ensure_account(invoice.org_id, db, lock=True)
    if account.status == "paused":
        await db.commit()
        return
    account.status = "paused"
    account.updated_at = now
    db.add(account)
    sub = await accounts.get_subscription(invoice.org_id, db)
    if sub is not None:
        sub.paused_at = now
        db.add(sub)
    await db.commit()
    grants.invalidate_org_billing_caches(invoice.org_id)
    logger.warning("Billing: org %s paused for unpaid invoice %s", invoice.org_id, invoice.number)
    await notify.account_paused(invoice, db)


# ── Entry point ──────────────────────────────────────────────────────────────

async def _billable_org_ids(now: datetime, db: AsyncSession) -> list[int]:
    ids = set((await db.execute(select(BillingSubscription.org_id))).scalars().all())
    ids |= set(
        (await db.execute(
            select(OrgAddon.org_id).where((OrgAddon.ends_at.is_(None)) | (OrgAddon.ends_at > now))
        )).scalars().all()
    )
    exempt = set(
        (await db.execute(
            select(BillingAccount.org_id).where(BillingAccount.exempt.is_(True))
        )).scalars().all()
    )
    return sorted(int(i) for i in ids - exempt)


async def run_cycle(db: AsyncSession, now: datetime | None = None) -> dict:
    """Issue due invoices and collect every unpaid one. Idempotent."""
    if not billing_enabled():
        return {"skipped": "billing disabled"}
    now = now or utcnow()
    from src.services.demo.guards import is_demo_org

    summary = {"issued": 0, "paid": 0, "unpaid": 0, "errors": 0}
    for org_id in await _billable_org_ids(now, db):
        try:
            if await is_demo_org(org_id, db):
                continue
            account = await db.get(BillingAccount, org_id)
            if account is not None and account.status == "paused":
                continue  # nothing new is billed until the unpaid invoice is paid
            before = (
                await db.execute(select(Invoice.id).where(Invoice.org_id == org_id))
            ).scalars().all()
            invoice = await issue_invoice(org_id, now, db)
            if invoice is not None and invoice.id not in before:
                summary["issued"] += 1
        except Exception:
            await db.rollback()
            summary["errors"] += 1
            logger.exception("Billing cycle: issuing failed for org %s", org_id)

    unpaid = (
        await db.execute(select(Invoice).where(Invoice.status.in_(("open", "failed"))))
    ).scalars().all()
    for invoice in unpaid:
        try:
            status = await collect(invoice, now, db)
            summary["paid" if status == "paid" else "unpaid"] += 1
        except Exception:
            await db.rollback()
            summary["errors"] += 1
            logger.exception("Billing cycle: collecting %s failed", invoice.number)
    logger.info("Billing cycle %s: %s", now.isoformat(), summary)
    return summary


def next_run_after(now: datetime) -> datetime:
    """Daily at 00:30 UTC (03:30 EAT). Billing periods are UTC months, so the
    run must fall on the same UTC day as the 1st it bills."""
    target = now.replace(hour=0, minute=30, second=0, microsecond=0)
    return target if target > now else target + timedelta(days=1)
