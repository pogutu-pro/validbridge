"""What each student has paid and still owes the school."""

import pytest
from sqlmodel import select

from src.db.payments.payments_enrollments import EnrollmentStatusEnum, PaymentsEnrollment
from src.db.payments.payments_offers import PaymentsOffer
from src.db.users import User
from src.services.payments import service


async def _user(db, uid, name):
    u = User(id=uid, username=name, first_name=name.title(), last_name="S", email=f"{name}@test.com", password="x",
             user_uuid=f"user_{name}", creation_date="now", update_date="now")
    db.add(u)
    await db.commit()
    return u


async def _offer(db, org, name, **kw):
    o = PaymentsOffer(offer_uuid=f"offer_{name}", org_id=org.id, name=name, **kw)
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return o


async def _enroll(db, org, offer, user, status="completed", paid=0.0, data=None):
    e = PaymentsEnrollment(enrollment_uuid=f"e_{offer.id}_{user.id}", offer_id=offer.id, user_id=user.id, org_id=org.id,
                           status=EnrollmentStatusEnum(status), amount_paid=paid, provider_specific_data=data or {})
    db.add(e)
    await db.commit()
    return e


@pytest.fixture
async def parts(db, org):
    return await _offer(db, org, "Frontend", amount=1000, total_amount=15000, price_type="customer_choice")


async def test_paid_and_owed_for_an_offer_paid_in_parts(db, org, parts):
    rodgers = await _user(db, 1, "rodgers")
    await _enroll(db, org, parts, rodgers, paid=5000)
    (row,) = await service.student_balances(org.id, db)
    assert (row["name"], row["paid"], row["owes"], row["currency"]) == ("Rodgers S", 5000, 10000, "KES")
    assert row["offers"] == [{"name": "Frontend", "paid": 5000, "owes": 10000, "total": 15000}]


async def test_fully_paid_students_owe_nothing(db, org, parts):
    await _enroll(db, org, parts, await _user(db, 1, "dennis"), paid=15000)
    (row,) = await service.student_balances(org.id, db)
    assert (row["paid"], row["owes"]) == (15000, 0)


async def test_a_student_who_paid_before_instalments_existed_counts_what_they_paid(db, org, parts):
    await _enroll(db, org, parts, await _user(db, 1, "old"), paid=0.0, data={"amount": 1000})
    (row,) = await service.student_balances(org.id, db)
    assert (row["paid"], row["owes"]) == (1000, 14000)


async def test_pending_checkouts_are_not_debts_and_unpaid_rows_are_hidden(db, org, parts):
    await _enroll(db, org, parts, await _user(db, 1, "pending"), status="pending")
    await _enroll(db, org, parts, await _user(db, 2, "refunded"), status="refunded", paid=5000)
    assert await service.student_balances(org.id, db) == []


async def test_fixed_price_and_pay_what_you_want_offers_count_as_paid(db, org):
    fixed = await _offer(db, org, "Fixed", amount=5000, price_type="fixed_price")
    choice = await _offer(db, org, "Choice", amount=500, price_type="customer_choice")
    s = await _user(db, 1, "sam")
    await _enroll(db, org, fixed, s)
    await _enroll(db, org, choice, s, data={"amount": 800})
    (row,) = await service.student_balances(org.id, db)
    assert (row["paid"], row["owes"]) == (5800, 0) and len(row["offers"]) == 2


async def test_subscriptions_are_left_out_of_the_money(db, org):
    sub = await _offer(db, org, "Sub", amount=500, offer_type="subscription")
    await _enroll(db, org, sub, await _user(db, 1, "sub"), status="active")
    assert await service.student_balances(org.id, db) == []


async def test_a_students_offers_add_up_and_the_ones_owing_most_come_first(db, org, parts):
    other = await _offer(db, org, "Backend", amount=2000, total_amount=10000, price_type="customer_choice")
    a, b = await _user(db, 1, "amina"), await _user(db, 2, "brian")
    await _enroll(db, org, parts, a, paid=1000)
    await _enroll(db, org, other, a, paid=2000)
    await _enroll(db, org, parts, b, paid=14000)
    rows = await service.student_balances(org.id, db)
    assert [(r["name"], r["paid"], r["owes"]) for r in rows] == [("Amina S", 3000, 22000), ("Brian S", 14000, 1000)]


async def test_other_schools_students_are_not_included(db, org, other_org, parts):
    theirs = await _offer(db, other_org, "Theirs", amount=100, total_amount=500, price_type="customer_choice")
    await _enroll(db, other_org, theirs, await _user(db, 1, "away"), paid=100)
    assert await service.student_balances(org.id, db) == []
    assert len(await service.student_balances(other_org.id, db)) == 1
    assert (await db.execute(select(PaymentsEnrollment))).scalars().all()


def test_balances_route_is_for_school_admins_only():
    from src.routers.payments import require_payments_admin, router

    (route,) = [r for r in router.routes if getattr(r, "path", "") == "/{org_id}/balances"]
    assert any(d.call is require_payments_admin for d in route.dependant.dependencies)
