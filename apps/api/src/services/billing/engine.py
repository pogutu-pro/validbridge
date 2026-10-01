"""
Platform billing engine (pricing-implementation.md W3): the school pays
ValidBridge for its plan, add-ons, packs and invoices through ValidBridge's own
Paystack account.

One rule keeps money safe: **every payment completes through
``complete_payment``**, whether the browser comes back from Paystack, the
webhook arrives, a saved card is charged or the reconciler finds a missed
webhook. It re-verifies the transaction with Paystack, locks the
``payment_attempt`` row, checks amount and currency against what was quoted,
and flips the attempt from ``pending`` to ``success`` exactly once — so the
grant runs once however many of those paths fire.

Amounts are integer KES cents, computed on the server from the catalogue
(``pricing.py``). Card numbers never reach us: only Paystack's reusable
``authorization_code``, encrypted.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.billing_flags import (
    billing_enabled,
    platform_paystack_public_key,
    platform_paystack_secret_key,
)
from src.db.billing import (
    BillingPurchase,
    Invoice,
    PaymentAttempt,
    PaymentMethod,
    PaystackEvent,
)
from src.db.billing._common import utcnow
from src.security.features_utils import limit_errors
from src.security.features_utils.entitlements import get_active_catalog
from src.security.secret_crypto import encrypt_secret, resolve_secret
from src.services.billing import accounts, grants, pricing
from src.services.payments import paystack

logger = logging.getLogger(__name__)

CURRENCY = "KES"
RECONCILE_AFTER = timedelta(minutes=15)
RECONCILE_WINDOW = timedelta(days=3)

# Ledger ref_type for purchases that count toward the spending limit.
OVERAGE = "overage"

# Paystack statuses that mean the payer still has a step to complete.
_ACTION_REQUIRED = {
    "send_otp", "send_pin", "send_phone", "send_birthday", "send_address",
    "open_url", "pay_offline", "pending", "ongoing",
}
_TERMINAL_FAILURES = {"failed", "abandoned", "reversed"}


# ── Guards ───────────────────────────────────────────────────────────────────

def require_billing() -> str:
    """The platform secret key, or 503 when billing is switched off."""
    if not billing_enabled():
        raise HTTPException(status_code=503, detail="Billing is not enabled yet.")
    secret = platform_paystack_secret_key()
    if not secret:
        raise HTTPException(status_code=503, detail="Payments are not configured.")
    return secret


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def new_reference(prefix: str, org_id: int) -> str:
    return f"{prefix}_{org_id}_{uuid.uuid4().hex[:20]}"


def reference_org_id(reference: str) -> int | None:
    parts = (reference or "").split("_")
    if len(parts) >= 3 and parts[0] in ("vbp", "vbw", "vbc", "vbi"):
        try:
            return int(parts[1])
        except ValueError:
            return None
    return None


def _counts_toward_limit(item: dict) -> bool:
    return item.get("type") in ("pack", "addon")


# ── Quotes ───────────────────────────────────────────────────────────────────

async def _open_invoice(org_id: int, invoice_id: Any, db: AsyncSession) -> Invoice:
    try:
        invoice_id = int(invoice_id)
    except (TypeError, ValueError):
        raise _bad_request("invoice_id must be a number")
    invoice = (
        await db.execute(
            select(Invoice).where(Invoice.id == invoice_id, Invoice.org_id == org_id)
        )
    ).scalars().first()
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status not in ("open", "failed"):
        raise HTTPException(status_code=409, detail="This invoice is not awaiting payment.")
    return invoice


async def build_quote(
    org_id: int, item: dict, db: AsyncSession
) -> tuple[pricing.Quote, Invoice | None]:
    """Price ``item`` for the org. Invoices are priced from the DB."""
    if isinstance(item, dict) and item.get("type") == "invoice":
        invoice = await _open_invoice(org_id, item.get("invoice_id"), db)
        return (
            pricing.Quote(
                {"type": "invoice", "invoice_id": invoice.id},
                int(invoice.total_cents),
                f"Invoice {invoice.number}",
            ),
            invoice,
        )
    _, catalog = await get_active_catalog(db)
    state = await accounts.plan_state(org_id, db)
    try:
        return pricing.quote(catalog, state, item, utcnow()), None
    except pricing.PricingError as exc:
        raise _bad_request(str(exc))


async def _check_can_buy(
    account, quote: pricing.Quote, db: AsyncSession
) -> None:
    """Refuse purchases a paused account or the spending limit forbids."""
    kind = quote.item.get("type")
    if account.status == "paused" and kind not in ("invoice", "wallet_topup"):
        raise limit_errors.limit_error(limit_errors.BILLING_PAUSED)
    if _counts_toward_limit(quote.item) and not await accounts.within_spending_limit(
        account, quote.amount_cents, db
    ):
        raise limit_errors.limit_error(limit_errors.SPENDING_LIMIT_REACHED)


async def _existing_attempt(
    org_id: int, idempotency_key: str | None, db: AsyncSession
) -> PaymentAttempt | None:
    if not idempotency_key:
        return None
    return (
        await db.execute(
            select(PaymentAttempt).where(
                PaymentAttempt.org_id == org_id,
                PaymentAttempt.idempotency_key == idempotency_key,
            )
        )
    ).scalars().first()


async def _replay(attempt: PaymentAttempt, db: AsyncSession) -> dict:
    """The response for a request whose idempotency key was already used."""
    purchase = await db.get(BillingPurchase, attempt.reference)
    return {
        "status": "paid" if attempt.status == "success" else attempt.status,
        "reference": attempt.reference,
        "amount_cents": int(attempt.amount_cents),
        "authorization_url": purchase.checkout_url if purchase else None,
        "replayed": True,
    }


async def _record_attempt(
    org_id: int,
    quote: pricing.Quote,
    *,
    prefix: str,
    user_id: int | None,
    idempotency_key: str | None,
    save_card: bool,
    invoice: Invoice | None,
    db: AsyncSession,
    status: str = "pending",
) -> PaymentAttempt:
    reference = new_reference(prefix, org_id)
    attempt = PaymentAttempt(
        reference=reference,
        org_id=org_id,
        purpose=str(quote.item.get("type")),
        amount_cents=int(quote.amount_cents),
        currency=CURRENCY,
        status=status,
        idempotency_key=idempotency_key,
        created_by=user_id or None,
    )
    db.add(attempt)
    await db.flush()
    db.add(
        BillingPurchase(
            reference=reference,
            org_id=org_id,
            item=quote.item,
            description=quote.description[:255],
            period_start=quote.period_start,
            covers_until=quote.covers_until,
            save_card=bool(save_card),
            invoice_id=invoice.id if invoice is not None else None,
        )
    )
    await db.flush()
    return attempt


# ── Checkout (Paystack hosted page: card, M-Pesa, bank) ──────────────────────

async def create_checkout(
    org_id: int,
    item: dict,
    *,
    user_id: int,
    email: str,
    return_url: str,
    save_card: bool,
    idempotency_key: str | None,
    db: AsyncSession,
) -> dict:
    secret = require_billing()
    existing = await _existing_attempt(org_id, idempotency_key, db)
    if existing is not None:
        return await _replay(existing, db)

    account = await accounts.ensure_account(org_id, db, lock=True)
    quote, invoice = await build_quote(org_id, item, db)
    await _check_can_buy(account, quote, db)

    if quote.amount_cents <= 0:
        # Fully covered by credit (e.g. the rest of a paid period): no charge.
        attempt = await _record_attempt(
            org_id, quote, prefix="vbc", user_id=user_id, idempotency_key=idempotency_key,
            save_card=False, invoice=invoice, db=db, status="success",
        )
        await grants.apply_grant(
            org_id, quote.item, db, covers_until=quote.covers_until,
            period_start=quote.period_start, invoice=invoice, paid_via="credit",
        )
        await db.commit()
        grants.invalidate_org_billing_caches(org_id)
        return {"status": "paid", "reference": attempt.reference, "amount_cents": 0}

    try:
        attempt = await _record_attempt(
            org_id, quote, prefix="vbp", user_id=user_id, idempotency_key=idempotency_key,
            save_card=save_card, invoice=invoice, db=db,
        )
    except IntegrityError:
        await db.rollback()
        existing = await _existing_attempt(org_id, idempotency_key, db)
        if existing is not None:
            return await _replay(existing, db)
        raise
    reference, attempt_id = attempt.reference, attempt.id
    # Commit before Paystack knows the reference: a payment must never exist
    # at Paystack without its attempt row here, or it could not be granted.
    await db.commit()

    try:
        session = await paystack.initialize_transaction_cents(
            secret,
            email=email,
            amount_cents=quote.amount_cents,
            currency=CURRENCY,
            reference=reference,
            callback_url=_with_reference(return_url, reference),
            metadata={"purpose": "platform_billing", "org_id": org_id, "reference": reference},
        )
    except Exception:
        logger.exception("Paystack initialize failed for %s", reference)
        attempt = await db.get(PaymentAttempt, attempt_id)
        attempt.status = "failed"
        attempt.paystack_status = "initialize_failed"
        attempt.updated_at = utcnow()
        db.add(attempt)
        await db.commit()
        raise HTTPException(status_code=502, detail="Could not start the payment. Please try again.")

    purchase = await db.get(BillingPurchase, reference)
    if purchase is not None:
        purchase.checkout_url = session["authorization_url"]
        db.add(purchase)
        await db.commit()
    return {
        "status": "pending",
        "reference": reference,
        "amount_cents": int(quote.amount_cents),
        "description": quote.description,
        "authorization_url": session["authorization_url"],
        "access_code": session.get("access_code"),
        "public_key": platform_paystack_public_key(),
    }


def _with_reference(url: str, reference: str) -> str:
    joiner = "&" if "?" in url else "?"
    return f"{url}{joiner}billing_reference={reference}"


# ── Completion (the only place a card/M-Pesa payment is granted) ─────────────

def _verified_matches(attempt: PaymentAttempt, data: dict) -> str | None:
    """Why a verified transaction must not be granted, or None if it may."""
    if str(data.get("reference") or "") != attempt.reference:
        return "reference_mismatch"
    if int(data.get("amount") or -1) != int(attempt.amount_cents):
        return "amount_mismatch"
    if str(data.get("currency") or "").upper() != (attempt.currency or CURRENCY).upper():
        return "currency_mismatch"
    return None


async def complete_payment(
    reference: str, db: AsyncSession, *, verified: dict | None = None
) -> dict:
    """Verify ``reference`` with Paystack and grant it exactly once.

    ``verified`` may carry transaction data the caller already fetched from
    Paystack's verify endpoint (never data from a webhook body)."""
    attempt = (
        await db.execute(
            select(PaymentAttempt)
            .where(PaymentAttempt.reference == reference)
            .with_for_update()
        )
    ).scalars().first()
    if attempt is None:
        return {"status": "unknown", "reference": reference}
    if attempt.status == "success":
        return {"status": "paid", "reference": reference}
    if attempt.status in ("failed", "refunded"):
        return {"status": attempt.status, "reference": reference}

    data = verified
    if data is None:
        secret = platform_paystack_secret_key()
        if not secret:
            raise HTTPException(status_code=503, detail="Payments are not configured.")
        try:
            data = await paystack.verify_transaction(secret, reference)
        except Exception:
            logger.warning("Paystack verify failed for %s", reference, exc_info=True)
            return {"status": "pending", "reference": reference}
    if not data:
        return {"status": "pending", "reference": reference}

    tx_status = str(data.get("status") or "")
    now = utcnow()
    if tx_status in _TERMINAL_FAILURES:
        attempt.status = "failed"
        attempt.paystack_status = tx_status
        attempt.updated_at = now
        db.add(attempt)
        await db.commit()
        return {"status": "failed", "reference": reference}
    if tx_status != "success":
        return {"status": "pending", "reference": reference}

    problem = _verified_matches(attempt, data)
    if problem is not None:
        logger.error(
            "BILLING ALERT: %s for %s (org %s): paid %s %s, expected %s %s",
            problem, reference, attempt.org_id, data.get("amount"), data.get("currency"),
            attempt.amount_cents, attempt.currency,
        )
        attempt.status = "failed"
        attempt.paystack_status = problem
        attempt.updated_at = now
        db.add(attempt)
        await db.commit()
        return {"status": "failed", "reference": reference, "reason": problem}

    org_id = attempt.org_id
    account = await accounts.ensure_account(org_id, db, lock=True)
    purchase = await db.get(BillingPurchase, reference)
    item = purchase.item if purchase else {"type": attempt.purpose}
    invoice = await db.get(Invoice, purchase.invoice_id) if purchase and purchase.invoice_id else None

    attempt.status = "success"
    attempt.paystack_status = tx_status
    attempt.raw_hash = hashlib.sha256(
        json.dumps(data, sort_keys=True, default=str).encode()
    ).hexdigest()
    attempt.updated_at = now
    db.add(attempt)

    amount = int(attempt.amount_cents)
    await accounts.append_ledger(
        org_id, amount, "topup", db, ref_type="payment", ref_id=reference,
        actor_id=attempt.created_by,
    )
    if item.get("type") != "wallet_topup":
        await accounts.append_ledger(
            org_id, -amount, "charge", db,
            ref_type=OVERAGE if _counts_toward_limit(item) else item.get("type"),
            ref_id=reference, actor_id=attempt.created_by,
        )
    await grants.apply_grant(
        org_id, item, db,
        covers_until=purchase.covers_until if purchase else None,
        period_start=purchase.period_start if purchase else None,
        invoice=invoice,
        paid_via=str(data.get("channel") or "card"),
    )

    customer_code = (data.get("customer") or {}).get("customer_code")
    if customer_code and not account.paystack_customer_code:
        account.paystack_customer_code = customer_code
        db.add(account)
    if purchase is not None and purchase.save_card:
        await _save_card(org_id, data, attempt.created_by, db)

    await db.commit()
    grants.invalidate_org_billing_caches(org_id)
    logger.info("Billing payment %s granted for org %s (%s)", reference, org_id, item.get("type"))
    return {"status": "paid", "reference": reference}


# ── Wallet ────────────────────────────────────────────────────────────────────

async def purchase_with_wallet(
    org_id: int,
    item: dict,
    *,
    user_id: int,
    idempotency_key: str | None,
    db: AsyncSession,
) -> dict:
    require_billing()
    existing = await _existing_attempt(org_id, idempotency_key, db)
    if existing is not None:
        return await _replay(existing, db)

    account = await accounts.ensure_account(org_id, db, lock=True)
    quote, invoice = await build_quote(org_id, item, db)
    if quote.item.get("type") == "wallet_topup":
        raise _bad_request("Top up the wallet with a card or M-Pesa.")
    await _check_can_buy(account, quote, db)
    balance = await accounts.wallet_balance(org_id, db)
    if balance < quote.amount_cents:
        raise HTTPException(
            status_code=402,
            detail={
                "error_code": "wallet_insufficient",
                "message": "Your wallet balance is too low for this purchase.",
                "balance_cents": balance,
                "amount_cents": quote.amount_cents,
                "options": ["topup", "pay_with_card"],
            },
        )

    attempt = await _record_attempt(
        org_id, quote, prefix="vbw", user_id=user_id, idempotency_key=idempotency_key,
        save_card=False, invoice=invoice, db=db, status="success",
    )
    await accounts.append_ledger(
        org_id, -quote.amount_cents, "charge", db,
        ref_type=OVERAGE if _counts_toward_limit(quote.item) else quote.item.get("type"),
        ref_id=attempt.reference, actor_id=user_id,
    )
    await grants.apply_grant(
        org_id, quote.item, db, covers_until=quote.covers_until,
        period_start=quote.period_start, invoice=invoice, paid_via="wallet",
    )
    await db.commit()
    grants.invalidate_org_billing_caches(org_id)
    return {"status": "paid", "reference": attempt.reference, "amount_cents": quote.amount_cents}


# ── Saved cards ───────────────────────────────────────────────────────────────

async def _save_card(org_id: int, data: dict, user_id: int | None, db: AsyncSession) -> None:
    auth = data.get("authorization") or {}
    if data.get("channel") != "card" or not auth.get("reusable"):
        return
    code, signature = auth.get("authorization_code"), auth.get("signature")
    if not code or not signature:
        return
    existing = (
        await db.execute(
            select(PaymentMethod).where(
                PaymentMethod.org_id == org_id, PaymentMethod.signature == signature
            )
        )
    ).scalars().first()
    has_default = (
        await db.execute(
            select(PaymentMethod.id).where(
                PaymentMethod.org_id == org_id, PaymentMethod.is_default.is_(True)
            )
        )
    ).scalars().first() is not None
    method = existing or PaymentMethod(org_id=org_id, signature=signature, created_by=user_id)
    method.auth_code_enc = encrypt_secret(code)
    method.brand = (auth.get("card_type") or auth.get("brand") or "")[:32] or None
    method.last4 = (auth.get("last4") or "")[:4] or None
    method.exp_month = _int_or_none(auth.get("exp_month"))
    method.exp_year = _int_or_none(auth.get("exp_year"))
    method.bank = (auth.get("bank") or "")[:128] or None
    method.channel = "card"
    method.reusable = True
    if existing is None and not has_default:
        method.is_default = True
    db.add(method)


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def card_view(method: PaymentMethod) -> dict:
    """What the browser may see about a card (never the authorization code)."""
    return {
        "id": method.id,
        "brand": method.brand,
        "last4": method.last4,
        "exp_month": method.exp_month,
        "exp_year": method.exp_year,
        "bank": method.bank,
        "is_default": bool(method.is_default),
    }


async def list_cards(org_id: int, db: AsyncSession) -> list[dict]:
    rows = (
        await db.execute(
            select(PaymentMethod)
            .where(PaymentMethod.org_id == org_id)
            .order_by(PaymentMethod.is_default.desc(), PaymentMethod.id.desc())
        )
    ).scalars().all()
    return [card_view(m) for m in rows]


async def _card(org_id: int, method_id: int, db: AsyncSession) -> PaymentMethod:
    method = (
        await db.execute(
            select(PaymentMethod).where(
                PaymentMethod.id == method_id, PaymentMethod.org_id == org_id
            )
        )
    ).scalars().first()
    if method is None:
        raise HTTPException(status_code=404, detail="Card not found")
    return method


async def set_default_card(org_id: int, method_id: int, db: AsyncSession) -> None:
    target = await _card(org_id, method_id, db)
    for method in (
        await db.execute(select(PaymentMethod).where(PaymentMethod.org_id == org_id))
    ).scalars().all():
        method.is_default = method.id == target.id
        db.add(method)
    await db.commit()


async def delete_card(org_id: int, method_id: int, db: AsyncSession) -> None:
    """Forget a card: our encrypted token is deleted, so it can't be charged."""
    method = await _card(org_id, method_id, db)
    was_default = method.is_default
    await db.delete(method)
    await db.flush()
    if was_default:
        nxt = (
            await db.execute(
                select(PaymentMethod)
                .where(PaymentMethod.org_id == org_id)
                .order_by(PaymentMethod.id.desc())
            )
        ).scalars().first()
        if nxt is not None:
            nxt.is_default = True
            db.add(nxt)
    await db.commit()


async def default_card(org_id: int, db: AsyncSession) -> PaymentMethod | None:
    return (
        await db.execute(
            select(PaymentMethod).where(
                PaymentMethod.org_id == org_id, PaymentMethod.is_default.is_(True)
            )
        )
    ).scalars().first()


async def charge_card(
    org_id: int,
    quote: pricing.Quote,
    method: PaymentMethod,
    *,
    email: str,
    user_id: int | None,
    idempotency_key: str | None,
    invoice: Invoice | None,
    db: AsyncSession,
    prefix: str = "vbp",
) -> dict:
    """Charge a saved card for an already-validated quote."""
    secret = require_billing()
    attempt = await _record_attempt(
        org_id, quote, prefix=prefix, user_id=user_id, idempotency_key=idempotency_key,
        save_card=False, invoice=invoice, db=db,
    )
    reference = attempt.reference
    code = resolve_secret(method.auth_code_enc)
    await db.commit()
    try:
        data = await paystack.charge_authorization(
            secret,
            authorization_code=code,
            email=email,
            amount_cents=quote.amount_cents,
            currency=CURRENCY,
            reference=reference,
            metadata={"purpose": "platform_billing", "org_id": org_id, "reference": reference},
        )
    except Exception:
        logger.warning("charge_authorization errored for %s", reference, exc_info=True)
        # Unknown outcome: leave it pending; the reconciler verifies it later.
        return {"status": "pending", "reference": reference}

    status = str(data.get("status") or "failed")
    if status == "success":
        # Re-verify through the one completion path rather than trusting this body.
        return await complete_payment(reference, db)
    if status in _ACTION_REQUIRED:
        return {"status": "action_required", "reference": reference, "paystack_status": status}
    attempt = (
        await db.execute(select(PaymentAttempt).where(PaymentAttempt.reference == reference))
    ).scalars().first()
    attempt.status = "failed"
    attempt.paystack_status = status[:32]
    attempt.updated_at = utcnow()
    db.add(attempt)
    await db.commit()
    return {
        "status": "failed",
        "reference": reference,
        "message": data.get("gateway_response") or "The card was declined.",
    }


async def purchase_with_card(
    org_id: int,
    item: dict,
    *,
    payment_method_id: int,
    user_id: int,
    email: str,
    idempotency_key: str | None,
    db: AsyncSession,
) -> dict:
    require_billing()
    existing = await _existing_attempt(org_id, idempotency_key, db)
    if existing is not None:
        return await _replay(existing, db)
    account = await accounts.ensure_account(org_id, db, lock=True)
    quote, invoice = await build_quote(org_id, item, db)
    await _check_can_buy(account, quote, db)
    if quote.amount_cents <= 0:
        raise _bad_request("Nothing to charge.")
    method = await _card(org_id, payment_method_id, db)
    return await charge_card(
        org_id, quote, method, email=email, user_id=user_id,
        idempotency_key=idempotency_key, invoice=invoice, db=db,
    )


# ── Plan changes that cost nothing now ───────────────────────────────────────

async def schedule_plan_change(
    org_id: int, plan: str, cycle: str, db: AsyncSession
) -> dict:
    """Downgrades and cancellations. They take effect when the paid period
    ends; nothing already paid for is taken away and nothing is deleted."""
    require_billing()
    _, catalog = await get_active_catalog(db)
    try:
        cfg = pricing.plan_config(catalog, plan)
    except pricing.PricingError as exc:
        raise _bad_request(str(exc))
    if cycle not in pricing.CYCLES:
        raise _bad_request("cycle must be 'monthly' or 'yearly'")
    if plan in ("public-education", "enterprise") or (
        cfg.get("price_cents") and not cfg.get("self_serve")
    ):
        raise _bad_request(f"The {cfg.get('label', plan)} plan can't be chosen here.")
    state = await accounts.plan_state(org_id, db)
    if pricing.is_upgrade(catalog, state, plan, cycle):
        raise _bad_request("That is an upgrade; it is paid through checkout.")
    if plan == state.plan and cycle == state.cycle:
        raise _bad_request("You are already on this plan.")

    await accounts.ensure_account(org_id, db, lock=True)
    sub = await accounts.get_subscription(org_id, db)
    end = pricing.aware(sub.period_end) if sub else None
    if sub is None or end is None or end <= utcnow() or sub.plan != state.plan:
        # Nothing paid is running: switch now.
        await grants.grant_plan(org_id, plan, cycle, None, None, db)
        await db.commit()
        grants.invalidate_org_billing_caches(org_id)
        return {"status": "changed", "plan": plan, "cycle": cycle}

    sub.pending_plan = plan
    sub.pending_cycle = cycle
    sub.updated_at = utcnow()
    db.add(sub)
    await db.commit()
    return {"status": "scheduled", "plan": plan, "cycle": cycle, "effective_at": end.isoformat()}


async def cancel_scheduled_change(org_id: int, db: AsyncSession) -> None:
    sub = await accounts.get_subscription(org_id, db)
    if sub is not None and sub.pending_plan:
        sub.pending_plan = None
        sub.pending_cycle = None
        sub.updated_at = utcnow()
        db.add(sub)
        await db.commit()


# ── Webhook ───────────────────────────────────────────────────────────────────

def _event_key(event: str, data: dict) -> str:
    object_id = data.get("id") or data.get("reference") or data.get("transaction_reference") or ""
    return f"{event}:{object_id}:{data.get('status') or ''}"


async def handle_platform_webhook(
    raw_body: bytes, signature: str | None, db: AsyncSession
) -> dict:
    """Paystack → ValidBridge for the platform account. The body is only a
    hint: grants go through ``complete_payment``, which re-verifies."""
    secret = platform_paystack_secret_key()
    if not secret:
        raise HTTPException(status_code=503, detail="Payments are not configured.")
    if not paystack.verify_webhook_signature(secret, raw_body, signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    try:
        body = json.loads(raw_body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid webhook body")

    event = str(body.get("event") or "")
    data = body.get("data") or {}
    reference = (
        data.get("reference")
        or data.get("transaction_reference")
        or (data.get("transaction") or {}).get("reference")
    )
    if reference_org_id(reference or "") is None:
        # Not one of ours (course sales use their own keys and endpoint).
        return {"result": "ignored"}

    key = _event_key(event, data)
    if (
        await db.execute(select(PaystackEvent.id).where(PaystackEvent.event_id == key))
    ).scalars().first() is not None:
        return {"result": "duplicate"}
    row = PaystackEvent(event_id=key[:128], type=event[:64], reference=reference)
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return {"result": "duplicate"}

    result: dict = {"result": event}
    if event == "charge.success":
        result = await complete_payment(reference, db)
    elif event in ("refund.processed", "charge.refunded"):
        await _record_refund(reference, data, db)
    elif event.startswith("charge.dispute"):
        logger.error("BILLING ALERT: dispute %s on %s", event, reference)
        attempt = (
            await db.execute(select(PaymentAttempt).where(PaymentAttempt.reference == reference))
        ).scalars().first()
        if attempt is not None:
            attempt.paystack_status = "disputed"
            attempt.updated_at = utcnow()
            db.add(attempt)
            await db.commit()

    row = (
        await db.execute(select(PaystackEvent).where(PaystackEvent.event_id == key[:128]))
    ).scalars().first()
    if row is not None:
        row.processed_at = utcnow()
        db.add(row)
        await db.commit()
    return result


async def _record_refund(reference: str, data: dict, db: AsyncSession) -> None:
    """A refund left our Paystack balance: keep the wallet ledger truthful."""
    attempt = (
        await db.execute(
            select(PaymentAttempt).where(PaymentAttempt.reference == reference).with_for_update()
        )
    ).scalars().first()
    if attempt is None or attempt.status != "success":
        return
    amount = int(data.get("amount") or attempt.amount_cents)
    amount = min(amount, int(attempt.amount_cents))
    await accounts.ensure_account(attempt.org_id, db, lock=True)
    purchase = await db.get(BillingPurchase, reference)
    kind = (purchase.item if purchase else {}).get("type")
    if kind == "wallet_topup":
        # The refunded money was wallet balance, so the balance goes down.
        # A refunded purchase was paid in and spent in one step and never
        # touched the balance, so it needs no ledger entry.
        await accounts.append_ledger(
            attempt.org_id, -amount, "refund", db, ref_type="payment", ref_id=reference
        )
    if amount >= int(attempt.amount_cents):
        attempt.status = "refunded"
    attempt.paystack_status = "refunded"
    attempt.updated_at = utcnow()
    db.add(attempt)
    await db.commit()
    logger.warning(
        "BILLING ALERT: refund of %s cents on %s (org %s, %s); review the grant.",
        amount, reference, attempt.org_id, kind,
    )


# ── Reconciler ────────────────────────────────────────────────────────────────

async def reconcile_pending(db: AsyncSession) -> dict:
    """Finish payments whose webhook never arrived (runs hourly)."""
    if not billing_enabled() or not platform_paystack_secret_key():
        return {"checked": 0}
    now = utcnow()
    references = (
        await db.execute(
            select(PaymentAttempt.reference).where(
                PaymentAttempt.status == "pending",
                PaymentAttempt.created_at <= now - RECONCILE_AFTER,
                PaymentAttempt.created_at >= now - RECONCILE_WINDOW,
            )
        )
    ).scalars().all()
    outcomes: dict[str, int] = {}
    for reference in references:
        try:
            result = await complete_payment(reference, db)
        except Exception:
            await db.rollback()
            logger.exception("Reconcile failed for %s", reference)
            continue
        outcomes[result["status"]] = outcomes.get(result["status"], 0) + 1
    # Attempts nobody finished within the window are abandoned.
    for attempt in (
        await db.execute(
            select(PaymentAttempt).where(
                PaymentAttempt.status == "pending",
                PaymentAttempt.created_at < now - RECONCILE_WINDOW,
            )
        )
    ).scalars().all():
        attempt.status = "failed"
        attempt.paystack_status = "expired"
        attempt.updated_at = now
        db.add(attempt)
    await db.commit()
    return {"checked": len(references), **outcomes}
