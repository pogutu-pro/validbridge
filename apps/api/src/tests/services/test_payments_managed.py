"""Managed payouts (Paystack subaccounts) and the payment-routing fixes.

Covers: one-call subaccount setup, credential modes with no silent platform
fallback, checkout split routing, the shared-webhook dispatcher, per-org
transaction history on a shared account, and plan cleanup on disconnect.
Paystack HTTP calls are mocked; the database is real.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.payments.payments import PaymentsConfig
from src.db.payments.payments_enrollments import EnrollmentStatusEnum, PaymentsEnrollment
from src.db.payments.payments_offers import OfferTypeEnum, PaymentsOffer
from src.services.payments import paystack, service

# Shapes as Paystack's live GET /bank?currency=KES returns them.
BANKS = [
    {"code": "01", "name": "Equity Bank", "type": "kepss"},
    {"code": "68", "name": "KCB Bank", "type": "kepss"},
    {"code": "MPESA", "name": "M-PESA", "type": "mobile_money"},
    {"code": "MPTILL", "name": "M-PESA Till", "type": "mobile_money_business"},
    {"code": "MPPAYBILL", "name": "M-PESA Paybill", "type": "mobile_money_business"},
]


@pytest.fixture
def platform(monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_PLATFORM_PAYSTACK_SECRET_KEY", "sk_test_platform")
    monkeypatch.setenv("VALIDBRIDGE_PLATFORM_PAYSTACK_PUBLIC_KEY", "pk_test_platform")
    monkeypatch.setenv("VALIDBRIDGE_PAYMENTS_PLATFORM_FEE_PERCENT", "5")
    monkeypatch.setattr(paystack, "list_banks", AsyncMock(return_value=BANKS))
    monkeypatch.setattr(paystack, "resolve_account_name", AsyncMock(return_value="ACME SCHOOL LTD"))
    create = AsyncMock(return_value={"subaccount_code": "ACCT_new"})
    update = AsyncMock(return_value={"subaccount_code": "ACCT_new"})
    monkeypatch.setattr(paystack, "create_subaccount", create)
    monkeypatch.setattr(paystack, "update_subaccount", update)
    return {"create": create, "update": update}


@pytest.fixture
def no_platform(monkeypatch):
    for name in (
        "VALIDBRIDGE_PLATFORM_PAYSTACK_SECRET_KEY",
        "VALIDBRIDGE_PAYSTACK_SECRET_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(paystack, "platform_credentials", lambda: None)


def _payout(**overrides):
    body = {"business_name": "Acme School", "bank_code": "01", "account_number": "0123 456-789"}
    body.update(overrides)
    return body


async def _offer(db, org, **kw):
    offer = PaymentsOffer(
        offer_uuid=kw.pop("offer_uuid", "offer_test"),
        org_id=org.id,
        name="Course",
        amount=100.0,
        currency="KES",
        **kw,
    )
    db.add(offer)
    await db.commit()
    await db.refresh(offer)
    return offer


# ── Managed setup ────────────────────────────────────────────────────────────

async def test_setup_creates_subaccount_and_stores_only_safe_details(db, org, platform):
    view = await service.setup_managed_payouts(org.id, _payout(), db)

    fields = platform["create"].await_args.kwargs
    assert fields["settlement_bank"] == "01"
    assert fields["account_number"] == "0123456789"  # spaces/dashes stripped
    assert fields["percentage_charge"] == 5.0
    assert view["mode"] == "managed"
    assert view["active"] is True
    assert view["payout"]["account_last4"] == "6789"
    assert view["payout"]["bank_name"] == "Equity Bank"
    assert view["payout"]["account_name"] == "ACME SCHOOL LTD"

    row = (await db.execute(select(PaymentsConfig).where(PaymentsConfig.org_id == org.id))).scalars().first()
    assert row.provider_config["subaccount_code"] == "ACCT_new"
    assert "0123456789" not in str(row.provider_config)  # full number never stored


async def test_setup_again_updates_same_subaccount(db, org, platform):
    await service.setup_managed_payouts(org.id, _payout(), db)
    await service.setup_managed_payouts(org.id, _payout(bank_code="68"), db)
    assert platform["create"].await_count == 1
    assert platform["update"].await_args.args[1] == "ACCT_new"


async def test_setup_rejects_unknown_bank(db, org, platform):
    with pytest.raises(HTTPException) as exc:
        await service.setup_managed_payouts(org.id, _payout(bank_code="999"), db)
    assert exc.value.status_code == 400
    platform["create"].assert_not_awaited()


async def test_setup_surfaces_paystack_message(db, org, platform):
    platform["create"].side_effect = paystack.PaystackError("Account details are invalid")
    with pytest.raises(HTTPException) as exc:
        await service.setup_managed_payouts(org.id, _payout(), db)
    assert exc.value.status_code == 400
    assert "Account details are invalid" in exc.value.detail


async def test_setup_unavailable_without_platform_account(db, org, no_platform):
    with pytest.raises(HTTPException) as exc:
        await service.setup_managed_payouts(org.id, _payout(), db)
    assert exc.value.status_code == 503


async def test_setup_keeps_own_keys_for_old_webhooks(db, org, platform, monkeypatch):
    monkeypatch.setattr(paystack, "check_secret_key", AsyncMock())
    await service.initialize_config(org.id, "paystack", {"secret_key": "sk_test_own"}, db)
    await service.setup_managed_payouts(org.id, _payout(), db)

    keys = await paystack.webhook_secret_keys(org.id, db)
    assert keys == ["sk_test_own", "sk_test_platform"]


# ── Credentials: modes, no silent fallback ───────────────────────────────────

async def test_managed_resolves_to_platform_key_and_subaccount(db, org, platform):
    await service.setup_managed_payouts(org.id, _payout(), db)
    creds = await paystack.resolve_paystack_credentials(org.id, db, require_active=True)
    assert creds.secret_key == "sk_test_platform"
    assert creds.subaccount_code == "ACCT_new"
    assert creds.mode == "managed"


async def test_unconfigured_org_never_falls_back_to_platform_key(db, org, platform):
    with pytest.raises(paystack.PaymentsNotConfiguredError):
        await paystack.resolve_paystack_credentials(org.id, db)


async def test_inactive_config_refuses_new_charges_only(db, org, platform):
    await service.setup_managed_payouts(org.id, _payout(), db)
    row = (await db.execute(select(PaymentsConfig).where(PaymentsConfig.org_id == org.id))).scalars().first()
    row.active = False
    db.add(row)
    await db.commit()

    with pytest.raises(paystack.PaymentsNotConfiguredError):
        await paystack.resolve_paystack_credentials(org.id, db, require_active=True)
    # Past sales (webhooks, refunds) still resolve.
    assert (await paystack.resolve_paystack_credentials(org.id, db)).subaccount_code == "ACCT_new"


# ── Checkout ─────────────────────────────────────────────────────────────────

async def test_checkout_unconfigured_org_is_refused(db, org, platform):
    await _offer(db, org)
    with pytest.raises(HTTPException) as exc:
        await service.create_checkout_session(org.id, "offer_test", "a@b.co", 1, "https://x/y", db)
    assert exc.value.status_code == 409


async def test_checkout_managed_routes_to_subaccount(db, org, platform, monkeypatch):
    await service.setup_managed_payouts(org.id, _payout(), db)
    await _offer(db, org)
    init = AsyncMock(return_value={"authorization_url": "https://paystack/x", "reference": "r"})
    monkeypatch.setattr(paystack, "initialize_transaction", init)

    result = await service.create_checkout_session(org.id, "offer_test", "a@b.co", 1, "https://x/y", db)

    assert result == {"checkout_url": "https://paystack/x"}
    assert init.await_args.args[0] == "sk_test_platform"
    assert init.await_args.kwargs["subaccount"] == "ACCT_new"
    assert init.await_args.kwargs["bearer"] == "subaccount"


# ── Own keys validation ──────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "keys",
    [
        {"secret_key": "pk_test_wrongbox"},
        {"secret_key": "sk_test_a", "public_key": "pk_live_b"},
    ],
)
async def test_own_keys_mistakes_rejected_before_saving(db, org, monkeypatch, keys):
    check = AsyncMock()
    monkeypatch.setattr(paystack, "check_secret_key", check)
    with pytest.raises(HTTPException) as exc:
        await service.initialize_config(org.id, "paystack", dict(keys), db)
    assert exc.value.status_code == 400
    check.assert_not_awaited()


async def test_own_key_rejected_by_paystack(db, org, monkeypatch):
    monkeypatch.setattr(
        paystack, "check_secret_key", AsyncMock(side_effect=paystack.PaystackError("Invalid key"))
    )
    with pytest.raises(HTTPException) as exc:
        await service.initialize_config(org.id, "paystack", {"secret_key": "sk_test_bad"}, db)
    assert "Invalid key" in exc.value.detail


# ── Webhook dispatch (one URL per Paystack account) ──────────────────────────

async def test_dispatch_routes_platform_billing_to_engine(db, monkeypatch):
    from src.services.billing import engine

    platform_hook = AsyncMock(return_value={"result": "billing"})
    sales_hook = AsyncMock(return_value={"result": "sales"})
    monkeypatch.setattr(engine, "handle_platform_webhook", platform_hook)
    monkeypatch.setattr(service, "handle_webhook", sales_hook)

    billing = b'{"event":"charge.success","data":{"reference":"vbp_7_abc"}}'
    sale = b'{"event":"charge.success","data":{"reference":"vb_7_abc"}}'
    sub = b'{"event":"subscription.disable","data":{"subscription_code":"SUB_x"}}'

    assert await service.dispatch_webhook(billing, "s", db) == {"result": "billing"}
    assert await service.dispatch_webhook(sale, "s", db) == {"result": "sales"}
    assert await service.dispatch_webhook(sub, "s", db) == {"result": "sales"}


# ── Buyer history on a shared account ────────────────────────────────────────

async def test_transaction_history_only_shows_this_buyers_sales_in_this_org(
    db, org, regular_user, platform, monkeypatch
):
    await service.setup_managed_payouts(org.id, _payout(), db)
    me = {"email": regular_user.email}
    monkeypatch.setattr(
        paystack,
        "list_customer_transactions",
        AsyncMock(return_value=[
            {"reference": f"vb_{org.id}_mine", "amount": 10000, "currency": "KES", "status": "success", "customer": me},
            {"reference": f"vb_{org.id}_otherlearner", "amount": 10000, "currency": "KES", "status": "success",
             "customer": {"email": "someone.else@example.com"}},
            {"reference": f"vb_{org.id + 1}_otherschool", "amount": 5000, "currency": "KES", "status": "success", "customer": me},
            {"reference": f"vbp_{org.id}_platformbill", "amount": 900, "currency": "KES", "status": "success", "customer": me},
        ]),
    )
    rows = await service.billing_transactions(org.id, regular_user.id, db)
    assert [r["reference"] for r in rows] == [f"vb_{org.id}_mine"]


# ── Verify on return ─────────────────────────────────────────────────────────

async def test_verify_rejects_another_orgs_reference(db, org):
    with pytest.raises(HTTPException) as exc:
        await service.verify_checkout(org.id, f"vb_{org.id + 1}_x", 1, db)
    assert exc.value.status_code == 400


async def test_verify_rejects_someone_elses_payment(db, org, platform, monkeypatch):
    await service.setup_managed_payouts(org.id, _payout(), db)
    monkeypatch.setattr(
        paystack,
        "verify_transaction",
        AsyncMock(return_value={"status": "success", "metadata": {"user_id": 99, "offer_id": 1}}),
    )
    with pytest.raises(HTTPException) as exc:
        await service.verify_checkout(org.id, f"vb_{org.id}_x", 1, db)
    assert exc.value.status_code == 404


async def test_verify_grants_access_from_paystack_data(db, org, regular_user, platform, monkeypatch):
    await service.setup_managed_payouts(org.id, _payout(), db)
    offer = await _offer(db, org)
    monkeypatch.setattr(
        paystack,
        "verify_transaction",
        AsyncMock(return_value={
            "status": "success", "reference": f"vb_{org.id}_x", "amount": 10000, "currency": "KES",
            "metadata": {"user_id": regular_user.id, "offer_id": offer.id},
        }),
    )
    result = await service.verify_checkout(org.id, f"vb_{org.id}_x", regular_user.id, db)
    assert result == {"status": "paid", "offer_uuid": "offer_test"}
    enrollment = (
        await db.execute(select(PaymentsEnrollment).where(PaymentsEnrollment.user_id == regular_user.id))
    ).scalars().first()
    assert enrollment.status == EnrollmentStatusEnum.completed

    # Repeating (or the webhook arriving later) is harmless.
    again = await service.verify_checkout(org.id, f"vb_{org.id}_x", regular_user.id, db)
    assert again["status"] == "paid"


async def test_verify_underpayment_does_not_grant(db, org, regular_user, platform, monkeypatch):
    await service.setup_managed_payouts(org.id, _payout(), db)
    offer = await _offer(db, org)
    monkeypatch.setattr(
        paystack,
        "verify_transaction",
        AsyncMock(return_value={
            "status": "success", "amount": 100, "currency": "KES",
            "metadata": {"user_id": regular_user.id, "offer_id": offer.id},
        }),
    )
    assert (await service.verify_checkout(org.id, f"vb_{org.id}_x", regular_user.id, db)) == {"status": "failed"}


async def test_subscription_create_attaches_code(db, org, regular_user, platform, monkeypatch):
    offer = await _offer(db, org, offer_type=OfferTypeEnum.subscription, provider_product_id="PLN_abc")
    db.add(PaymentsEnrollment(
        enrollment_uuid="enr_t", offer_id=offer.id, user_id=regular_user.id, org_id=org.id,
        status=EnrollmentStatusEnum.pending, provider_specific_data={},
    ))
    await db.commit()
    monkeypatch.setattr(paystack, "verify_webhook_signature", lambda key, body, sig: key == "sk_test_platform")
    import json
    body = json.dumps({"event": "subscription.create", "data": {
        "id": 1, "subscription_code": "SUB_1", "email_token": "tok",
        "plan": {"plan_code": "PLN_abc"}, "customer": {"email": regular_user.email},
    }}).encode()

    assert (await service.handle_webhook(body, "sig", db))["result"] == "subscription.create"
    enrollment = (
        await db.execute(select(PaymentsEnrollment).where(PaymentsEnrollment.enrollment_uuid == "enr_t"))
    ).scalars().first()
    assert enrollment.subscription_code == "SUB_1"
    assert enrollment.email_token == "tok"


async def test_switching_to_managed_recreates_plans_on_platform(db, org, platform, monkeypatch):
    offer = await _offer(
        db, org, offer_type=OfferTypeEnum.subscription, provider_product_id="PLN_onoldaccount"
    )
    create_plan = AsyncMock(return_value="PLN_platform")
    monkeypatch.setattr(paystack, "create_plan", create_plan)
    monkeypatch.setattr(paystack, "update_plan", AsyncMock(side_effect=AssertionError("must not update a foreign plan")))

    await service.setup_managed_payouts(org.id, _payout(), db)

    await db.refresh(offer)
    assert offer.provider_product_id == "PLN_platform"
    assert create_plan.await_args.args[0] == "sk_test_platform"


# ── Payout destinations (M-PESA, till, bank) ─────────────────────────────────

async def test_options_offer_mpesa_and_till_but_not_paybill(db, org, platform):
    options = await service.payout_options(org.id, db)
    kinds = {b["code"]: b["kind"] for b in options["banks"]}
    assert kinds == {"01": "bank", "68": "bank", "MPESA": "mobile", "MPTILL": "till"}
    assert options["test_mode"] is True


async def test_paybill_is_refused(db, org, platform):
    with pytest.raises(HTTPException) as exc:
        await service.setup_managed_payouts(org.id, _payout(bank_code="MPPAYBILL", account_number="400200"), db)
    assert exc.value.status_code == 400
    platform["create"].assert_not_awaited()


@pytest.mark.parametrize("typed", ["0712 345 678", "+254712345678", "254712345678", "712345678", "0112345678"])
async def test_mpesa_numbers_normalised_to_local_form(db, org, platform, typed):
    view = await service.setup_managed_payouts(org.id, _payout(bank_code="MPESA", account_number=typed), db)
    sent = platform["create"].await_args.kwargs["account_number"]
    assert len(sent) == 10 and sent.startswith("0")
    assert view["payout"]["kind"] == "mobile"


@pytest.mark.parametrize("bad", ["0812345678", "07123", "+1 415 555 0100", "abcdefghij"])
async def test_bad_mpesa_numbers_rejected_before_paystack(db, org, platform, bad):
    with pytest.raises(HTTPException) as exc:
        await service.setup_managed_payouts(org.id, _payout(bank_code="MPESA", account_number=bad), db)
    assert exc.value.status_code == 400
    platform["create"].assert_not_awaited()


async def test_till_number_validated(db, org, platform):
    with pytest.raises(HTTPException):
        await service.setup_managed_payouts(org.id, _payout(bank_code="MPTILL", account_number="12"), db)
    view = await service.setup_managed_payouts(org.id, _payout(bank_code="MPTILL", account_number="5123456"), db)
    assert view["payout"]["kind"] == "till"


# ── Verification status & test mode ──────────────────────────────────────────

async def test_payout_status_refreshes_then_remembers(db, org, platform, monkeypatch):
    view = await service.setup_managed_payouts(org.id, _payout(), db)
    assert view["payout"]["verified"] is False
    assert view["test_mode"] is True

    fetch = AsyncMock(return_value={"is_verified": False, "active": True})
    monkeypatch.setattr(paystack, "fetch_subaccount", fetch)
    assert (await service.payout_status(org.id, db))["verified"] is False

    fetch.return_value = {"is_verified": True, "active": True}
    assert (await service.payout_status(org.id, db))["verified"] is True
    fetch.reset_mock()
    assert (await service.payout_status(org.id, db))["verified"] is True
    fetch.assert_not_awaited()  # remembered, no more Paystack calls


async def test_changing_payout_details_needs_reverification(db, org, platform, monkeypatch):
    await service.setup_managed_payouts(org.id, _payout(), db)
    monkeypatch.setattr(paystack, "fetch_subaccount", AsyncMock(return_value={"is_verified": True}))
    await service.payout_status(org.id, db)
    platform["update"].return_value = {"subaccount_code": "ACCT_new", "is_verified": False}
    view = await service.setup_managed_payouts(org.id, _payout(bank_code="68"), db)
    assert view["payout"]["verified"] is False


async def test_checkout_paystack_refusal_is_clear_not_500(db, org, platform, monkeypatch):
    import httpx

    await service.setup_managed_payouts(org.id, _payout(), db)
    await _offer(db, org)
    request = httpx.Request("POST", "https://api.paystack.co/transaction/initialize")
    response = httpx.Response(400, json={"status": False, "message": "Currency not supported by merchant"}, request=request)
    monkeypatch.setattr(
        paystack, "initialize_transaction",
        AsyncMock(side_effect=httpx.HTTPStatusError("400", request=request, response=response)),
    )
    with pytest.raises(HTTPException) as exc:
        await service.create_checkout_session(org.id, "offer_test", "a@b.co", 1, "https://x/y", db)
    assert exc.value.status_code == 502
    assert "Currency not supported" in exc.value.detail


# ── Disconnect ───────────────────────────────────────────────────────────────

async def test_disconnect_drops_plan_codes(db, org, platform):
    view = await service.setup_managed_payouts(org.id, _payout(), db)
    offer = await _offer(
        db, org, offer_type=OfferTypeEnum.subscription, provider_product_id="PLN_old"
    )
    await service.delete_config(org.id, str(view["id"]), db)
    await db.refresh(offer)
    assert offer.provider_product_id is None


# ── Learner pays Paystack's fee (0% ValidBridge cut, instructor gets full price)

def _init_mock(monkeypatch):
    init = AsyncMock(return_value={"authorization_url": "https://paystack/x", "reference": "r"})
    monkeypatch.setattr(paystack, "initialize_transaction", init)
    return init


@pytest.mark.parametrize("method,total,channel", [
    (None, 102.0, "mobile_money"),           # default M-PESA: 100 / 0.985 -> KES 102 (whole shillings)
    ("mobile_money", 102.0, "mobile_money"),
    ("card", 100.0, "card"),                 # no card surcharge: plain price
])
async def test_managed_checkout_adds_method_fee_on_top(db, org, platform, monkeypatch, method, total, channel):
    await service.setup_managed_payouts(org.id, _payout(), db)
    await _offer(db, org)  # KES 100
    init = _init_mock(monkeypatch)
    await service.create_checkout_session(org.id, "offer_test", "a@b.co", 1, "https://x/y", db, method=method)
    kwargs = init.await_args.kwargs
    assert kwargs["amount_major"] == total
    assert kwargs["channels"] == [channel]
    assert kwargs["metadata"]["base_minor"] == 10000
    assert kwargs["metadata"]["fee_minor"] == int(total * 100) - 10000


async def test_managed_fee_leaves_instructor_full_price(db, org, platform):
    from src.services.payments.paystack import fee_rate, gross_up_minor

    for base in (10000, 99900, 150000, 1234567):
        for method in ("mobile_money", "card"):
            if not fee_rate(method):
                continue  # no surcharge: the instructor bears this method's fee
            gross = gross_up_minor(base, fee_rate(method))
            paystack_fee = round(gross * fee_rate(method))
            assert gross % 100 == 0 and gross - paystack_fee >= base


async def test_unknown_method_refused(db, org, platform, monkeypatch):
    await service.setup_managed_payouts(org.id, _payout(), db)
    await _offer(db, org)
    _init_mock(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        await service.create_checkout_session(org.id, "offer_test", "a@b.co", 1, "https://x/y", db, method="bitcoin")
    assert exc.value.status_code == 400


async def test_subscription_is_card_with_card_fee_plan(db, org, platform, monkeypatch):
    await service.setup_managed_payouts(org.id, _payout(), db)
    create_plan = AsyncMock(return_value="PLN_x")
    monkeypatch.setattr(paystack, "create_plan", create_plan)
    sub = await service.create_offer(org.id, {
        "name": "Monthly", "offer_type": "subscription", "interval": "monthly", "amount": 1000, "currency": "KES",
    }, db)
    assert create_plan.await_args.kwargs["amount_major"] == 1000.0  # no card surcharge

    row = (await db.execute(select(PaymentsOffer).where(PaymentsOffer.id == sub.id))).scalars().first()
    init = _init_mock(monkeypatch)
    with pytest.raises(HTTPException):
        await service.create_checkout_session(org.id, row.offer_uuid, "a@b.co", 1, "https://x/y", db, method="mobile_money")
    await service.create_checkout_session(org.id, row.offer_uuid, "a@b.co", 1, "https://x/y", db)
    assert init.await_args.kwargs["channels"] == ["card"]
    assert init.await_args.kwargs["metadata"]["fee_minor"] == 0


async def test_card_surcharge_still_configurable(db, org, platform, monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_PAYSTACK_FEE_CARD_PERCENT", "3.8")
    await service.setup_managed_payouts(org.id, _payout(), db)
    await _offer(db, org)
    init = _init_mock(monkeypatch)
    await service.create_checkout_session(org.id, "offer_test", "a@b.co", 1, "https://x/y", db, method="card")
    assert init.await_args.kwargs["amount_major"] == 104.0  # 100 / 0.962 -> KES 104


async def test_own_keys_checkout_has_no_surcharge(db, org, monkeypatch):
    monkeypatch.setattr(paystack, "check_secret_key", AsyncMock())
    await service.initialize_config(org.id, "paystack", {"secret_key": "sk_test_own"}, db)
    await _offer(db, org)
    init = _init_mock(monkeypatch)
    await service.create_checkout_session(org.id, "offer_test", "a@b.co", 1, "https://x/y", db, method="card")
    assert init.await_args.kwargs["amount_major"] == 100.0
    assert init.await_args.kwargs["channels"] is None


async def test_fee_pass_through_can_be_turned_off(db, org, platform, monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_PAYMENTS_LEARNER_PAYS_FEES", "false")
    await service.setup_managed_payouts(org.id, _payout(), db)
    await _offer(db, org)
    init = _init_mock(monkeypatch)
    await service.create_checkout_session(org.id, "offer_test", "a@b.co", 1, "https://x/y", db)
    assert init.await_args.kwargs["amount_major"] == 100.0


async def test_public_offer_lists_totals_only_for_managed(db, org, platform, monkeypatch):
    offer = await _offer(db, org, is_publicly_listed=True)
    assert (await service._offer_public_shape(offer, db))["checkout_methods"] is None
    await service.setup_managed_payouts(org.id, _payout(), db)
    methods = (await service._offer_public_shape(offer, db))["checkout_methods"]
    assert [(m["method"], m["total"], m["fee"]) for m in methods] == [("mobile_money", 102.0, 2.0), ("card", 100.0, 0.0)]


@pytest.mark.parametrize("paid,fee,ok", [
    (10200, 200, True),     # M-PESA total
    (10400, 400, False),    # more than any method adds (card adds nothing)
    (10000, 0, True),       # no fee (own keys / older checkouts)
    (9800, -200, False),    # negative fee
    (10200, 0, False),      # fee missing -> price mismatch
    (5000, 5000, False),    # "fee" hiding an underpayment
    (10200, 300, False),    # base 99.00 != price
])
def test_paid_amount_with_fee(paid, fee, ok):
    offer = SimpleNamespace(amount=100.0, price_type="fixed_price", currency="KES")
    data = {"amount": paid, "currency": "KES", "metadata": {"fee_minor": fee}}
    assert service._paid_amount_matches(offer, data) is ok
