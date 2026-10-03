"""
Platform billing API (pricing-implementation.md W3): a school paying
ValidBridge for its plan, add-ons, packs and invoices.

Every org endpoint requires an org admin with ``organizations.action_update``
(the same right the billing page checks) and rejects API tokens: money is
moved by people, not integrations. The Paystack webhook is public and
authenticated by its HMAC signature.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.billing_flags import billing_enabled, platform_paystack_public_key
from src.core.events.database import get_db_session
from src.db.billing import Invoice, LedgerEntry, OrgAddon, PaymentAttempt
from src.db.billing._common import utcnow
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.security.auth import resolve_acting_user_id
from src.security.features_utils import entitlements as ent
from src.security.features_utils.entitlements import get_active_catalog
from src.security.org_auth import enforce_org_mfa, require_org_role_permission
from src.security.redirects import is_allowed_return_url
from src.services.billing import accounts, engine, grants, pricing

router = APIRouter()

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")


# ── Auth ─────────────────────────────────────────────────────────────────────

class BillingActor(BaseModel):
    user_id: int
    email: str | None


async def require_billing_admin(
    org_id: int,
    current_user: Any = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> BillingActor:
    user_id = resolve_acting_user_id(current_user)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to manage billing")
    await require_org_role_permission(
        user_id, org_id, db_session, "organizations", "action_update",
        fallback_role_ids=frozenset({1}),
    )
    await enforce_org_mfa(user_id, org_id, db_session)
    return BillingActor(user_id=user_id, email=getattr(current_user, "email", None))


# ── Request bodies ───────────────────────────────────────────────────────────

class ItemBody(BaseModel):
    item: dict[str, Any]


class CheckoutBody(BaseModel):
    item: dict[str, Any]
    return_url: str = Field(max_length=2048)
    save_card: bool = True
    idempotency_key: str | None = Field(default=None, max_length=128)


class PurchaseBody(BaseModel):
    item: dict[str, Any]
    pay_with: Literal["wallet", "card"]
    payment_method_id: int | None = None
    idempotency_key: str | None = Field(default=None, max_length=128)


class PlanChangeBody(BaseModel):
    plan: str = Field(max_length=32)
    cycle: Literal["monthly", "yearly"] = "monthly"


class SettingsBody(BaseModel):
    spending_limit_cents: int | None = Field(default=None, ge=0)
    clear_spending_limit: bool = False
    auto_add_seats: bool | None = None
    billing_email: str | None = Field(default=None, max_length=320)


# ── Public ───────────────────────────────────────────────────────────────────

@router.get("/catalog")
async def api_catalog(db_session: AsyncSession = Depends(get_db_session)):
    """The active price catalogue (read by the pricing page and billing UI)."""
    version, catalog = await get_active_catalog(db_session)
    return {
        "enabled": billing_enabled(),
        "public_key": platform_paystack_public_key() if billing_enabled() else None,
        "version": version,
        "catalog": catalog,
    }


@router.post("/paystack/webhook")
async def api_paystack_webhook(request: Request, db_session: AsyncSession = Depends(get_db_session)):
    # The platform account's one webhook URL also receives managed schools'
    # course sales, so route by reference rather than assume platform billing.
    from src.services.payments import service as payments_service

    raw = await request.body()
    return await payments_service.dispatch_webhook(
        raw, request.headers.get("x-paystack-signature"), db_session
    )


# ── Overview ─────────────────────────────────────────────────────────────────

async def _meters(org_id: int, db: AsyncSession) -> tuple[dict, dict]:
    e = await ent.get_entitlements(org_id, db, use_cache=False)
    meters: dict[str, dict] = {}
    gauges = {
        ent.METRIC_INSTRUCTOR_SEATS: e.instructor_seats,
        ent.METRIC_LEARNERS: e.learner_allowance,
        ent.METRIC_STORAGE: e.storage_bytes,
    }
    for metric, limit in gauges.items():
        meters[metric] = {"used": await ent._default_gauge_value(org_id, metric, db), "limit": limit}
    for metric in (ent.METRIC_LIVE_SECONDS, ent.METRIC_PREMIUM_AI_CREDITS, ent.METRIC_CODE_RUNS):
        meters[metric] = {
            "used": await ent.get_usage(org_id, metric, db),
            "limit": ent._limit_for(e, metric),
        }
    if e.managed_email:
        meters[ent.METRIC_MANAGED_EMAILS] = {
            "used": await ent.get_usage(org_id, ent.METRIC_MANAGED_EMAILS, db),
            "limit": e.managed_emails_month,
        }
    return meters, {
        "plan": e.plan,
        "features": e.features,
        "packs": e.packs,
        "live_concurrency": e.live_concurrency,
        "exempt": e.exempt,
    }


def _iso(value) -> str | None:
    value = pricing.aware(value)
    return value.isoformat() if value else None


@router.get("/{org_id}/overview")
async def api_overview(
    org_id: int,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    account = await accounts.ensure_account(org_id, db_session)
    await db_session.commit()
    sub = await accounts.get_subscription(org_id, db_session)
    plan = await accounts.current_plan(org_id, db_session)
    meters, entitled = await _meters(org_id, db_session)
    now = utcnow()
    addons = (
        await db_session.execute(select(OrgAddon).where(OrgAddon.org_id == org_id))
    ).scalars().all()
    open_invoices = (
        await db_session.execute(
            select(Invoice).where(
                Invoice.org_id == org_id, Invoice.status.in_(("open", "failed"))
            ).order_by(Invoice.created_at.desc())
        )
    ).scalars().all()
    return {
        "enabled": billing_enabled(),
        "public_key": platform_paystack_public_key() if billing_enabled() else None,
        "plan": plan,
        "effective_plan": entitled["plan"],
        "cycle": sub.cycle if sub else "monthly",
        "period_start": _iso(sub.period_start) if sub else None,
        "period_end": _iso(sub.period_end) if sub else None,
        "pending_plan": sub.pending_plan if sub else None,
        "pending_cycle": sub.pending_cycle if sub else None,
        "status": account.status,
        "exempt": entitled["exempt"],
        "wallet_balance_cents": await accounts.wallet_balance(org_id, db_session),
        "spent_this_month_cents": await accounts.spent_this_month(org_id, db_session),
        "spending_limit_cents": account.spending_limit_cents,
        "auto_add_seats": account.auto_add_seats,
        "billing_email": account.billing_email,
        "meters": meters,
        "features": entitled["features"],
        "packs": entitled["packs"],
        "live_concurrency": entitled["live_concurrency"],
        "addons": [
            {
                "id": a.id, "addon": a.addon, "quantity": a.quantity,
                "started_at": _iso(a.started_at), "ends_at": _iso(a.ends_at),
            }
            for a in addons
            if a.ends_at is None or pricing.aware(a.ends_at) > now
        ],
        "cards": await engine.list_cards(org_id, db_session),
        "open_invoices": [_invoice_view(i) for i in open_invoices],
    }


def _invoice_view(invoice: Invoice) -> dict:
    return {
        "id": invoice.id,
        "number": invoice.number,
        "period": invoice.period,
        "lines": invoice.lines,
        "subtotal_cents": invoice.subtotal_cents,
        "tax_cents": invoice.tax_cents,
        "total_cents": invoice.total_cents,
        "status": invoice.status,
        "paid_via": invoice.paid_via,
        "created_at": _iso(invoice.created_at),
    }


# ── Buying ───────────────────────────────────────────────────────────────────

@router.post("/{org_id}/quote")
async def api_quote(
    org_id: int,
    body: ItemBody,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    quote, invoice = await engine.build_quote(org_id, body.item, db_session)
    lines = quote.lines
    if invoice is not None:
        lines = [
            _invoice_part(line.get("description", ""), line.get("amount_cents", 0),
                         (line.get("period") or {}).get("start"),
                         (line.get("period") or {}).get("end"))
            for line in (invoice.lines or []) if isinstance(line, dict)
        ]
    return {
        "item": quote.item,
        "amount_cents": quote.amount_cents,
        "description": quote.description,
        "period_start": _iso(quote.period_start),
        "covers_until": _iso(quote.covers_until),
        "lines": lines,
        "next_charge_at": _iso(quote.next_charge_at),
        "next_charge_cents": quote.next_charge_cents,
        "note": quote.note,
    }


def _invoice_part(label: str, amount_cents: int, start: str | None, end: str | None) -> dict:
    return {"label": label, "amount_cents": int(amount_cents or 0), "start": start, "end": end}


@router.post("/{org_id}/checkout")
async def api_checkout(
    org_id: int,
    body: CheckoutBody,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    if not await is_allowed_return_url(body.return_url, db_session):
        raise HTTPException(status_code=400, detail="Invalid return_url")
    account = await accounts.ensure_account(org_id, db_session)
    email = account.billing_email or actor.email
    if not email:
        raise HTTPException(status_code=400, detail="Add a billing email first.")
    return await engine.create_checkout(
        org_id, body.item, user_id=actor.user_id, email=email,
        return_url=body.return_url, save_card=body.save_card,
        idempotency_key=body.idempotency_key, db=db_session,
    )


@router.post("/{org_id}/purchase")
async def api_purchase(
    org_id: int,
    body: PurchaseBody,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    if body.pay_with == "wallet":
        return await engine.purchase_with_wallet(
            org_id, body.item, user_id=actor.user_id,
            idempotency_key=body.idempotency_key, db=db_session,
        )
    if body.payment_method_id is None:
        raise HTTPException(status_code=400, detail="payment_method_id is required")
    account = await accounts.ensure_account(org_id, db_session)
    email = account.billing_email or actor.email
    if not email:
        raise HTTPException(status_code=400, detail="Add a billing email first.")
    return await engine.purchase_with_card(
        org_id, body.item, payment_method_id=body.payment_method_id,
        user_id=actor.user_id, email=email, idempotency_key=body.idempotency_key,
        db=db_session,
    )


@router.post("/{org_id}/verify/{reference}")
async def api_verify(
    org_id: int,
    reference: str,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Called when the payer returns from Paystack; the webhook does the same
    work, whichever arrives first grants and the other finds it done."""
    owner = (
        await db_session.execute(
            select(PaymentAttempt.org_id).where(PaymentAttempt.reference == reference)
        )
    ).scalars().first()
    if owner is None or int(owner) != org_id:
        raise HTTPException(status_code=404, detail="Payment not found")
    engine.require_billing()
    return await engine.complete_payment(reference, db_session)


@router.post("/{org_id}/plan/schedule")
async def api_schedule_plan(
    org_id: int,
    body: PlanChangeBody,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await engine.schedule_plan_change(org_id, body.plan, body.cycle, db_session)


@router.delete("/{org_id}/plan/schedule")
async def api_cancel_scheduled_plan(
    org_id: int,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    await engine.cancel_scheduled_change(org_id, db_session)
    return {"status": "ok"}


@router.delete("/{org_id}/addons/{addon_id}")
async def api_end_addon(
    org_id: int,
    addon_id: int,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Stop an add-on at the end of what is already paid for (no refund)."""
    addon = (
        await db_session.execute(
            select(OrgAddon).where(OrgAddon.id == addon_id, OrgAddon.org_id == org_id)
        )
    ).scalars().first()
    if addon is None:
        raise HTTPException(status_code=404, detail="Add-on not found")
    state = await accounts.plan_state(org_id, db_session)
    now = utcnow()
    if addon.addon == "extra_seat" and state.cycle == pricing.YEARLY and state.period_end:
        ends = state.period_end
    else:
        ends = pricing.next_month_start(now)
    addon.ends_at = ends
    db_session.add(addon)
    await db_session.commit()
    grants.invalidate_org_billing_caches(org_id)
    return {"status": "ending", "ends_at": _iso(ends)}


# ── Cards ─────────────────────────────────────────────────────────────────────

@router.get("/{org_id}/cards")
async def api_cards(
    org_id: int,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await engine.list_cards(org_id, db_session)


@router.put("/{org_id}/cards/{method_id}/default")
async def api_default_card(
    org_id: int,
    method_id: int,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    await engine.set_default_card(org_id, method_id, db_session)
    return {"status": "ok"}


@router.delete("/{org_id}/cards/{method_id}")
async def api_delete_card(
    org_id: int,
    method_id: int,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    await engine.delete_card(org_id, method_id, db_session)
    return {"status": "ok"}


# ── History & settings ───────────────────────────────────────────────────────

@router.get("/{org_id}/invoices")
async def api_invoices(
    org_id: int,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    rows = (
        await db_session.execute(
            select(Invoice).where(Invoice.org_id == org_id).order_by(Invoice.created_at.desc()).limit(120)
        )
    ).scalars().all()
    return [_invoice_view(i) for i in rows]


@router.get("/{org_id}/ledger")
async def api_ledger(
    org_id: int,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    rows = (
        await db_session.execute(
            select(LedgerEntry)
            .where(LedgerEntry.org_id == org_id)
            .order_by(LedgerEntry.id.desc())
            .limit(200)
        )
    ).scalars().all()
    return [
        {
            "id": r.id, "amount_cents": r.amount_cents, "kind": r.kind,
            "ref_type": r.ref_type, "ref_id": r.ref_id,
            "balance_after_cents": r.balance_after_cents, "created_at": _iso(r.created_at),
        }
        for r in rows
    ]


@router.put("/{org_id}/settings")
async def api_settings(
    org_id: int,
    body: SettingsBody,
    actor: BillingActor = Depends(require_billing_admin),
    db_session: AsyncSession = Depends(get_db_session),
):
    account = await accounts.ensure_account(org_id, db_session, lock=True)
    if body.clear_spending_limit:
        account.spending_limit_cents = None
    elif body.spending_limit_cents is not None:
        account.spending_limit_cents = body.spending_limit_cents
    if body.auto_add_seats is not None:
        account.auto_add_seats = body.auto_add_seats
    if body.billing_email is not None:
        email = body.billing_email.strip()
        if email and not _EMAIL.match(email):
            raise HTTPException(status_code=400, detail="Invalid billing email")
        account.billing_email = email or None
    account.updated_at = utcnow()
    db_session.add(account)
    await db_session.commit()
    return {"status": "ok"}
