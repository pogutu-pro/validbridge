"""
Payments service tests — webhook idempotency, signature verification, grant.

Pure unit tests: no network, no real DB. The Paystack HTTP + credential + crypto
calls are mocked; the assertions cover the logic that must never regress:
  * duplicate webhook events never double-grant,
  * an invalid signature is rejected (fail closed),
  * a successful charge creates a completed enrollment,
  * access checks deny by default (fail closed).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from src.db.payments.payments import PaymentProviderEnum, PaymentsConfig
from src.db.payments.payments_enrollments import EnrollmentStatusEnum, PaymentsEnrollment
from src.db.payments.payments_events import PaymentsEvent
from src.db.payments.payments_groups import PaymentsGroup
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.payments import group_sync, service


class _Scalars:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row

    def all(self):
        return self._row if isinstance(self._row, list) else []


class _Result:
    def __init__(self, row):
        self._row = row

    def scalars(self):
        return _Scalars(self._row)

    def all(self):
        return self._row if isinstance(self._row, list) else []


class FakeSession:
    """AsyncSession stand-in that returns the queued rows in order and records adds."""

    def __init__(self, rows):
        self.rows = list(rows)
        self.added = []
        self.deleted = []
        self._id_seq = 1000

    async def execute(self, statement):
        return _Result(self.rows.pop(0) if self.rows else None)

    def add(self, obj):
        self.added.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)

    async def flush(self):
        # Approximate SQLAlchemy's autoincrement id assignment on flush.
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                self._id_seq += 1
                obj.id = self._id_seq

    async def commit(self):
        await self.flush()

    async def refresh(self, obj):
        pass


def _charge_body(reference="vb_7_abc123", offer_id=5, user_id=42):
    return {
        "event": "charge.success",
        "data": {
            "id": 999,
            "reference": reference,
            "status": "success",
            "amount": 10000,
            "currency": "KES",
            "metadata": {"org_id": 7, "offer_id": offer_id, "user_id": user_id},
            "authorization": {"authorization_code": "AUTH_x"},
        },
    }


def _offer_row(offer_id=5, amount=100.0, price_type="fixed_price", currency="KES"):
    return SimpleNamespace(id=offer_id, amount=amount, price_type=price_type, currency=currency)


def _patch_provider(monkeypatch, *, verify=True, credentials=None):
    creds = credentials or SimpleNamespace(secret_key="sk_test", public_key="pk_test")
    monkeypatch.setattr(
        "src.services.payments.service.paystack.resolve_paystack_credentials",
        AsyncMock(return_value=creds),
    )
    monkeypatch.setattr(
        "src.services.payments.service.paystack.webhook_secret_keys",
        AsyncMock(return_value=[creds.secret_key]),
    )
    monkeypatch.setattr(
        "src.services.payments.service.paystack.verify_webhook_signature",
        lambda sk, body, sig: verify,
    )


@pytest.mark.asyncio
async def test_webhook_charge_success_grants_enrollment(monkeypatch):
    _patch_provider(monkeypatch)
    # no existing event, offer lookup, no existing enrollment
    session = FakeSession([None, _offer_row(), None])
    body = _charge_body()

    result = await service.handle_webhook(
        body if isinstance(body, bytes) else __import__("json").dumps(body).encode(), "sig", session
    )

    assert result == {"result": "charge.success", "ok": True}
    assert any(isinstance(o, PaymentsEvent) for o in session.added)
    enrollment = next(o for o in session.added if isinstance(o, PaymentsEnrollment))
    assert enrollment.status == EnrollmentStatusEnum.completed
    assert enrollment.user_id == 42
    assert enrollment.offer_id == 5


@pytest.mark.asyncio
async def test_webhook_amount_mismatch_does_not_grant(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    # Offer is 100.00 (10000 minor); a 1.00 payment must not grant.
    session = FakeSession([None, _offer_row(amount=100.0), None])
    body = _charge_body()
    body["data"]["amount"] = 100
    result = await service.handle_webhook(json.dumps(body).encode(), "sig", session)
    assert result == {"result": "charge.success", "ok": True}
    assert not any(isinstance(o, PaymentsEnrollment) for o in session.added)


@pytest.mark.asyncio
async def test_webhook_duplicate_event_is_idempotent(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    # First delivery: event not yet seen.
    session = FakeSession([None, _offer_row(), None])
    await service.handle_webhook(json.dumps(_charge_body()).encode(), "sig", session)
    assert any(isinstance(o, PaymentsEvent) for o in session.added)

    # Second delivery of the same event: already-seen short-circuits.
    session2 = FakeSession([SimpleNamespace(id=1)])  # event already processed
    result = await service.handle_webhook(json.dumps(_charge_body()).encode(), "sig", session2)
    assert result == {"result": "duplicate", "ok": True}
    assert not any(isinstance(o, PaymentsEnrollment) for o in session2.added)


@pytest.mark.asyncio
async def test_webhook_invalid_signature_rejected(monkeypatch):
    _patch_provider(monkeypatch, verify=False)
    import json

    session = FakeSession([])
    with pytest.raises(HTTPException) as exc:
        await service.handle_webhook(json.dumps(_charge_body()).encode(), "bad", session)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_webhook_unknown_org_is_ignored(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    session = FakeSession([])
    result = await service.handle_webhook(json.dumps(_charge_body(reference="other")).encode(), "sig", session)
    assert result == {"result": "ignored", "ok": True}
    assert session.added == []


@pytest.mark.asyncio
async def test_check_enrollment_access_fails_closed(monkeypatch):
    from src.services.payments.payments_access import check_enrollment_access

    # No offers include the resource → False (never open by default).
    session = FakeSession([[], []])  # direct offer ids, group ids
    assert await check_enrollment_access("course_x", 42, session) is False


def _subscription_charge_body(reference="vb_7_abc123", offer_id=5, user_id=42):
    return {
        "event": "charge.success",
        "data": {
            "id": 999,
            "reference": reference,
            "status": "success",
            "amount": 250000,
            "currency": "KES",
            "plan": {"plan_code": "PLN_x"},
            "subscription": {"subscription_code": "SUB_y", "email_token": "tok_z"},
            "metadata": {"org_id": 7, "offer_id": offer_id, "user_id": user_id},
            "authorization": {"authorization_code": "AUTH_x"},
        },
    }


@pytest.mark.asyncio
async def test_webhook_subscription_charge_grants_active(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    offer = SimpleNamespace(
        id=5, amount=2500.0, price_type="fixed_price", currency="KES",
        offer_type="subscription",
    )
    session = FakeSession([None, offer, None])
    result = await service.handle_webhook(
        json.dumps(_subscription_charge_body()).encode(), "sig", session
    )
    assert result == {"result": "charge.success", "ok": True}
    enrollment = next(o for o in session.added if isinstance(o, PaymentsEnrollment))
    assert enrollment.status == EnrollmentStatusEnum.active
    assert enrollment.subscription_code == "SUB_y"
    assert enrollment.email_token == "tok_z"


@pytest.mark.asyncio
async def test_webhook_subscription_disable_cancels(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    # Existing enrollment for SUB_y; the disable event carries only the code.
    existing = PaymentsEnrollment(
        enrollment_uuid="enr_1", offer_id=5, user_id=42, org_id=7,
        status=EnrollmentStatusEnum.active, subscription_code="SUB_y",
    )
    # org lookup by subscription code → 7; idempotency (no prior event) → None;
    # find by subscription code → existing.
    session = FakeSession([7, None, existing])
    body = {"event": "subscription.disable", "data": {"id": 1000, "code": "SUB_y"}}
    result = await service.handle_webhook(json.dumps(body).encode(), "sig", session)
    assert result == {"result": "subscription.disable", "ok": True}
    assert existing.status == EnrollmentStatusEnum.cancelled


@pytest.mark.asyncio
async def test_webhook_refund_marks_refunded(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    # Existing enrollment with a stored reference; refund carries the same one.
    existing = PaymentsEnrollment(
        enrollment_uuid="enr_1", offer_id=5, user_id=42, org_id=7,
        status=EnrollmentStatusEnum.completed,
        provider_specific_data={"reference": "vb_7_abc123"},
    )
    session = FakeSession([None, existing])
    body = {"event": "charge.refunded", "data": {"id": 1001, "reference": "vb_7_abc123"}}
    result = await service.handle_webhook(json.dumps(body).encode(), "sig", session)
    assert result == {"result": "charge.refunded", "ok": True}
    assert existing.status == EnrollmentStatusEnum.refunded


@pytest.mark.asyncio
async def test_webhook_paystack_refund_processed_marks_refunded(monkeypatch):
    """Paystack's real refund event: ``refund.processed`` with the charge's
    reference in ``transaction_reference`` (there is no ``data.reference``)."""
    _patch_provider(monkeypatch)
    import json

    existing = PaymentsEnrollment(
        enrollment_uuid="enr_1", offer_id=5, user_id=42, org_id=7,
        status=EnrollmentStatusEnum.completed,
        provider_specific_data={"reference": "vb_7_abc123"},
    )
    session = FakeSession([None, existing])
    body = {
        "event": "refund.processed",
        "data": {
            "id": 5501,
            "status": "processed",
            "transaction_reference": "vb_7_abc123",
            "amount": 10000,
            "currency": "KES",
        },
    }
    result = await service.handle_webhook(json.dumps(body).encode(), "sig", session)
    assert result == {"result": "refund.processed", "ok": True}
    assert existing.status == EnrollmentStatusEnum.refunded


class _RacingSession(FakeSession):
    """The duplicate delivery passes the SELECT, then loses the insert race."""

    def __init__(self, rows):
        super().__init__(rows)
        self.rolled_back = False

    async def flush(self):
        from sqlalchemy.exc import IntegrityError

        raise IntegrityError("INSERT INTO payments_events", {}, Exception("unique"))

    async def rollback(self):
        self.rolled_back = True


@pytest.mark.asyncio
async def test_webhook_concurrent_duplicate_reports_duplicate_not_500(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    # The SELECT sees nothing (the other delivery hasn't committed yet).
    session = _RacingSession([None, _offer_row(), None])
    result = await service.handle_webhook(json.dumps(_charge_body()).encode(), "sig", session)
    assert result == {"result": "duplicate", "ok": True}
    assert session.rolled_back
    assert not any(isinstance(o, PaymentsEnrollment) for o in session.added)


def test_event_key_separates_failed_and_paid_invoice():
    """One invoice id, two states: both must be processed, not deduped."""
    failed = service._webhook_event_key("invoice.update", {"id": 77, "status": "failed"}, None)
    paid = service._webhook_event_key("invoice.update", {"id": 77, "status": "success"}, None)
    not_renew = service._webhook_event_key("subscription.not_renew", {"id": 9}, None)
    disable = service._webhook_event_key("subscription.disable", {"id": 9}, None)
    assert failed != paid
    assert not_renew != disable
    # The same delivery twice still maps to one key.
    assert failed == service._webhook_event_key(
        "invoice.update", {"id": 77, "status": "failed"}, None
    )


@pytest.mark.asyncio
async def test_webhook_invoice_paid_reactivates_failed(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    existing = PaymentsEnrollment(
        enrollment_uuid="enr_1", offer_id=5, user_id=42, org_id=7,
        status=EnrollmentStatusEnum.failed, subscription_code="SUB_y",
    )
    # org lookup by subscription code → 7; idempotency → None; find → existing.
    session = FakeSession([7, None, existing])
    body = {
        "event": "invoice.update",
        "data": {"id": 1002, "status": "success", "subscription": {"subscription_code": "SUB_y"}},
    }
    result = await service.handle_webhook(json.dumps(body).encode(), "sig", session)
    assert result == {"result": "invoice.update", "ok": True}
    assert existing.status == EnrollmentStatusEnum.active


@pytest.mark.asyncio
async def test_webhook_invoice_paid_does_not_revive_cancelled(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    # A cancelled subscription must stay cancelled even if a stale invoice lands.
    existing = PaymentsEnrollment(
        enrollment_uuid="enr_1", offer_id=5, user_id=42, org_id=7,
        status=EnrollmentStatusEnum.cancelled, subscription_code="SUB_y",
    )
    session = FakeSession([7, None, existing])
    body = {
        "event": "invoice.update",
        "data": {"id": 1003, "status": "paid", "subscription": {"subscription_code": "SUB_y"}},
    }
    await service.handle_webhook(json.dumps(body).encode(), "sig", session)
    assert existing.status == EnrollmentStatusEnum.cancelled


# ── Group sync ───────────────────────────────────────────────────────────────

def _group(usergroup_id=None):
    return PaymentsGroup(id=2, org_id=7, name="Premium", usergroup_id=usergroup_id)


def _usergroup():
    return UserGroup(
        id=11, org_id=7, name="Payments — Premium", description="auto"
    )


@pytest.mark.asyncio
async def test_webhook_subscription_charge_syncs_buyer_into_group(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    offer = SimpleNamespace(
        id=5, amount=2500.0, price_type="fixed_price", currency="KES",
        offer_type="subscription", payments_group_id=2,
    )
    session = FakeSession([None, offer, None, _group(), None])
    result = await service.handle_webhook(
        json.dumps(_subscription_charge_body()).encode(), "sig", session
    )
    assert result == {"result": "charge.success", "ok": True}
    membership = next(o for o in session.added if isinstance(o, UserGroupUser))
    assert membership.user_id == 42
    assert membership.org_id == 7
    updated_group = next(o for o in session.added if isinstance(o, PaymentsGroup))
    assert updated_group.usergroup_id == membership.usergroup_id


@pytest.mark.asyncio
async def test_webhook_disable_syncs_membership_removal(monkeypatch):
    _patch_provider(monkeypatch)
    import json

    existing = PaymentsEnrollment(
        enrollment_uuid="enr_1", offer_id=5, user_id=42, org_id=7,
        status=EnrollmentStatusEnum.active, subscription_code="SUB_y",
    )
    offer = SimpleNamespace(id=5, payments_group_id=2)
    membership = UserGroupUser(
        usergroup_id=11, user_id=42, org_id=7, creation_date="", update_date=""
    )
    # org by code; idempotency; find enrollment; offer; group; usergroup;
    # group offer ids; granting-enrollment check; current membership.
    session = FakeSession([7, None, existing, offer, _group(11), _usergroup(), [5], None, membership])
    body = {"event": "subscription.disable", "data": {"id": 1000, "code": "SUB_y"}}
    result = await service.handle_webhook(json.dumps(body).encode(), "sig", session)
    assert result == {"result": "subscription.disable", "ok": True}
    assert existing.status == EnrollmentStatusEnum.cancelled
    assert membership in session.deleted


@pytest.mark.asyncio
async def test_reconcile_group_members(monkeypatch):
    usergroup = _usergroup()
    # usergroup lookup; group offer ids; granting enrollment user ids; current members.
    session = FakeSession([usergroup, [5, 9], [42, 7], []])
    added, removed = await group_sync.reconcile_group_members(_group(11), session)
    assert (added, removed) == (2, 0)
    assert [o.user_id for o in session.added if isinstance(o, UserGroupUser)] == [42, 7]


@pytest.mark.asyncio
async def test_reconcile_group_resources(monkeypatch):
    stale = UserGroupResource(
        usergroup_id=11, resource_uuid="course_c", org_id=7, creation_date="", update_date=""
    )
    # usergroup lookup; group resources; group offer ids; offer resources; current rows.
    session = FakeSession([_usergroup(), ["course_a"], [5], ["course_b"], [stale]])
    added, removed = await group_sync.reconcile_group_resources(_group(11), session)
    assert (added, removed) == (2, 1)
    assert stale in session.deleted


@pytest.mark.asyncio
async def test_manual_group_sync_reconciles_all(monkeypatch):
    usergroup = _usergroup()
    # group load; members → (usergroup, offer ids, user ids, current members);
    # resources → (usergroup, group resources, offer ids, offer resources, current).
    session = FakeSession([
        _group(11), usergroup, [5], [42], [],
        usergroup, ["course_a"], [5], ["course_b"], [],
    ])
    result = await service.sync_group(7, 2, session)
    assert result["usergroup_id"] == 11
    assert result["members_added"] == 1
    assert result["resources_mirrored"] == 2


# ── Billing portal ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_billing_overview_custom_provider_falls_back(monkeypatch):
    offer = SimpleNamespace(
        id=5, offer_uuid="offer_x", name="Course A", offer_type="one_time", amount=100.0,
        currency="KES", interval=None,
    )
    enr = PaymentsEnrollment(
        enrollment_uuid="enr_1", offer_id=5, user_id=42, org_id=7,
        status=EnrollmentStatusEnum.completed,
        provider_specific_data={"reference": "vb_7_1"},
    )
    config = PaymentsConfig(org_id=7, provider=PaymentProviderEnum.custom)
    # overview join; (no sub code → no config query); user lookup; transactions
    # custom config; fallback join.
    session = FakeSession([[(enr, offer)], SimpleNamespace(email="buyer@example.com"), config, [(enr, offer)]])
    overview = await service.billing_overview(7, 42, session)
    assert overview["subscriptions"][0]["offer_name"] == "Course A"
    assert overview["subscriptions"][0]["subscription"]["remote"] is False
    assert overview["transactions"][0]["reference"] == "vb_7_1"


@pytest.mark.asyncio
async def test_billing_overview_enriches_active_subscription(monkeypatch):
    from unittest.mock import AsyncMock

    monkeypatch.setattr(
        "src.services.payments.service.paystack.resolve_paystack_credentials",
        AsyncMock(return_value=SimpleNamespace(secret_key="sk_test", public_key="pk_test")),
    )
    monkeypatch.setattr(
        "src.services.payments.service.paystack.get_subscription",
        AsyncMock(
            return_value={
                "status": "active",
                "next_payment_date": "2026-10-18T09:00:00.000Z",
                "plan": {"name": "Premium"},
            }
        ),
    )
    monkeypatch.setattr(
        "src.services.payments.service.paystack.list_customer_transactions",
        AsyncMock(
            return_value=[
                {
                    "reference": "vb_7_99",
                    "amount": 250000,
                    "currency": "KES",
                    "status": "success",
                    "created_at": "2026-01-01T00:00:00.000Z",
                    "metadata": {"offer_id": 5},
                    "customer": {"id": 1, "email": "buyer@example.com"},
                }
            ]
        ),
    )

    offer = SimpleNamespace(
        id=5, offer_uuid="offer_x", name="Premium", offer_type="subscription", amount=2500.0,
        currency="KES", interval="monthly",
    )
    enr = PaymentsEnrollment(
        enrollment_uuid="enr_1", offer_id=5, user_id=42, org_id=7,
        status=EnrollmentStatusEnum.active, subscription_code="SUB_y",
    )
    config = PaymentsConfig(org_id=7, provider=PaymentProviderEnum.paystack)
    # overview join; sub summary config; user lookup; transactions config;
    # offer-name lookup.
    session = FakeSession([
        [(enr, offer)], config,
        SimpleNamespace(email="buyer@example.com"), config,
        [(5, "Premium")],
    ])
    overview = await service.billing_overview(7, 42, session)
    sub = overview["subscriptions"][0]["subscription"]
    assert sub["remote"] is True
    assert sub["next_payment_date"] == "2026-10-18T09:00:00.000Z"
    assert overview["transactions"][0]["reference"] == "vb_7_99"
    assert overview["transactions"][0]["description"] == "Premium"
