"""Offers paid in parts: a deposit now, the balance later, every payment a normal Paystack charge."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.payments.payments_enrollments import EnrollmentStatusEnum, PaymentsEnrollment
from src.db.payments.payments_offers import PaymentsOffer
from src.services.payments import service

USER = 42


@pytest.fixture
def paystack(monkeypatch):
    """Paystack is mocked; `started` records what checkout would have charged."""
    started = []

    async def start(secret_key, **kwargs):
        started.append(kwargs)
        return {"authorization_url": f"https://paystack.test/{kwargs['reference']}"}

    async def credentials(*a, **k):
        return SimpleNamespace(secret_key="sk_test", public_key="pk_test", mode="own", subaccount_code=None)

    monkeypatch.setattr(service, "_start_paystack_checkout", start)
    monkeypatch.setattr(service.paystack, "resolve_paystack_credentials", credentials)
    monkeypatch.setattr(service.paystack, "learner_pays_fees", lambda: False)
    return started


@pytest.fixture
async def offer(db, org):
    created = await service.create_offer(
        org.id,
        {"name": "Frontend", "offer_type": "one_time", "price_type": "customer_choice", "amount": 1000, "total_amount": 15000},
        db,
    )
    return (await db.execute(select(PaymentsOffer).where(PaymentsOffer.id == created.id))).scalars().one()


def _charge(org, offer, reference, kes):
    return {
        "reference": reference, "status": "success", "amount": int(kes * 100), "currency": "KES",
        "metadata": {"org_id": org.id, "offer_id": offer.id, "user_id": USER},
    }


async def _checkout(db, org, offer, amount=None):
    return await service.create_checkout_session(
        org.id, offer.offer_uuid, "s@test.com", USER, "https://school.test/back", db, amount=amount
    )


async def _pay(db, org, offer, reference, kes):
    await service._grant_enrollment(org.id, _charge(org, offer, reference, kes), db)
    await db.commit()


async def _enrollments(db, offer):
    return (await db.execute(select(PaymentsEnrollment).where(PaymentsEnrollment.offer_id == offer.id))).scalars().all()


class TestOfferSetup:
    async def test_full_price_must_exceed_the_minimum(self, db, org):
        for total in (1000, 500):
            with pytest.raises(HTTPException) as exc:
                await service.create_offer(
                    org.id, {"name": "x", "offer_type": "one_time", "price_type": "customer_choice", "amount": 1000, "total_amount": total}, db
                )
            assert exc.value.status_code == 400

    async def test_only_choose_your_amount_offers_can_be_paid_in_parts(self, db, org):
        with pytest.raises(HTTPException):
            await service.create_offer(org.id, {"name": "x", "offer_type": "one_time", "price_type": "fixed_price", "amount": 1000, "total_amount": 15000}, db)

    async def test_existing_offer_can_be_given_a_full_price(self, db, org):
        created = await service.create_offer(org.id, {"name": "x", "offer_type": "one_time", "price_type": "customer_choice", "amount": 1000}, db)
        assert created.total_amount is None
        updated = await service.update_offer(org.id, created.id, {"total_amount": 15000}, db)
        assert updated.total_amount == 15000
        cleared = await service.update_offer(org.id, created.id, {"total_amount": None}, db)
        assert cleared.total_amount is None


class TestDepositThenBalance:
    async def test_first_payment_is_the_deposit_and_unlocks_access(self, db, org, offer, paystack):
        await _checkout(db, org, offer)
        assert paystack[0]["amount_major"] == 1000, "starts from the minimum when no amount is chosen"
        await _pay(db, org, offer, "vb_1_a", 1000)
        (enr,) = await _enrollments(db, offer)
        assert enr.status == EnrollmentStatusEnum.completed and enr.amount_paid == 1000

    async def test_balance_checkout_defaults_to_what_is_left_and_adds_to_the_same_enrollment(self, db, org, offer, paystack):
        await _checkout(db, org, offer)
        await _pay(db, org, offer, "vb_1_a", 1000)
        paystack.clear()
        res = await _checkout(db, org, offer)
        assert res["checkout_url"].startswith("https://paystack.test/"), "a paid-up deposit does not block paying the balance"
        assert paystack[0]["amount_major"] == 14000
        assert len(await _enrollments(db, offer)) == 1, "no second enrollment is created for the balance"
        await _pay(db, org, offer, "vb_1_b", 14000)
        (enr,) = await _enrollments(db, offer)
        assert enr.amount_paid == 15000

    async def test_pay_the_balance_in_several_steps(self, db, org, offer, paystack):
        await _checkout(db, org, offer)
        await _pay(db, org, offer, "vb_1_a", 1000)
        await _checkout(db, org, offer, amount=4000)
        await _pay(db, org, offer, "vb_1_b", 4000)
        (enr,) = await _enrollments(db, offer)
        assert enr.amount_paid == 5000
        assert await service._remaining_balance(offer, USER, db) == 10000

    async def test_amount_limits(self, db, org, offer, paystack):
        await _checkout(db, org, offer)
        await _pay(db, org, offer, "vb_1_a", 1000)
        with pytest.raises(HTTPException) as low:
            await _checkout(db, org, offer, amount=400)
        assert low.value.status_code == 400 and "at least" in low.value.detail
        with pytest.raises(HTTPException) as high:
            await _checkout(db, org, offer, amount=15000)
        assert high.value.status_code == 400 and "owe" in high.value.detail

    async def test_the_last_payment_may_be_below_the_minimum(self, db, org, offer, paystack):
        await _checkout(db, org, offer)
        await _pay(db, org, offer, "vb_1_a", 1000)
        await _pay(db, org, offer, "vb_1_b", 13500)
        paystack.clear()
        await _checkout(db, org, offer, amount=500)
        assert paystack[0]["amount_major"] == 500
        await _pay(db, org, offer, "vb_1_c", 500)
        (enr,) = await _enrollments(db, offer)
        assert enr.amount_paid == 15000 and await service._remaining_balance(offer, USER, db) == 0

    async def test_fully_paid_goes_straight_back_to_the_offer(self, db, org, offer, paystack):
        await _checkout(db, org, offer, amount=15000)
        await _pay(db, org, offer, "vb_1_a", 15000)
        paystack.clear()
        assert await _checkout(db, org, offer) == {"checkout_url": "https://school.test/back"}
        assert paystack == []

    async def test_a_payment_reported_twice_is_counted_once(self, db, org, offer, paystack):
        await _checkout(db, org, offer)
        await _pay(db, org, offer, "vb_1_a", 1000)
        await _pay(db, org, offer, "vb_1_b", 4000)
        await _pay(db, org, offer, "vb_1_b", 4000)
        (enr,) = await _enrollments(db, offer)
        assert enr.amount_paid == 5000

    async def test_a_payment_below_the_minimum_is_not_accepted_as_a_deposit(self, db, org, offer, paystack):
        await _pay(db, org, offer, "vb_1_a", 400)
        assert await _enrollments(db, offer) == []


class TestStudentsWhoPaidBeforeThisExisted:
    async def test_earlier_deposit_counts_and_the_balance_can_be_paid(self, db, org, offer, paystack):
        db.add(PaymentsEnrollment(
            enrollment_uuid="enr_old", offer_id=offer.id, user_id=USER, org_id=org.id,
            status=EnrollmentStatusEnum.completed, provider_specific_data={"reference": "vb_1_old", "amount": 1000},
        ))
        await db.commit()
        assert await service._remaining_balance(offer, USER, db) == 14000
        await _checkout(db, org, offer, amount=4000)
        await _pay(db, org, offer, "vb_1_new", 4000)
        (enr,) = await _enrollments(db, offer)
        assert enr.amount_paid == 5000, "the earlier KSh 1,000 is included, not lost"
        assert await service._remaining_balance(offer, USER, db) == 10000

    async def test_my_enrollments_shows_paid_and_balance(self, db, org, offer, paystack):
        await _checkout(db, org, offer)
        await _pay(db, org, offer, "vb_1_a", 1000)
        (row,) = await service.list_my_enrollments(org.id, USER, db)
        assert (row["total_amount"], row["amount_paid"], row["balance"]) == (15000, 1000, 14000)


class TestOtherOffersAreUntouched:
    async def test_fixed_price_offer_with_an_enrollment_still_short_circuits(self, db, org, paystack):
        fixed = await service.create_offer(org.id, {"name": "Fixed", "offer_type": "one_time", "price_type": "fixed_price", "amount": 5000}, db)
        db.add(PaymentsEnrollment(enrollment_uuid="enr_f", offer_id=fixed.id, user_id=USER, org_id=org.id, status=EnrollmentStatusEnum.completed))
        await db.commit()
        row = (await db.execute(select(PaymentsOffer).where(PaymentsOffer.id == fixed.id))).scalars().one()
        assert await _checkout(db, org, row) == {"checkout_url": "https://school.test/back"}
        assert paystack == []
