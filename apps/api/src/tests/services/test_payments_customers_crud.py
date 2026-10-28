"""Adding, editing and deleting customers by hand (cash payments, demo rows, fixing mistakes)."""

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.payments.payments_enrollments import EnrollmentStatusEnum, PaymentsEnrollment
from src.db.payments.payments_offers import PaymentsOffer
from src.db.users import User
from src.services.payments import service

ADMIN = 1


@pytest.fixture
async def student(db):
    u = User(id=50, username="rodgers", first_name="Rodgers", last_name="N", email="Rodgers@Test.com", password="x",
             user_uuid="user_rodgers", creation_date="now", update_date="now")
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
async def offer(db, org):
    o = PaymentsOffer(offer_uuid="offer_fe", org_id=org.id, name="Frontend", amount=1000, total_amount=15000, price_type="customer_choice")
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return o


@pytest.fixture
async def fixed(db, org):
    o = PaymentsOffer(offer_uuid="offer_fx", org_id=org.id, name="Fixed", amount=5000, price_type="fixed_price")
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return o


@pytest.fixture
def access(monkeypatch):
    """Records every grant or removal of access that the group sync is asked for."""
    calls = []

    async def sync(offer, user_id, db, *, granted):
        calls.append((offer.id, user_id, granted))

    monkeypatch.setattr(service, "_sync_membership_for_offer", sync)
    return calls


async def _rows(db):
    return (await db.execute(select(PaymentsEnrollment))).scalars().all()


class TestAdd:
    async def test_add_a_customer_who_paid_outside_the_platform(self, db, org, offer, student, access):
        res = await service.add_customer(org.id, offer.id, "rodgers@test.com", "completed", 1000, "paid cash at the office", ADMIN, db)
        (row,) = await _rows(db)
        assert res["status"] == "completed" and row.status == EnrollmentStatusEnum.completed and row.amount_paid == 1000
        assert row.provider_specific_data["manual"] is True and row.provider_specific_data["manual_log"][0]["note"] == "paid cash at the office"
        assert access == [(offer.id, student.id, True)], "access is granted"

    async def test_pending_rows_do_not_grant_access(self, db, org, offer, student, access):
        await service.add_customer(org.id, offer.id, "rodgers@test.com", "pending", None, None, ADMIN, db)
        assert access == [(offer.id, student.id, False)]

    async def test_unknown_email_and_duplicates(self, db, org, offer, student, access):
        with pytest.raises(HTTPException) as exc:
            await service.add_customer(org.id, offer.id, "nobody@test.com", "completed", None, None, ADMIN, db)
        assert exc.value.status_code == 404
        await service.add_customer(org.id, offer.id, "rodgers@test.com", "completed", 1000, None, ADMIN, db)
        with pytest.raises(HTTPException) as dup:
            await service.add_customer(org.id, offer.id, "rodgers@test.com", "completed", 1000, None, ADMIN, db)
        assert dup.value.status_code == 409

    async def test_amount_above_the_full_price_is_refused(self, db, org, offer, student, access):
        with pytest.raises(HTTPException) as exc:
            await service.add_customer(org.id, offer.id, "rodgers@test.com", "completed", 99999, None, ADMIN, db)
        assert exc.value.status_code == 400 and "full price" in exc.value.detail

    async def test_subscriptions_cannot_be_marked_paid_by_hand(self, db, org, student, access):
        sub = PaymentsOffer(offer_uuid="offer_sub", org_id=org.id, name="Sub", offer_type="subscription", amount=500)
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        with pytest.raises(HTTPException) as exc:
            await service.add_customer(org.id, sub.id, "rodgers@test.com", "completed", None, None, ADMIN, db)
        assert exc.value.status_code == 400 and "Paystack" in exc.value.detail

    async def test_another_schools_offer_is_not_reachable(self, db, org, other_org, student, access):
        theirs = PaymentsOffer(offer_uuid="offer_o", org_id=other_org.id, name="Theirs", amount=100)
        db.add(theirs)
        await db.commit()
        await db.refresh(theirs)
        with pytest.raises(HTTPException) as exc:
            await service.add_customer(org.id, theirs.id, "rodgers@test.com", "completed", None, None, ADMIN, db)
        assert exc.value.status_code == 404


class TestEdit:
    async def _customer(self, db, org, offer, student, status="pending"):
        await service.add_customer(org.id, offer.id, "rodgers@test.com", status, 1000, None, ADMIN, db)
        return (await _rows(db))[0]

    async def test_mark_a_pending_row_paid_grants_access_and_is_logged(self, db, org, offer, student, access):
        row = await self._customer(db, org, offer, student)
        access.clear()
        res = await service.update_customer(org.id, row.id, {"status": "completed", "amount_paid": 4000, "note": "M-PESA code QK12"}, ADMIN, db)
        await db.refresh(row)
        assert res["changed"] and row.status == EnrollmentStatusEnum.completed and row.amount_paid == 4000
        assert access == [(offer.id, student.id, True)]
        log = row.provider_specific_data["manual_log"][-1]
        assert "pending to completed" in log["change"] and "to 4000" in log["change"] and log["note"] == "M-PESA code QK12" and log["by"] == ADMIN

    async def test_cancelling_or_refunding_takes_access_away(self, db, org, offer, student, access):
        row = await self._customer(db, org, offer, student, "completed")
        access.clear()
        await service.update_customer(org.id, row.id, {"status": "refunded"}, ADMIN, db)
        assert access == [(offer.id, student.id, False)]

    async def test_nothing_changes_when_nothing_is_different(self, db, org, offer, student, access):
        row = await self._customer(db, org, offer, student)
        access.clear()
        res = await service.update_customer(org.id, row.id, {"status": "pending"}, ADMIN, db)
        assert res["changed"] is False and access == []

    async def test_amount_paid_only_for_offers_paid_in_parts(self, db, org, fixed, student, access):
        await service.add_customer(org.id, fixed.id, "rodgers@test.com", "completed", None, None, ADMIN, db)
        (row,) = await _rows(db)
        with pytest.raises(HTTPException) as exc:
            await service.update_customer(org.id, row.id, {"amount_paid": 100}, ADMIN, db)
        assert exc.value.status_code == 400

    async def test_a_live_paystack_subscription_is_not_overridden(self, db, org, student, access):
        sub = PaymentsOffer(offer_uuid="offer_sub", org_id=org.id, name="Sub", offer_type="subscription", amount=500)
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        row = PaymentsEnrollment(enrollment_uuid="e_sub", offer_id=sub.id, user_id=student.id, org_id=org.id,
                                 status=EnrollmentStatusEnum.active, subscription_code="SUB_123")
        db.add(row)
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await service.update_customer(org.id, row.id, {"status": "cancelled"}, ADMIN, db)
        assert exc.value.status_code == 409 and "subscription" in exc.value.detail

    async def test_unknown_or_other_school_row(self, db, org, other_org, offer, student, access):
        row = await self._customer(db, org, offer, student)
        for org_id, rid in ((org.id, 9999), (other_org.id, row.id)):
            with pytest.raises(HTTPException) as exc:
                await service.update_customer(org_id, rid, {"status": "failed"}, ADMIN, db)
            assert exc.value.status_code == 404


class TestDelete:
    async def test_delete_a_pending_demo_row_freely(self, db, org, offer, student, access):
        await service.add_customer(org.id, offer.id, "rodgers@test.com", "pending", None, None, ADMIN, db)
        (row,) = await _rows(db)
        access.clear()
        res = await service.delete_customer(org.id, row.id, False, db)
        assert res == {"deleted": True, "access_removed": False} and await _rows(db) == [] and access == []

    async def test_deleting_a_paid_customer_needs_confirmation_and_removes_access(self, db, org, offer, student, access):
        await service.add_customer(org.id, offer.id, "rodgers@test.com", "completed", 1000, None, ADMIN, db)
        (row,) = await _rows(db)
        with pytest.raises(HTTPException) as exc:
            await service.delete_customer(org.id, row.id, False, db)
        assert exc.value.status_code == 409 and len(await _rows(db)) == 1
        access.clear()
        res = await service.delete_customer(org.id, row.id, True, db)
        assert res == {"deleted": True, "access_removed": True} and access == [(offer.id, student.id, False)]

    async def test_live_subscription_and_other_school_rows_are_protected(self, db, org, other_org, student, access):
        sub = PaymentsOffer(offer_uuid="offer_sub", org_id=org.id, name="Sub", offer_type="subscription", amount=500)
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        row = PaymentsEnrollment(enrollment_uuid="e_sub", offer_id=sub.id, user_id=student.id, org_id=org.id,
                                 status=EnrollmentStatusEnum.active, subscription_code="SUB_123")
        db.add(row)
        await db.commit()
        with pytest.raises(HTTPException) as live:
            await service.delete_customer(org.id, row.id, True, db)
        assert live.value.status_code == 409
        with pytest.raises(HTTPException) as other:
            await service.delete_customer(other_org.id, row.id, True, db)
        assert other.value.status_code == 404


async def test_list_shows_amount_paid_and_manual_rows(db, org, offer, student, access):
    await service.add_customer(org.id, offer.id, "rodgers@test.com", "completed", 4000, None, ADMIN, db)
    (item,) = await service.list_customers(org.id, db)
    assert (item["amount_paid"], item["total_amount"], item["manual"], item["offer_id"]) == (4000, 15000, True, offer.id)


def test_customer_routes_are_for_school_admins_only():
    from src.routers.payments import require_payments_admin, router

    wanted = {("POST", "/{org_id}/customers"), ("PATCH", "/{org_id}/customers/{enrollment_id}"), ("DELETE", "/{org_id}/customers/{enrollment_id}"), ("GET", "/{org_id}/customers")}
    seen = set()
    for route in router.routes:
        for method in getattr(route, "methods", set()):
            if (method, route.path) in wanted:
                seen.add((method, route.path))
                assert any(d.call is require_payments_admin for d in route.dependant.dependencies), (method, route.path)
    assert seen == wanted
