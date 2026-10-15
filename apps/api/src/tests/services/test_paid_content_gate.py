"""Who sees a lesson's content when its course is behind a paid offer.

Regression: the gate exempted only superadmins, so attaching an offer to a course
blanked the lesson for the instructor building it (including in the editor, where
they saw an empty lesson and could not add a quiz) while the permission layer
correctly let them through.
"""

import pytest
from fastapi import HTTPException

from src.core import ee_hooks
from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)


async def _lesson(db, org, course):
    activity = Activity(
        id=9901, name="Lesson", activity_uuid="activity_paywall_1",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        published=True, org_id=org.id, course_id=course.id, content={"type": "doc"},
        creation_date="x", update_date="x",
    )
    db.add(activity)
    await db.commit()
    return activity


@pytest.fixture
def paid_course(monkeypatch):
    """The course is behind a paid offer, and nobody is enrolled."""
    import src.services.payments.payments_access as pa
    import src.security.superadmin as sa

    async def offer(*_a, **_k):
        return {"offer_id": 1, "offer_name": "Paid", "amount": 10, "currency": "KES"}

    async def not_enrolled(*_a, **_k):
        return False

    async def not_superadmin(*_a, **_k):
        return False

    monkeypatch.setattr(pa, "get_paywall_offer", offer)
    monkeypatch.setattr(pa, "check_enrollment_access", not_enrolled)
    monkeypatch.setattr(sa, "is_user_superadmin", not_superadmin)
    return pa


def _staff(monkeypatch, is_staff):
    import src.security.rbac as rbac

    async def fake_check(*_a, **_k):
        if not is_staff:
            raise HTTPException(status_code=403, detail="no")

    monkeypatch.setattr(rbac, "check_resource_access", fake_check)


@pytest.mark.asyncio
async def test_staff_see_the_content_of_a_paid_course(db, org, course, regular_user, paid_course, monkeypatch):
    activity = await _lesson(db, org, course)
    _staff(monkeypatch, True)
    assert await ee_hooks.check_ee_activity_paid_access(None, activity.id, regular_user, db) is True


@pytest.mark.asyncio
async def test_a_student_without_a_purchase_is_still_gated(db, org, course, regular_user, paid_course, monkeypatch):
    activity = await _lesson(db, org, course)
    _staff(monkeypatch, False)
    assert await ee_hooks.check_ee_activity_paid_access(None, activity.id, regular_user, db) is False


@pytest.mark.asyncio
async def test_an_enrolled_student_sees_the_content(db, org, course, regular_user, paid_course, monkeypatch):
    activity = await _lesson(db, org, course)
    _staff(monkeypatch, False)

    async def enrolled(*_a, **_k):
        return True

    monkeypatch.setattr(paid_course, "check_enrollment_access", enrolled)
    assert await ee_hooks.check_ee_activity_paid_access(None, activity.id, regular_user, db) is True


@pytest.mark.asyncio
async def test_a_free_course_is_open_to_everyone(db, org, course, regular_user, paid_course, monkeypatch):
    activity = await _lesson(db, org, course)
    _staff(monkeypatch, False)

    async def no_offer(*_a, **_k):
        return None

    monkeypatch.setattr(paid_course, "get_paywall_offer", no_offer)
    assert await ee_hooks.check_ee_activity_paid_access(None, activity.id, regular_user, db) is True


@pytest.mark.asyncio
async def test_visitors_without_an_account_stay_gated(db, org, course, paid_course):
    activity = await _lesson(db, org, course)

    class Anon:
        id = None

    assert await ee_hooks.check_ee_activity_paid_access(None, activity.id, Anon(), db) is False
