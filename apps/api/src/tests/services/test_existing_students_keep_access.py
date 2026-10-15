"""Students already taking a course keep access when an offer is attached to it.

Regression: attaching a paid offer to a course locked out students who had already
started it. Only students who start afterwards should have to pay.
"""

from datetime import datetime, timedelta

import pytest

from src.db.payments.payments_groups import PaymentsOfferResource
from src.db.payments.payments_offers import PaymentsOffer
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.trails import Trail
from src.services.payments.payments_access import (
    check_enrollment_access,
    started_before_paywall,
)

T0 = datetime(2026, 10, 10, 12, 0, 0)          # the moment the offer was attached


async def _offer(db, org, course, *, archived=False, attached=T0):
    offer = PaymentsOffer(
        offer_uuid=f"offer_{course.id}_{int(archived)}", org_id=org.id, name="Paid", amount=10.0,
        is_archived=archived,
    )
    db.add(offer)
    await db.commit()
    await db.refresh(offer)
    db.add(PaymentsOfferResource(
        offer_id=offer.id, resource_uuid=course.course_uuid, org_id=org.id,
        creation_date=attached, update_date=attached,
    ))
    await db.commit()
    return offer


async def _run(db, org, course, user, created, status=StatusEnum.STATUS_IN_PROGRESS):
    trail = Trail(org_id=org.id, user_id=user.id, trail_uuid=f"trail_gf_{user.id}_{course.id}",
                  creation_date="x", update_date="x")
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    db.add(TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=user.id,
                    status=status, creation_date=created, update_date=created))
    await db.commit()


@pytest.mark.asyncio
async def test_a_student_who_started_before_the_offer_keeps_access(db, org, course, regular_user):
    await _offer(db, org, course)
    await _run(db, org, course, regular_user, str(T0 - timedelta(days=2)))
    assert await started_before_paywall(course.course_uuid, regular_user.id, db) is True
    assert await check_enrollment_access(course.course_uuid, regular_user.id, db) is True


@pytest.mark.asyncio
async def test_a_student_who_starts_after_the_offer_must_pay(db, org, course, regular_user):
    await _offer(db, org, course)
    await _run(db, org, course, regular_user, str(T0 + timedelta(hours=1)))
    assert await started_before_paywall(course.course_uuid, regular_user.id, db) is False
    assert await check_enrollment_access(course.course_uuid, regular_user.id, db) is False


@pytest.mark.asyncio
async def test_no_run_means_no_head_start(db, org, course, regular_user):
    await _offer(db, org, course)
    assert await check_enrollment_access(course.course_uuid, regular_user.id, db) is False


@pytest.mark.asyncio
async def test_a_course_that_was_left_does_not_count(db, org, course, regular_user):
    await _offer(db, org, course)
    await _run(db, org, course, regular_user, str(T0 - timedelta(days=2)), StatusEnum.STATUS_CANCELLED)
    assert await started_before_paywall(course.course_uuid, regular_user.id, db) is False


@pytest.mark.asyncio
async def test_an_unreadable_date_is_never_treated_as_a_head_start(db, org, course, regular_user):
    await _offer(db, org, course)
    await _run(db, org, course, regular_user, "not a date")
    assert await started_before_paywall(course.course_uuid, regular_user.id, db) is False


@pytest.mark.asyncio
async def test_no_live_offer_means_nothing_to_grandfather(db, org, course, regular_user):
    await _offer(db, org, course, archived=True)
    await _run(db, org, course, regular_user, str(T0 - timedelta(days=2)))
    assert await started_before_paywall(course.course_uuid, regular_user.id, db) is False
