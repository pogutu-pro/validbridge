"""
Platform billing engine (pricing-implementation.md W3).

What must never regress, in order of cost if it did:
  * a payment is granted exactly once, whichever path completes it;
  * a payment whose amount or currency differs from the quote grants nothing;
  * the wallet can't be overspent and its ledger balance stays exact;
  * a webhook without a valid signature does nothing;
  * amounts are computed on the server (proration, yearly discount);
  * unpaid invoices dun, then pause the org to Starter, and paying resumes it.
"""

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.billing import (
    BillingAccount,
    BillingSubscription,
    Invoice,
    LedgerEntry,
    OrgAddon,
    PackBalance,
    PaymentAttempt,
    PaymentMethod,
)
from src.db.organization_config import OrganizationConfig
from src.security.features_utils import entitlements as ent_mod
from src.services.billing import accounts, cycle, engine, notify, pricing
from src.services.billing.catalog_defaults import build_default_catalog, kes

pytestmark = pytest.mark.asyncio

SECRET = "sk_test_platform"
CATALOG = build_default_catalog()


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def billing_env(monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_BILLING_ENABLED", "true")
    monkeypatch.setenv("VALIDBRIDGE_PLATFORM_PAYSTACK_SECRET_KEY", SECRET)
    monkeypatch.setenv("VALIDBRIDGE_PLATFORM_PAYSTACK_PUBLIC_KEY", "pk_test_platform")
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "saas")
    monkeypatch.setattr(ent_mod, "_redis", lambda: None)
    sent = []

    async def _no_email(org_id, subject, body, db):
        sent.append(subject)

    monkeypatch.setattr(notify, "_send", _no_email)
    return sent


@pytest.fixture
async def starter_org(db, org):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "starter"}))
    await db.commit()
    return org


def _paystack(monkeypatch, *, override=None, status="success"):
    """Paystack stub. verify returns what was charged unless ``override`` changes it."""
    calls = {"initialize": 0, "verify": 0, "charge": 0}

    async def initialize(secret, **kw):
        calls["initialize"] += 1
        calls["last_init"] = kw
        return {"authorization_url": "https://checkout.paystack.test/x", "access_code": "ac",
                "reference": kw["reference"]}

    async def verify(secret, reference):
        calls["verify"] += 1
        attempt_amount = calls["amounts"][reference]
        data = {"reference": reference, "status": status, "amount": attempt_amount,
                "currency": "KES", "channel": "card",
                "authorization": {"authorization_code": "AUTH_real", "signature": "SIG_1",
                                  "reusable": True, "last4": "4081", "card_type": "visa",
                                  "exp_month": "12", "exp_year": "2030", "bank": "Test Bank"},
                "customer": {"customer_code": "CUS_1"}}
        data.update(override or {})
        return data

    async def charge_authorization(secret, **kw):
        calls["charge"] += 1
        calls["amounts"][kw["reference"]] = kw["amount_cents"]
        return {"status": status, "reference": kw["reference"]}

    calls["amounts"] = {}
    monkeypatch.setattr(engine.paystack, "initialize_transaction_cents", initialize)
    monkeypatch.setattr(engine.paystack, "verify_transaction", verify)
    monkeypatch.setattr(engine.paystack, "charge_authorization", charge_authorization)
    return calls


async def _checkout(db, org_id, item, calls, **kw):
    result = await engine.create_checkout(
        org_id, item, user_id=None, email="admin@school.test",
        return_url="https://school.test/billing", save_card=kw.pop("save_card", True),
        idempotency_key=kw.pop("idempotency_key", None), db=db,
    )
    if result.get("status") == "pending":
        calls["amounts"][result["reference"]] = result["amount_cents"]
    return result


async def _plan(db, org_id):
    return await accounts.current_plan(org_id, db)


async def _ledger_sum(db, org_id):
    return await accounts.wallet_balance(org_id, db)


# ── Pricing (pure) ───────────────────────────────────────────────────────────

def test_yearly_price_has_the_discount():
    assert pricing.cycle_price(CATALOG, "growth", "monthly") == kes(3500)
    assert pricing.cycle_price(CATALOG, "growth", "yearly") == kes(3500) * 12 * 85 // 100


def test_upgrade_from_free_is_prorated_to_the_first():
    now = datetime(2026, 9, 16, tzinfo=UTC)  # 15 of 30 days left
    q = pricing.quote(CATALOG, pricing.PlanState("starter"), {"type": "plan", "plan": "growth"}, now)
    assert q.amount_cents == kes(3500) // 2
    assert q.covers_until == datetime(2026, 10, 1, tzinfo=UTC)
    assert q.period_start == now


def test_upgrade_near_month_end_also_pays_next_month():
    # 30 Sep 10:00 UTC: 14 h of September left. Without the rule this was
    # KES 68 now and KES 3,500 again on 1 Oct.
    now = datetime(2026, 9, 30, 10, tzinfo=UTC)
    q = pricing.quote(CATALOG, pricing.PlanState("starter"), {"type": "plan", "plan": "growth"}, now)
    remainder = kes(3500) * 14 * 3600 // (30 * 24 * 3600)
    assert q.amount_cents == remainder + kes(3500)
    assert q.covers_until == datetime(2026, 11, 1, tzinfo=UTC)
    q = pricing.quote(CATALOG, pricing.PlanState("starter"), {"type": "plan", "plan": "enterprise"}, now)
    assert q.amount_cents == kes(17547) * 14 * 3600 // (30 * 24 * 3600) + kes(17547)


def test_quote_breakdown_adds_up_and_names_the_periods():
    now = datetime(2026, 9, 30, 10, tzinfo=UTC)
    q = pricing.quote(CATALOG, pricing.PlanState("starter"), {"type": "plan", "plan": "growth"}, now)
    assert sum(line["amount_cents"] for line in q.lines) == q.amount_cents
    assert [line["label"] for line in q.lines] == ["Growth plan, rest of September", "Growth plan, October"]
    assert q.lines[1]["start"] == "2026-10-01T00:00:00+00:00"
    assert q.lines[1]["end"] == "2026-11-01T00:00:00+00:00"
    assert q.next_charge_at == datetime(2026, 11, 1, tzinfo=UTC)
    assert q.next_charge_cents == kes(3500)
    assert q.note == (
        "September ends in less than a day, so this payment also covers all of "
        "October. You will not be charged again until 1 November 2026."
    )

    mid = datetime(2026, 9, 16, tzinfo=UTC)
    q = pricing.quote(CATALOG, pricing.PlanState("starter"), {"type": "plan", "plan": "growth", "cycle": "yearly"}, mid)
    assert [line["amount_cents"] for line in q.lines] == [q.amount_cents]
    assert q.note is None
    assert q.next_charge_at == datetime(2027, 9, 16, tzinfo=UTC)


def test_breakdown_shows_credit_for_the_old_plan():
    start, end = datetime(2026, 9, 1, tzinfo=UTC), datetime(2026, 10, 1, tzinfo=UTC)
    state = pricing.PlanState("growth", "monthly", start, end)
    now = datetime(2026, 9, 16, tzinfo=UTC)
    q = pricing.quote(CATALOG, state, {"type": "plan", "plan": "business", "cycle": "yearly"}, now)
    assert sum(line["amount_cents"] for line in q.lines) == q.amount_cents
    assert q.lines[-1]["amount_cents"] == -(kes(3500) // 2)


def test_seat_quote_has_breakdown_and_next_charge():
    start, end = datetime(2026, 9, 1, tzinfo=UTC), datetime(2026, 10, 1, tzinfo=UTC)
    state = pricing.PlanState("growth", "monthly", start, end)
    q = pricing.quote(CATALOG, state, {"type": "addon", "addon": "extra_seat", "quantity": 2},
                      datetime(2026, 9, 16, tzinfo=UTC))
    assert sum(line["amount_cents"] for line in q.lines) == q.amount_cents
    assert q.next_charge_cents == kes(500) * 2


def test_short_remainder_boundary_is_seven_days():
    just_inside = datetime(2026, 9, 24, 0, 0, 1, tzinfo=UTC)  # < 7 days left
    q = pricing.quote(CATALOG, pricing.PlanState("starter"), {"type": "plan", "plan": "growth"}, just_inside)
    assert q.covers_until == datetime(2026, 11, 1, tzinfo=UTC)
    exactly_seven = datetime(2026, 9, 24, tzinfo=UTC)
    q = pricing.quote(CATALOG, pricing.PlanState("starter"), {"type": "plan", "plan": "growth"}, exactly_seven)
    assert q.covers_until == datetime(2026, 10, 1, tzinfo=UTC)
    assert q.amount_cents == kes(3500) * 7 // 30


def test_december_short_remainder_rolls_into_january_year():
    now = datetime(2026, 12, 29, tzinfo=UTC)
    q = pricing.quote(CATALOG, pricing.PlanState("starter"), {"type": "plan", "plan": "growth"}, now)
    assert q.covers_until == datetime(2027, 2, 1, tzinfo=UTC)
    assert q.amount_cents == kes(3500) * 3 // 31 + kes(3500)


def test_mid_period_upgrade_charges_only_the_difference():
    start, end = datetime(2026, 9, 1, tzinfo=UTC), datetime(2026, 10, 1, tzinfo=UTC)
    state = pricing.PlanState("growth", "monthly", start, end)
    now = datetime(2026, 9, 16, tzinfo=UTC)
    q = pricing.quote(CATALOG, state, {"type": "plan", "plan": "business"}, now)
    assert q.amount_cents == (kes(9500) - kes(3500)) // 2
    assert q.covers_until == end and q.period_start is None  # period unchanged


def test_downgrade_is_not_sold():
    state = pricing.PlanState("business")
    with pytest.raises(pricing.PricingError):
        pricing.quote(CATALOG, state, {"type": "plan", "plan": "growth"})


def test_public_education_is_not_sold_online():
    with pytest.raises(pricing.PricingError):
        pricing.quote(CATALOG, pricing.PlanState("starter"), {"type": "plan", "plan": "public-education"})


def test_enterprise_sells_at_its_base_price():
    q = pricing.quote(CATALOG, pricing.PlanState("business"),
                      {"type": "plan", "plan": "enterprise", "cycle": "monthly"})
    assert q.amount_cents > 0
    assert CATALOG["plans"]["enterprise"]["price_cents"] == 1_754_700


def test_starter_cannot_buy_extra_seats():
    with pytest.raises(pricing.PricingError, match="upgrade"):
        pricing.quote(CATALOG, pricing.PlanState("starter"),
                      {"type": "addon", "addon": "extra_seat", "quantity": 1})


def test_extra_seat_price_follows_the_plan():
    now = datetime(2026, 9, 1, tzinfo=UTC)  # a full month ahead
    growth = pricing.quote(CATALOG, pricing.PlanState("growth"),
                           {"type": "addon", "addon": "extra_seat", "quantity": 2}, now)
    business = pricing.quote(CATALOG, pricing.PlanState("business"),
                             {"type": "addon", "addon": "extra_seat", "quantity": 2}, now)
    assert growth.amount_cents == kes(500) * 2
    assert business.amount_cents == kes(400) * 2


def test_pack_price_and_units():
    q = pricing.quote(CATALOG, pricing.PlanState("starter"),
                      {"type": "pack", "pack_id": "ai_500", "quantity": 2})
    assert q.amount_cents == kes(650) * 2
    assert q.item["units"] == 500 and q.item["kind"] == "ai_credits"


@pytest.mark.parametrize("bad", [0, 4999, -100, "x", None, 10**12])
def test_topup_bounds(bad):
    with pytest.raises(pricing.PricingError):
        pricing.quote(CATALOG, pricing.PlanState("starter"),
                      {"type": "wallet_topup", "amount_cents": bad})


def test_client_cannot_name_the_price():
    q = pricing.quote(CATALOG, pricing.PlanState("starter"),
                      {"type": "pack", "pack_id": "ai_100", "price_cents": 1, "amount_cents": 1})
    assert q.amount_cents == kes(150)


# ── Checkout + completion ────────────────────────────────────────────────────

async def test_upgrade_is_granted_once_however_many_paths_complete_it(db, starter_org, monkeypatch):
    calls = _paystack(monkeypatch)
    result = await _checkout(db, starter_org.id, {"type": "plan", "plan": "growth"}, calls)
    assert result["status"] == "pending" and result["authorization_url"]
    ref = result["reference"]
    assert await _plan(db, starter_org.id) == "starter"  # nothing before payment

    # Browser return, webhook and reconciler all complete the same payment.
    for _ in range(3):
        assert (await engine.complete_payment(ref, db))["status"] == "paid"

    assert await _plan(db, starter_org.id) == "growth"
    sub = await accounts.get_subscription(starter_org.id, db)
    assert sub.plan == "growth" and sub.period_end is not None
    entries = (await db.execute(select(LedgerEntry).where(LedgerEntry.ref_id == ref))).scalars().all()
    assert len(entries) == 2  # one topup + one charge, not six
    assert await _ledger_sum(db, starter_org.id) == 0
    card = (await db.execute(select(PaymentMethod))).scalars().one()
    assert card.last4 == "4081" and card.is_default
    assert card.auth_code_enc != "AUTH_real"  # stored encrypted


async def test_amount_mismatch_grants_nothing(db, starter_org, monkeypatch):
    calls = _paystack(monkeypatch, override={"amount": 100})
    result = await _checkout(db, starter_org.id, {"type": "plan", "plan": "growth"}, calls)
    outcome = await engine.complete_payment(result["reference"], db)
    assert outcome["status"] == "failed" and outcome["reason"] == "amount_mismatch"
    assert await _plan(db, starter_org.id) == "starter"
    assert await _ledger_sum(db, starter_org.id) == 0


async def test_currency_mismatch_grants_nothing(db, starter_org, monkeypatch):
    calls = _paystack(monkeypatch, override={"currency": "NGN"})
    result = await _checkout(db, starter_org.id, {"type": "pack", "pack_id": "ai_100"}, calls)
    outcome = await engine.complete_payment(result["reference"], db)
    assert outcome["reason"] == "currency_mismatch"
    assert (await db.execute(select(PackBalance))).scalars().first() is None


async def test_abandoned_payment_fails_and_pending_waits(db, starter_org, monkeypatch):
    calls = _paystack(monkeypatch, status="ongoing")
    r = await _checkout(db, starter_org.id, {"type": "pack", "pack_id": "ai_100"}, calls)
    assert (await engine.complete_payment(r["reference"], db))["status"] == "pending"
    calls2 = _paystack(monkeypatch, status="abandoned")
    calls2["amounts"] = calls["amounts"]
    assert (await engine.complete_payment(r["reference"], db))["status"] == "failed"


async def test_idempotency_key_replays_instead_of_charging_twice(db, starter_org, monkeypatch):
    calls = _paystack(monkeypatch)
    item = {"type": "pack", "pack_id": "ai_100"}
    first = await _checkout(db, starter_org.id, item, calls, idempotency_key="k1")
    second = await _checkout(db, starter_org.id, item, calls, idempotency_key="k1")
    assert second["replayed"] and second["reference"] == first["reference"]
    assert calls["initialize"] == 1


async def test_billing_off_refuses_checkout(db, starter_org, monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_BILLING_ENABLED", "false")
    with pytest.raises(HTTPException) as exc:
        await _checkout(db, starter_org.id, {"type": "pack", "pack_id": "ai_100"}, {"amounts": {}})
    assert exc.value.status_code == 503


# ── Wallet ───────────────────────────────────────────────────────────────────

async def _fund_wallet(db, org_id, cents, monkeypatch):
    calls = _paystack(monkeypatch)
    r = await _checkout(db, org_id, {"type": "wallet_topup", "amount_cents": cents}, calls)
    await engine.complete_payment(r["reference"], db)


async def test_wallet_topup_then_purchase(db, starter_org, monkeypatch):
    await _fund_wallet(db, starter_org.id, kes(1000), monkeypatch)
    assert await _ledger_sum(db, starter_org.id) == kes(1000)

    result = await engine.purchase_with_wallet(
        starter_org.id, {"type": "pack", "pack_id": "ai_500"}, user_id=None,
        idempotency_key="w1", db=db,
    )
    assert result["status"] == "paid"
    assert await _ledger_sum(db, starter_org.id) == kes(1000) - kes(650)
    pack = (await db.execute(select(PackBalance))).scalars().one()
    assert pack.kind == "ai_credits" and pack.remaining == 500

    # Same key again: no second charge.
    again = await engine.purchase_with_wallet(
        starter_org.id, {"type": "pack", "pack_id": "ai_500"}, user_id=None,
        idempotency_key="w1", db=db,
    )
    assert again["replayed"]
    assert await _ledger_sum(db, starter_org.id) == kes(350)


async def test_wallet_cannot_go_negative(db, starter_org):
    with pytest.raises(HTTPException) as exc:
        await engine.purchase_with_wallet(
            starter_org.id, {"type": "pack", "pack_id": "ai_100"}, user_id=None,
            idempotency_key=None, db=db,
        )
    assert exc.value.status_code == 402
    assert exc.value.detail["error_code"] == "wallet_insufficient"


async def test_spending_limit_blocks_overage(db, starter_org, monkeypatch):
    await _fund_wallet(db, starter_org.id, kes(5000), monkeypatch)
    account = await accounts.ensure_account(starter_org.id, db)
    account.spending_limit_cents = kes(1000)
    db.add(account)
    await db.commit()
    await engine.purchase_with_wallet(
        starter_org.id, {"type": "pack", "pack_id": "ai_500"}, user_id=None,
        idempotency_key=None, db=db,
    )  # 650 of 1000
    with pytest.raises(HTTPException) as exc:
        await engine.purchase_with_wallet(
            starter_org.id, {"type": "pack", "pack_id": "ai_500"}, user_id=None,
            idempotency_key=None, db=db,
        )
    assert exc.value.detail["error_code"] == "spending_limit_reached"


# ── Webhook ──────────────────────────────────────────────────────────────────

def _signed(body: dict) -> tuple[bytes, str]:
    raw = json.dumps(body).encode()
    return raw, hmac.new(SECRET.encode(), raw, hashlib.sha512).hexdigest()


async def test_webhook_rejects_bad_signature(db, starter_org):
    raw, _ = _signed({"event": "charge.success", "data": {"reference": "vbp_1_x"}})
    with pytest.raises(HTTPException) as exc:
        await engine.handle_platform_webhook(raw, "forged", db)
    assert exc.value.status_code == 400


async def test_webhook_completes_payment_and_dedupes(db, starter_org, monkeypatch):
    calls = _paystack(monkeypatch)
    r = await _checkout(db, starter_org.id, {"type": "pack", "pack_id": "ai_100"}, calls)
    body = {"event": "charge.success", "data": {"id": 91, "reference": r["reference"],
                                                "status": "success"}}
    raw, sig = _signed(body)
    assert (await engine.handle_platform_webhook(raw, sig, db))["status"] == "paid"
    assert (await engine.handle_platform_webhook(raw, sig, db))["result"] == "duplicate"
    pack = (await db.execute(select(PackBalance))).scalars().one()
    assert pack.remaining == 100


async def test_webhook_body_amount_is_not_trusted(db, starter_org, monkeypatch):
    """A signed body is only a hint; the grant uses Paystack's verify answer."""
    calls = _paystack(monkeypatch, override={"amount": 1})
    r = await _checkout(db, starter_org.id, {"type": "plan", "plan": "business"}, calls)
    body = {"event": "charge.success", "data": {"id": 92, "reference": r["reference"],
                                                "status": "success", "amount": r["amount_cents"]}}
    raw, sig = _signed(body)
    assert (await engine.handle_platform_webhook(raw, sig, db))["status"] == "failed"
    assert await _plan(db, starter_org.id) == "starter"


async def test_webhook_ignores_course_sales_references(db, starter_org):
    raw, sig = _signed({"event": "charge.success", "data": {"reference": "vb_1_coursesale"}})
    assert (await engine.handle_platform_webhook(raw, sig, db))["result"] == "ignored"


async def test_reconciler_completes_a_missed_webhook(db, starter_org, monkeypatch):
    calls = _paystack(monkeypatch)
    r = await _checkout(db, starter_org.id, {"type": "pack", "pack_id": "ai_100"}, calls)
    attempt = (await db.execute(select(PaymentAttempt))).scalars().one()
    attempt.created_at = datetime.now(UTC) - timedelta(minutes=30)
    db.add(attempt)
    await db.commit()
    summary = await engine.reconcile_pending(db)
    assert summary["checked"] == 1 and summary.get("paid") == 1
    assert (await engine.complete_payment(r["reference"], db))["status"] == "paid"


# ── Plan changes ─────────────────────────────────────────────────────────────

async def test_downgrade_waits_for_the_paid_period(db, starter_org, monkeypatch):
    calls = _paystack(monkeypatch)
    r = await _checkout(db, starter_org.id, {"type": "plan", "plan": "business"}, calls)
    await engine.complete_payment(r["reference"], db)

    out = await engine.schedule_plan_change(starter_org.id, "growth", "monthly", db)
    assert out["status"] == "scheduled"
    assert await _plan(db, starter_org.id) == "business"  # keeps what it paid for

    upgrade_again = await engine.schedule_plan_change(starter_org.id, "starter", "monthly", db)
    assert upgrade_again["status"] == "scheduled"
    await engine.cancel_scheduled_change(starter_org.id, db)
    assert (await accounts.get_subscription(starter_org.id, db)).pending_plan is None


async def test_upgrade_cannot_be_scheduled_for_free(db, starter_org):
    with pytest.raises(HTTPException):
        await engine.schedule_plan_change(starter_org.id, "business", "monthly", db)


# ── Billing cycle ────────────────────────────────────────────────────────────

async def _paid_growth(db, org_id, *, period_end):
    db.add(BillingSubscription(
        org_id=org_id, plan="growth", cycle="monthly",
        period_start=period_end - timedelta(days=30), period_end=period_end,
    ))
    row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))).scalars().one()
    row.config = {"config_version": "2.0", "plan": "growth"}
    db.add(row)
    await db.commit()


async def test_monthly_invoice_is_issued_once_and_paid_from_wallet(db, starter_org, monkeypatch):
    first = datetime(2026, 10, 1, 0, 30, tzinfo=UTC)
    await _paid_growth(db, starter_org.id, period_end=datetime(2026, 10, 1, tzinfo=UTC))
    db.add(OrgAddon(org_id=starter_org.id, addon="extra_seat", quantity=2,
                    started_at=datetime(2026, 9, 10, tzinfo=UTC)))
    await db.commit()
    await _fund_wallet(db, starter_org.id, kes(10000), monkeypatch)

    for _ in range(2):  # a second run finds the work done
        await cycle.run_cycle(db, now=first)

    invoices = (await db.execute(select(Invoice))).scalars().all()
    assert len(invoices) == 1
    inv = invoices[0]
    assert inv.status == "paid" and inv.paid_via == "wallet"
    assert inv.total_cents == kes(3500) + kes(500) * 2
    sub = await accounts.get_subscription(starter_org.id, db)
    assert pricing.aware(sub.period_end) == datetime(2026, 11, 1, tzinfo=UTC)
    assert await _ledger_sum(db, starter_org.id) == kes(10000) - inv.total_cents


async def test_addon_bought_this_month_is_not_billed_again(db, starter_org):
    first = datetime(2026, 10, 1, 0, 30, tzinfo=UTC)
    await _paid_growth(db, starter_org.id, period_end=datetime(2026, 11, 1, tzinfo=UTC))
    db.add(OrgAddon(org_id=starter_org.id, addon="extra_seat", quantity=1,
                    started_at=datetime(2026, 10, 1, 0, 10, tzinfo=UTC)))
    await db.commit()
    await cycle.run_cycle(db, now=first)
    assert (await db.execute(select(Invoice))).scalars().first() is None


async def test_plan_paid_ahead_is_not_billed_again_on_the_first(db, starter_org, billing_env):
    # Bought on 30 Sep with next month included: the 1 Oct run bills nothing.
    await _paid_growth(db, starter_org.id, period_end=datetime(2026, 11, 1, tzinfo=UTC))
    await cycle.run_cycle(db, now=datetime(2026, 10, 1, 0, 30, tzinfo=UTC))
    assert (await db.execute(select(Invoice))).scalars().all() == []
    account = await db.get(BillingAccount, starter_org.id)
    assert account is None or account.status == "active"


async def test_unpaid_invoice_dunning_pause_and_resume(db, starter_org, monkeypatch, billing_env):
    first = datetime(2026, 10, 1, 0, 30, tzinfo=UTC)
    await _paid_growth(db, starter_org.id, period_end=datetime(2026, 10, 1, tzinfo=UTC))

    await cycle.run_cycle(db, now=first)
    inv = (await db.execute(select(Invoice))).scalars().one()
    assert inv.status == "open"
    account = await db.get(BillingAccount, starter_org.id)
    assert account.status == "past_due"
    assert any("Invoice" in s for s in billing_env)  # pay link sent

    # Features stay on during the grace…
    ent = await ent_mod.get_entitlements(starter_org.id, db, use_cache=False)
    assert ent.plan == "growth"

    # …then pause to Starter after day 5. Nothing is deleted.
    await cycle.run_cycle(db, now=first + timedelta(days=5, hours=1))
    await db.refresh(account)
    assert account.status == "paused"
    ent = await ent_mod.get_entitlements(starter_org.id, db, use_cache=False)
    assert ent.plan == "starter"
    assert await _plan(db, starter_org.id) == "growth"  # the plan itself is kept

    # Paying the invoice resumes at once.
    calls = _paystack(monkeypatch)
    r = await _checkout(db, starter_org.id, {"type": "invoice", "invoice_id": inv.id}, calls)
    assert (await engine.complete_payment(r["reference"], db))["status"] == "paid"
    await db.refresh(account)
    assert account.status == "active"
    ent = await ent_mod.get_entitlements(starter_org.id, db, use_cache=False)
    assert ent.plan == "growth"


async def test_paused_account_can_only_pay_its_bill(db, starter_org, monkeypatch):
    db.add(BillingAccount(org_id=starter_org.id, status="paused"))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await _checkout(db, starter_org.id, {"type": "pack", "pack_id": "ai_100"}, {"amounts": {}})
    assert exc.value.detail["error_code"] == "billing_paused"


async def test_saved_card_pays_invoice_unattended(db, starter_org, monkeypatch):
    first = datetime(2026, 10, 1, 0, 30, tzinfo=UTC)
    await _paid_growth(db, starter_org.id, period_end=datetime(2026, 10, 1, tzinfo=UTC))
    from src.security.secret_crypto import encrypt_secret

    db.add(PaymentMethod(org_id=starter_org.id, auth_code_enc=encrypt_secret("AUTH_real"),
                         signature="SIG_1", is_default=True))
    db.add(BillingAccount(org_id=starter_org.id, billing_email="bills@school.test"))
    await db.commit()
    calls = _paystack(monkeypatch)

    await cycle.run_cycle(db, now=first)
    await cycle.run_cycle(db, now=first)  # must not charge the card twice
    inv = (await db.execute(select(Invoice))).scalars().one()
    assert inv.status == "paid"
    assert calls["charge"] == 1


async def test_downgrade_to_starter_applies_at_period_end_and_ends_seats(db, starter_org):
    end = datetime(2026, 10, 1, tzinfo=UTC)
    await _paid_growth(db, starter_org.id, period_end=end)
    sub = await accounts.get_subscription(starter_org.id, db)
    sub.pending_plan, sub.pending_cycle = "starter", "monthly"
    db.add(sub)
    db.add(OrgAddon(org_id=starter_org.id, addon="extra_seat", quantity=1,
                    started_at=datetime(2026, 9, 5, tzinfo=UTC)))
    await db.commit()

    await cycle.run_cycle(db, now=end + timedelta(minutes=30))
    assert await _plan(db, starter_org.id) == "starter"
    assert (await db.execute(select(Invoice))).scalars().first() is None
    seat = (await db.execute(select(OrgAddon))).scalars().one()
    assert seat.ends_at is not None  # Starter can't hold extra seats


# ── Scheduler ────────────────────────────────────────────────────────────────

async def test_scheduler_is_inert_when_billing_is_off(monkeypatch):
    from src.services.billing import scheduler

    monkeypatch.setenv("VALIDBRIDGE_BILLING_ENABLED", "false")
    assert await scheduler.run_tick() == {"skipped": "billing disabled"}
    scheduler.start_scheduler()
    assert scheduler._task is None


# ── SSO add-on ───────────────────────────────────────────────────────────────

async def _sso_on(db, org_id):
    row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))).scalars().one()
    await db.refresh(row)
    return bool(((row.config or {}).get("overrides") or {}).get("sso", {}).get("force_enabled"))


async def test_sso_is_a_paid_addon(db, starter_org, monkeypatch):
    with pytest.raises(HTTPException):  # not sold on Starter
        await _checkout(db, starter_org.id, {"type": "addon", "addon": "sso"}, {"amounts": {}})
    row = (await db.execute(select(OrganizationConfig))).scalars().one()
    row.config = {"config_version": "2.0", "plan": "business"}
    db.add(row)
    await db.commit()
    assert not await _sso_on(db, starter_org.id)
    calls = _paystack(monkeypatch)
    r = await _checkout(db, starter_org.id, {"type": "addon", "addon": "sso"}, calls)
    await engine.complete_payment(r["reference"], db)
    assert await _sso_on(db, starter_org.id)
    ent = await ent_mod.get_entitlements(starter_org.id, db, use_cache=False)
    assert ent.features["sso"] is True


async def test_ending_sso_addon_switches_it_off_but_keeps_superadmin_comp(db, starter_org):
    from src.services.billing import grants

    row = (await db.execute(select(OrganizationConfig))).scalars().one()
    row.config = {"config_version": "2.0", "plan": "business"}
    db.add(row)
    await db.commit()
    await grants.grant_addon(starter_org.id, "sso", 1, db)
    await db.commit()
    addon = (await db.execute(select(OrgAddon))).scalars().one()
    addon.ends_at = datetime.now(UTC) - timedelta(minutes=1)
    db.add(addon)
    await grants.sync_sso_addon(starter_org.id, db)
    await db.commit()
    assert not await _sso_on(db, starter_org.id)

    # A superadmin comp (no "addon" source) is never switched off by billing.
    row = (await db.execute(select(OrganizationConfig))).scalars().one()
    row.config = {**row.config, "overrides": {"sso": {"force_enabled": True}}}
    db.add(row)
    await db.commit()
    await grants.sync_sso_addon(starter_org.id, db)
    await db.commit()
    assert await _sso_on(db, starter_org.id)


def test_enterprise_no_longer_includes_sso():
    assert CATALOG["plans"]["enterprise"]["features"]["sso"] is False
    assert CATALOG["addons"]["sso"]["price_cents"] == kes(20000)
