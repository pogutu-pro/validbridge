"""
Superadmin billing console API (pricing-implementation.md W11).

Reads need a superadmin. Anything that moves money, grants value or changes
what an org is billed needs a signed-in superadmin *session* (not an API
token) and a written reason, and is audit-logged with before/after values.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.billing_flags import ENFORCEMENT_MODES, platform_paystack_secret_key
from src.core.events.database import get_db_session
from src.db.billing import (
    EnforcementFlag,
    Invoice,
    LedgerEntry,
    OrgAddon,
    PackBalance,
    PaymentAttempt,
    PriceCatalog,
)
from src.db.billing._common import utcnow
from src.db.billing.usage import PACK_KINDS
from src.routers.superadmin import _acting_user_id, require_session_superadmin
from src.security.features_utils import entitlements as ent
from src.security.features_utils.entitlements import get_active_catalog
from src.security.superadmin import require_superadmin
from src.services.audit.superadmin_audit import record_superadmin_action
from src.services.billing import accounts, engine, grants, pricing
from src.services.payments import paystack

router = APIRouter()


class Reason(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class AccountBody(Reason):
    exempt: bool | None = None
    status: Literal["active", "past_due", "paused"] | None = None
    enforcement_overrides: dict[str, str] | None = None


class PackGrantBody(Reason):
    kind: str
    units: int = Field(gt=0, le=10_000_000)


class WalletAdjustBody(Reason):
    amount_cents: int = Field(ge=-100_000_000, le=100_000_000)


class RefundBody(Reason):
    reference: str = Field(max_length=100)
    amount_cents: int | None = Field(default=None, gt=0)


class EnforcementBody(Reason):
    modes: dict[str, str]


class CatalogBody(Reason):
    items: dict[str, Any]
    effective_from: datetime | None = None


def _iso(value) -> str | None:
    value = pricing.aware(value)
    return value.isoformat() if value else None


# ── Custom deal: allowances, features, custom price ──────────────────────────

ALLOWANCE_FIELDS = (
    "instructor_seats", "learner_allowance", "storage_bytes", "live_seconds_month",
    "live_concurrency", "premium_ai_credits_month", "code_runs_month", "managed_emails_month",
)
DEAL_FEATURES = ("api", "webhooks", "zapier", "custom_domain", "sso", "managed_email", "remove_badge")
PAYMENT_METHODS = ("bank_transfer", "mpesa", "cash", "cheque", "paystack_other", "other")


class DealBody(Reason):
    # value → agreed number; None → unlimited; "default" → back to the plan's number
    allowances: dict[str, int | None | str] | None = None
    # True → force-enabled for this school; False → back to the plan
    features: dict[str, bool] | None = None
    custom_price_cents: int | None = Field(default=None, ge=0, le=100_000_000_00)
    cycle: Literal["monthly", "yearly"] | None = None
    clear_price: bool = False


async def _org_config_row(org_id: int, db: AsyncSession):
    from src.db.organization_config import OrganizationConfig

    row = (
        await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Organization config not found")
    return row


def deal_view(config: dict) -> dict:
    overrides = (config or {}).get("overrides") or {}
    billing = overrides.get("billing") or {}
    return {
        "allowances": dict(overrides.get("entitlements") or {}),
        "features": {
            f: bool((overrides.get("custom_domains" if f == "custom_domain" else f) or {}).get("force_enabled"))
            for f in DEAL_FEATURES
        },
        "custom_price_cents": billing.get("custom_price_cents"),
        "cycle": billing.get("cycle"),
    }


def _check_modes(modes: dict[str, str]) -> None:
    for metric, mode in modes.items():
        if metric not in ent.ALL_METRICS:
            raise HTTPException(status_code=400, detail=f"Unknown metric '{metric}'")
        if mode not in ENFORCEMENT_MODES:
            raise HTTPException(status_code=400, detail=f"Invalid mode '{mode}'")


# ── Per-org view ─────────────────────────────────────────────────────────────

@router.get("/orgs/{org_id}")
async def api_org_billing(
    org_id: int,
    current_user: Any = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    account = await accounts.ensure_account(org_id, db)
    await db.commit()
    sub = await accounts.get_subscription(org_id, db)
    e = await ent.get_entitlements(org_id, db, use_cache=False)

    def rows(model, order, limit=50):
        return select(model).where(model.org_id == org_id).order_by(order).limit(limit)

    invoices = (await db.execute(rows(Invoice, Invoice.created_at.desc()))).scalars().all()
    attempts = (await db.execute(rows(PaymentAttempt, PaymentAttempt.created_at.desc()))).scalars().all()
    ledger = (await db.execute(rows(LedgerEntry, LedgerEntry.id.desc()))).scalars().all()
    addons = (await db.execute(select(OrgAddon).where(OrgAddon.org_id == org_id))).scalars().all()
    return {
        "account": {
            "status": account.status, "exempt": account.exempt,
            "billing_email": account.billing_email,
            "spending_limit_cents": account.spending_limit_cents,
            "auto_add_seats": account.auto_add_seats,
            "enforcement_overrides": account.enforcement_overrides,
            "override_until": _iso(ent.override_until(account)),
        },
        "subscription": None if sub is None else {
            "plan": sub.plan, "cycle": sub.cycle,
            "period_start": _iso(sub.period_start), "period_end": _iso(sub.period_end),
            "pending_plan": sub.pending_plan, "paused_at": _iso(sub.paused_at),
            "learner_grace_started_at": _iso(sub.learner_grace_started_at),
        },
        "entitlements": {
            "plan": e.plan, "instructor_seats": e.instructor_seats,
            "learner_allowance": e.learner_allowance, "storage_bytes": e.storage_bytes,
            "live_seconds_month": e.live_seconds_month, "live_concurrency": e.live_concurrency,
            "premium_ai_credits_month": e.premium_ai_credits_month,
            "code_runs_month": e.code_runs_month, "features": e.features,
            "packs": e.packs, "exempt": e.exempt,
        },
        "wallet_balance_cents": await accounts.wallet_balance(org_id, db),
        "cards": await engine.list_cards(org_id, db),
        "addons": [
            {"id": a.id, "addon": a.addon, "quantity": a.quantity,
             "started_at": _iso(a.started_at), "ends_at": _iso(a.ends_at)}
            for a in addons
        ],
        "invoices": [
            {"id": i.id, "number": i.number, "period": i.period, "status": i.status,
             "total_cents": i.total_cents, "paid_via": i.paid_via, "lines": i.lines,
             "created_at": _iso(i.created_at)}
            for i in invoices
        ],
        "attempts": [
            {"reference": a.reference, "purpose": a.purpose, "amount_cents": a.amount_cents,
             "status": a.status, "paystack_status": a.paystack_status,
             "created_at": _iso(a.created_at)}
            for a in attempts
        ],
        "ledger": [
            {"id": r.id, "amount_cents": r.amount_cents, "kind": r.kind,
             "ref_type": r.ref_type, "ref_id": r.ref_id,
             "balance_after_cents": r.balance_after_cents, "created_at": _iso(r.created_at)}
            for r in ledger
        ],
    }


# ── Per-org actions (session + reason + audit) ───────────────────────────────

@router.put("/orgs/{org_id}/account")
async def api_update_account(
    org_id: int,
    body: AccountBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    if body.enforcement_overrides is not None:
        _check_modes(body.enforcement_overrides)
    account = await accounts.ensure_account(org_id, db, lock=True)
    before = {"exempt": account.exempt, "status": account.status,
              "enforcement_overrides": dict(account.enforcement_overrides or {})}
    if body.exempt is not None:
        account.exempt = body.exempt
    if body.status is not None:
        account.status = body.status
        sub = await accounts.get_subscription(org_id, db)
        if sub is not None:
            sub.paused_at = utcnow() if body.status == "paused" else None
            db.add(sub)
    if body.enforcement_overrides is not None:
        keep = {
            k: v for k, v in (account.enforcement_overrides or {}).items()
            if k == ent.OVERRIDE_UNTIL_KEY
        }
        account.enforcement_overrides = {**body.enforcement_overrides, **keep}
    account.updated_at = utcnow()
    db.add(account)
    await db.commit()
    grants.invalidate_org_billing_caches(org_id)
    after = {"exempt": account.exempt, "status": account.status,
             "enforcement_overrides": dict(account.enforcement_overrides or {})}
    await record_superadmin_action(
        db, _acting_user_id(current_user), "billing.account", org_id=org_id,
        reason=body.reason, before=before, after=after, request=request, strict=True,
    )
    return {"status": "ok", **after}


class OverrideBody(Reason):
    days: int = Field(ge=1, le=30)
    notify: bool = True


async def _set_override(org_id: int, until, db: AsyncSession):
    account = await accounts.ensure_account(org_id, db, lock=True)
    before = _iso(ent.override_until(account))
    overrides = dict(account.enforcement_overrides or {})
    if until is None:
        overrides.pop(ent.OVERRIDE_UNTIL_KEY, None)
    else:
        overrides[ent.OVERRIDE_UNTIL_KEY] = until.isoformat()
    account.enforcement_overrides = overrides
    account.updated_at = utcnow()
    db.add(account)
    await db.commit()
    grants.invalidate_org_billing_caches(org_id)
    return before


@router.post("/orgs/{org_id}/override")
async def api_override_limits(
    org_id: int,
    body: OverrideBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """Lift every limit (and any billing pause) for ``days`` — e.g. the school
    has paid but the money hasn't reached us yet. Ends by itself; nothing is
    charged or granted. The school's admins are emailed."""
    from datetime import timedelta

    until = utcnow() + timedelta(days=body.days)
    before = await _set_override(org_id, until, db)
    await record_superadmin_action(
        db, _acting_user_id(current_user), "billing.override_limits", org_id=org_id,
        reason=body.reason, before={"override_until": before},
        after={"override_until": until.isoformat()}, request=request, strict=True,
    )
    if body.notify:
        from src.services.billing import notify

        await notify.limits_override(org_id, until, body.reason, db)
    return {"status": "ok", "override_until": until.isoformat()}


@router.delete("/orgs/{org_id}/override")
async def api_end_override(
    org_id: int,
    body: Reason,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    before = await _set_override(org_id, None, db)
    await record_superadmin_action(
        db, _acting_user_id(current_user), "billing.override_end", org_id=org_id,
        reason=body.reason, before={"override_until": before},
        after={"override_until": None}, request=request, diff_only=False, strict=True,
    )
    return {"status": "ok"}


@router.get("/orgs/{org_id}/deal")
async def api_get_deal(
    org_id: int,
    current_user: Any = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    row = await _org_config_row(org_id, db)
    e = await ent.get_entitlements(org_id, db, use_cache=False)
    _, catalog = await get_active_catalog(db)
    plan_cfg = (catalog.get("plans") or {}).get(e.plan) or {}
    return {
        **deal_view(row.config or {}),
        "plan": e.plan,
        "plan_price_cents": plan_cfg.get("price_cents"),
        "effective": {f: getattr(e, f) for f in ALLOWANCE_FIELDS},
    }


@router.put("/orgs/{org_id}/deal")
async def api_set_deal(
    org_id: int,
    body: DealBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """Agree custom terms with a school: allowances above (or below) its plan,
    extra features, and a custom price the monthly cycle then invoices."""
    import copy

    row = await _org_config_row(org_id, db)
    config = copy.deepcopy(row.config or {})
    before = deal_view(config)
    overrides = dict(config.get("overrides") or {})

    if body.allowances is not None:
        allow = dict(overrides.get("entitlements") or {})
        for field, value in body.allowances.items():
            if field not in ALLOWANCE_FIELDS:
                raise HTTPException(status_code=400, detail=f"Unknown allowance '{field}'")
            if value == "default":
                allow.pop(field, None)
            elif value is None:
                allow[field] = None
            elif isinstance(value, int) and value >= 0:
                allow[field] = value
            else:
                raise HTTPException(status_code=400, detail=f"{field} must be a whole number, null or 'default'")
        overrides["entitlements"] = allow

    if body.features is not None:
        for feature, enabled in body.features.items():
            if feature not in DEAL_FEATURES:
                raise HTTPException(status_code=400, detail=f"Unknown feature '{feature}'")
            key = "custom_domains" if feature == "custom_domain" else feature
            entry = dict(overrides.get(key) or {})
            if enabled:
                entry["force_enabled"] = True
            else:
                entry.pop("force_enabled", None)
            overrides[key] = entry

    started_billing = False
    if body.clear_price:
        overrides.pop("billing", None)
    elif body.custom_price_cents is not None:
        cycle = body.cycle or "monthly"
        overrides["billing"] = {"custom_price_cents": body.custom_price_cents, "cycle": cycle}
        # The cycle invoices a plan period only for a school with a
        # subscription; open one that is due now, so the next run bills it.
        plan = await accounts.current_plan(org_id, db)
        sub = await accounts.get_subscription(org_id, db)
        if sub is None or sub.plan != plan:
            from src.db.billing import BillingSubscription

            sub = sub or BillingSubscription(org_id=org_id, plan=plan)
            sub.plan, sub.cycle = plan, cycle
            sub.period_start = sub.period_end = utcnow()
            started_billing = True
        else:
            sub.cycle = cycle
        db.add(sub)

    config["overrides"] = overrides
    row.config = config
    db.add(row)
    await db.commit()
    grants.invalidate_org_billing_caches(org_id)
    after = deal_view(config)
    await record_superadmin_action(
        db, _acting_user_id(current_user), "billing.deal", org_id=org_id, reason=body.reason,
        before=before, after=after, request=request, strict=True,
    )
    return {"status": "ok", **after, "billing_starts_next_run": started_billing}


class MarkPaidBody(Reason):
    method: Literal[PAYMENT_METHODS]  # type: ignore[valid-type]
    payment_reference: str = Field(default="", max_length=128)


class ManualPlanBody(Reason):
    plan: str = Field(max_length=32)
    cycle: Literal["monthly", "yearly"] = "monthly"
    months: int = Field(ge=1, le=36)
    amount_cents: int = Field(ge=0, le=100_000_000_00)
    method: Literal[PAYMENT_METHODS]  # type: ignore[valid-type]
    payment_reference: str = Field(default="", max_length=128)


@router.post("/orgs/{org_id}/invoices/{invoice_id}/mark-paid")
async def api_mark_invoice_paid(
    org_id: int,
    invoice_id: int,
    body: MarkPaidBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """The school paid outside Paystack (bank, M-Pesa, cash…): settle the
    invoice by hand. Extends the paid period and lifts any pause."""
    invoice = (
        await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.org_id == org_id))
    ).scalars().first()
    if invoice is None or invoice.status not in ("open", "failed"):
        raise HTTPException(status_code=404, detail="No unpaid invoice with that id")
    actor = _acting_user_id(current_user)
    await accounts.ensure_account(org_id, db, lock=True)
    ref = f"{invoice.number}:{body.method}:{body.payment_reference}"[:128]
    await accounts.append_ledger(org_id, int(invoice.total_cents), "topup", db,
                                 ref_type="manual_payment", ref_id=ref, actor_id=actor)
    await accounts.append_ledger(org_id, -int(invoice.total_cents), "charge", db,
                                 ref_type="invoice", ref_id=invoice.number, actor_id=actor)
    await grants.mark_invoice_paid(invoice, f"manual:{body.method}"[:32], db)
    await db.commit()
    grants.invalidate_org_billing_caches(org_id)
    await record_superadmin_action(
        db, actor, "billing.mark_paid", org_id=org_id, reason=body.reason,
        before={"invoice": invoice.number, "status": "open"},
        after={"status": "paid", "method": body.method, "reference": body.payment_reference},
        request=request, diff_only=False, strict=True,
    )
    from src.services.billing import notify

    await notify.receipt(invoice, db)
    return {"status": "paid"}


@router.post("/orgs/{org_id}/manual-plan")
async def api_manual_plan(
    org_id: int,
    body: ManualPlanBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """Activate a plan for a period the school paid for outside Paystack.
    Records a paid invoice (their receipt) and the money in the ledger."""
    from datetime import timedelta

    _, catalog = await get_active_catalog(db)
    if body.plan not in (catalog.get("plans") or {}):
        raise HTTPException(status_code=400, detail="Unknown plan")
    actor = _acting_user_id(current_user)
    now = utcnow()
    end = now + timedelta(days=round(30.44 * body.months))
    number = f"VB-M{now:%Y%m%d%H%M%S}-{org_id}"
    label = (catalog["plans"][body.plan] or {}).get("label", body.plan)
    invoice = Invoice(
        org_id=org_id, number=number, period=f"{now:%Y-%m}",
        lines=[{
            "code": "base", "description": f"{label} plan, {body.months} month(s) (paid {body.method})",
            "amount_cents": body.amount_cents,
            "period": {"start": now.isoformat(), "end": end.isoformat(),
                       "plan": body.plan, "cycle": body.cycle},
        }],
        subtotal_cents=body.amount_cents, total_cents=body.amount_cents, tax_cents=0,
        status="open", catalog_version=1, created_at=now, updated_at=now,
    )
    db.add(invoice)
    await db.flush()
    await accounts.ensure_account(org_id, db, lock=True)
    await grants.grant_plan(org_id, body.plan, body.cycle, now, end, db)
    if body.amount_cents:
        ref = f"{number}:{body.method}:{body.payment_reference}"[:128]
        await accounts.append_ledger(org_id, body.amount_cents, "topup", db,
                                     ref_type="manual_payment", ref_id=ref, actor_id=actor)
        await accounts.append_ledger(org_id, -body.amount_cents, "charge", db,
                                     ref_type="plan", ref_id=number, actor_id=actor)
    await grants.mark_invoice_paid(invoice, f"manual:{body.method}"[:32], db)
    await db.commit()
    grants.invalidate_org_billing_caches(org_id)
    await record_superadmin_action(
        db, actor, "billing.manual_plan", org_id=org_id, reason=body.reason,
        after={"plan": body.plan, "cycle": body.cycle, "until": end.isoformat(),
               "amount_cents": body.amount_cents, "method": body.method,
               "reference": body.payment_reference},
        request=request, diff_only=False, strict=True,
    )
    from src.services.billing import notify

    await notify.receipt(invoice, db)
    return {"status": "ok", "plan": body.plan, "until": end.isoformat(), "invoice": number}


@router.post("/orgs/{org_id}/grant-pack")
async def api_grant_pack(
    org_id: int,
    body: PackGrantBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """Give free credits / live seconds / code runs (support, goodwill, deals)."""
    if body.kind not in PACK_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {list(PACK_KINDS)}")
    before = (
        await db.execute(
            select(PackBalance.remaining).where(
                PackBalance.org_id == org_id, PackBalance.kind == body.kind
            )
        )
    ).scalars().first() or 0
    await grants.grant_pack(org_id, body.kind, body.units, db)
    await db.commit()
    grants.invalidate_org_billing_caches(org_id)
    await record_superadmin_action(
        db, _acting_user_id(current_user), "billing.grant_pack", org_id=org_id,
        reason=body.reason, before={body.kind: int(before)},
        after={body.kind: int(before) + body.units}, request=request, strict=True,
    )
    return {"status": "ok", "kind": body.kind, "remaining": int(before) + body.units}


@router.post("/orgs/{org_id}/wallet-adjust")
async def api_wallet_adjust(
    org_id: int,
    body: WalletAdjustBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """Credit or debit the wallet. Corrections are new ledger entries; nothing
    already recorded is edited."""
    if body.amount_cents == 0:
        raise HTTPException(status_code=400, detail="amount_cents must not be zero")
    await accounts.ensure_account(org_id, db, lock=True)
    before = await accounts.wallet_balance(org_id, db)
    if before + body.amount_cents < 0:
        raise HTTPException(status_code=400, detail="This would make the wallet negative")
    actor = _acting_user_id(current_user)
    await accounts.append_ledger(
        org_id, body.amount_cents, "adjustment", db, ref_type="superadmin", actor_id=actor,
    )
    await db.commit()
    await record_superadmin_action(
        db, actor, "billing.wallet_adjust", org_id=org_id, reason=body.reason,
        before={"balance_cents": before},
        after={"balance_cents": before + body.amount_cents}, request=request,
        diff_only=False, strict=True,
    )
    return {"status": "ok", "balance_cents": before + body.amount_cents}


@router.post("/orgs/{org_id}/refund")
async def api_refund(
    org_id: int,
    body: RefundBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """Refund a card/M-Pesa payment through Paystack. The ledger and the
    attempt are updated when Paystack confirms (``refund.processed``)."""
    attempt = (
        await db.execute(
            select(PaymentAttempt).where(
                PaymentAttempt.reference == body.reference, PaymentAttempt.org_id == org_id
            )
        )
    ).scalars().first()
    if attempt is None or attempt.status != "success" or attempt.reference.startswith(("vbw_", "vbc_")):
        raise HTTPException(status_code=404, detail="No refundable Paystack payment with that reference")
    if body.amount_cents is not None and body.amount_cents > attempt.amount_cents:
        raise HTTPException(status_code=400, detail="Refund exceeds the payment")
    secret = platform_paystack_secret_key()
    if not secret:
        raise HTTPException(status_code=503, detail="Payments are not configured.")
    try:
        result = await paystack.refund_transaction(
            secret, reference=attempt.reference, amount_cents=body.amount_cents
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Paystack refused the refund: {exc}")
    await record_superadmin_action(
        db, _acting_user_id(current_user), "billing.refund", org_id=org_id,
        reason=body.reason, before={"reference": attempt.reference,
                                    "amount_cents": attempt.amount_cents},
        after={"refund_cents": body.amount_cents or attempt.amount_cents,
               "paystack_status": result.get("status")},
        request=request, diff_only=False, strict=True,
    )
    return {"status": result.get("status") or "pending"}


@router.post("/orgs/{org_id}/invoices/{invoice_id}/void")
async def api_void_invoice(
    org_id: int,
    invoice_id: int,
    body: Reason,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    invoice = (
        await db.execute(
            select(Invoice).where(Invoice.id == invoice_id, Invoice.org_id == org_id)
        )
    ).scalars().first()
    if invoice is None or invoice.status not in ("open", "failed"):
        raise HTTPException(status_code=404, detail="No unpaid invoice with that id")
    invoice.status = "void"
    invoice.updated_at = utcnow()
    db.add(invoice)
    await db.flush()
    unpaid = (
        await db.execute(
            select(func.count()).select_from(Invoice).where(
                Invoice.org_id == org_id, Invoice.status.in_(("open", "failed"))
            )
        )
    ).scalar_one()
    if not unpaid:
        account = await accounts.ensure_account(org_id, db, lock=True)
        account.status = "active"
        db.add(account)
        sub = await accounts.get_subscription(org_id, db)
        if sub is not None:
            sub.paused_at = None
            db.add(sub)
    await db.commit()
    grants.invalidate_org_billing_caches(org_id)
    await record_superadmin_action(
        db, _acting_user_id(current_user), "billing.void_invoice", org_id=org_id,
        reason=body.reason, before={"number": invoice.number, "status": "open"},
        after={"status": "void"}, request=request, diff_only=False, strict=True,
    )
    return {"status": "void"}


# ── Global ───────────────────────────────────────────────────────────────────

@router.get("/enforcement")
async def api_get_enforcement(
    current_user: Any = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    rows = {f.metric: f.mode for f in (await db.execute(select(EnforcementFlag))).scalars().all()}
    return {
        metric: {
            "mode": await ent.get_enforcement_mode(metric, db),
            "explicit": metric in rows,
        }
        for metric in sorted(ent.ALL_METRICS)
    }


@router.put("/enforcement")
async def api_set_enforcement(
    body: EnforcementBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """The rollout lever (§9): shadow → enforce one metric at a time, and back
    to shadow without a deploy if something misfires."""
    _check_modes(body.modes)
    actor = _acting_user_id(current_user)
    before, after = {}, {}
    for metric, mode in body.modes.items():
        before[metric] = await ent.get_enforcement_mode(metric, db)
        row = await db.get(EnforcementFlag, metric)
        if row is None:
            row = EnforcementFlag(metric=metric)
        row.mode = mode
        row.updated_by = actor or None
        row.updated_at = utcnow()
        db.add(row)
        after[metric] = mode
    await db.commit()
    await record_superadmin_action(
        db, actor, "billing.enforcement", reason=body.reason, before=before, after=after,
        request=request, strict=True,
    )
    return {"status": "ok", "modes": after}


@router.get("/catalog")
async def api_catalog_versions(
    current_user: Any = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    version, items = await get_active_catalog(db)
    rows = (await db.execute(select(PriceCatalog).order_by(PriceCatalog.version.desc()))).scalars().all()
    return {
        "active_version": version,
        "active": items,
        "versions": [
            {"version": r.version, "effective_from": _iso(r.effective_from),
             "created_at": _iso(r.created_at), "created_by": r.created_by}
            for r in rows
        ],
    }


def _validate_catalog(items: dict) -> None:
    plans = items.get("plans")
    if not isinstance(plans, dict) or "starter" not in plans:
        raise HTTPException(status_code=400, detail="catalog needs plans including 'starter'")
    for plan_id, cfg in plans.items():
        price = cfg.get("price_cents") if isinstance(cfg, dict) else None
        if price is not None and (not isinstance(price, int) or price < 0):
            raise HTTPException(status_code=400, detail=f"plans.{plan_id}.price_cents must be a whole number of cents")
    for kind, packs in (items.get("packs") or {}).items():
        for pack in packs:
            if not isinstance(pack.get("price_cents"), int) or pack["price_cents"] <= 0:
                raise HTTPException(status_code=400, detail=f"packs.{kind}: price_cents must be positive cents")


@router.post("/catalog")
async def api_publish_catalog(
    body: CatalogBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """Publish a new catalogue version. Past versions are never edited;
    invoices keep the version they were priced with."""
    _validate_catalog(body.items)
    effective = pricing.aware(body.effective_from) or utcnow()
    if effective < utcnow():
        effective = utcnow()
    current = (await db.execute(select(func.max(PriceCatalog.version)))).scalar_one()
    active_version, _ = await get_active_catalog(db)
    version = max(int(current or 0), int(active_version)) + 1
    items = dict(body.items)
    items["version"] = version
    actor = _acting_user_id(current_user)
    db.add(PriceCatalog(version=version, effective_from=effective, items=items, created_by=actor or None))
    await db.commit()
    await record_superadmin_action(
        db, actor, "billing.catalog_publish", reason=body.reason,
        before={"version": active_version}, after={"version": version,
                                                   "effective_from": effective.isoformat()},
        request=request, diff_only=False, strict=True,
    )
    return {"status": "ok", "version": version, "effective_from": effective.isoformat()}


@router.post("/run-cycle")
async def api_run_cycle(
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    from src.services.billing.cycle import run_cycle

    reconcile = await engine.reconcile_pending(db)
    summary = await run_cycle(db)
    await record_superadmin_action(
        db, _acting_user_id(current_user), "billing.run_cycle",
        after={"reconcile": reconcile, "cycle": summary}, request=request, diff_only=False,
    )
    return {"reconcile": reconcile, "cycle": summary}


@router.get("/report")
async def api_report(
    current_user: Any = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """MRR-style snapshot: paid subscriptions by plan, unpaid invoices, this
    month's collected money."""
    from src.db.billing import BillingSubscription

    by_plan = dict(
        (await db.execute(
            select(BillingSubscription.plan, func.count()).group_by(BillingSubscription.plan)
        )).all()
    )
    unpaid = (await db.execute(
        select(func.count(), func.coalesce(func.sum(Invoice.total_cents), 0))
        .where(Invoice.status.in_(("open", "failed")))
    )).one()
    collected = (await db.execute(
        select(func.coalesce(func.sum(PaymentAttempt.amount_cents), 0)).where(
            PaymentAttempt.status == "success",
            PaymentAttempt.created_at >= pricing.month_start(utcnow()),
            PaymentAttempt.reference.like("vb%"),
            ~PaymentAttempt.reference.like("vbw_%"),
            ~PaymentAttempt.reference.like("vbc_%"),
        )
    )).scalar_one()
    return {
        "subscriptions_by_plan": {k: int(v) for k, v in by_plan.items()},
        "unpaid_invoices": int(unpaid[0]),
        "unpaid_cents": int(unpaid[1]),
        "collected_this_month_cents": int(collected),
    }
