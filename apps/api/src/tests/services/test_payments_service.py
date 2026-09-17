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
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.payments.payments_enrollments import EnrollmentStatusEnum, PaymentsEnrollment
from src.db.payments.payments_events import PaymentsEvent
from src.services.payments import service


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


class FakeSession:
    """AsyncSession stand-in that returns the queued rows in order and records adds."""

    def __init__(self, rows):
        self.rows = list(rows)
        self.added = []

    async def execute(self, statement):
        return _Result(self.rows.pop(0) if self.rows else None)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        pass

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
    session = FakeSession([None, [existing]])
    body = {"event": "charge.refunded", "data": {"id": 1001, "reference": "vb_7_abc123"}}
    result = await service.handle_webhook(json.dumps(body).encode(), "sig", session)
    assert result == {"result": "charge.refunded", "ok": True}
    assert existing.status == EnrollmentStatusEnum.refunded


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
