"""
Enrollment-based access check.

Used by the RBAC layer (security/rbac/rbac.py) as the paywall safety net: a
user who holds a completed/active enrollment for an offer always retains access
to the offer's resources, independent of UserGroup membership state (e.g. if an
admin later removes them from a synced group).
"""


from datetime import datetime

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.trail_runs import StatusEnum, TrailRun

from src.db.payments.payments_enrollments import (
    EnrollmentStatusEnum,
    PaymentsEnrollment,
)
from src.db.payments.payments_groups import PaymentsGroupResource, PaymentsOfferResource
from src.db.payments.payments_offers import PaymentsOffer

GRANTING_STATUSES = (EnrollmentStatusEnum.completed, EnrollmentStatusEnum.active)


async def _offer_ids_for_resource(resource_uuid: str, db_session: AsyncSession) -> set[int]:
    """Offer ids that include ``resource_uuid``, directly or via a payments group.

    Archived offers are ignored so retiring an offer stops it from gating
    resources (its enrollment history is preserved elsewhere).
    """
    offer_ids: set[int] = set(
        (
            await db_session.execute(
                select(PaymentsOfferResource.offer_id)
                .join(PaymentsOffer, PaymentsOffer.id == PaymentsOfferResource.offer_id)
                .where(
                    PaymentsOfferResource.resource_uuid == resource_uuid,
                    PaymentsOffer.is_archived.is_(False),
                )
            )
        ).scalars().all()
    )

    group_ids = set(
        (
            await db_session.execute(
                select(PaymentsGroupResource.payments_group_id).where(
                    PaymentsGroupResource.resource_uuid == resource_uuid
                )
            )
        ).scalars().all()
    )
    if group_ids:
        offer_ids.update(
            (
                await db_session.execute(
                    select(PaymentsOffer.id).where(
                        PaymentsOffer.payments_group_id.in_(group_ids),
                        PaymentsOffer.is_archived.is_(False),
                    )
                )
            ).scalars().all()
        )
    return offer_ids


async def get_paywall_offer(resource_uuid: str, db_session: AsyncSession) -> dict | None:
    """Return offer metadata if this resource is behind a paid offer, else None."""
    offer_ids = await _offer_ids_for_resource(resource_uuid, db_session)
    if not offer_ids:
        return None
    offer = (
        await db_session.execute(
            select(PaymentsOffer).where(PaymentsOffer.id.in_(offer_ids))
        )
    ).scalars().first()
    if offer is None:
        return None
    return {
        "offer_id": offer.id,
        "offer_uuid": offer.offer_uuid,
        "offer_name": offer.name,
        "amount": offer.amount,
        "currency": offer.currency,
    }


_COUNTS_AS_STARTED = (
    StatusEnum.STATUS_IN_PROGRESS,
    StatusEnum.STATUS_COMPLETED,
    StatusEnum.STATUS_PAUSED,
)


async def _paywall_since(resource_uuid: str, db_session: AsyncSession) -> datetime | None:
    """When the resource first went behind a live (non-archived) offer, or None."""
    direct = (
        await db_session.execute(
            select(PaymentsOfferResource.creation_date)
            .join(PaymentsOffer, PaymentsOffer.id == PaymentsOfferResource.offer_id)
            .where(
                PaymentsOfferResource.resource_uuid == resource_uuid,
                PaymentsOffer.is_archived.is_(False),
            )
        )
    ).scalars().all()
    grouped = (
        await db_session.execute(
            select(PaymentsGroupResource.creation_date)
            .join(PaymentsOffer, PaymentsOffer.payments_group_id == PaymentsGroupResource.payments_group_id)
            .where(
                PaymentsGroupResource.resource_uuid == resource_uuid,
                PaymentsOffer.is_archived.is_(False),
            )
        )
    ).scalars().all()
    times = [t for t in [*direct, *grouped] if t is not None]
    return min(times) if times else None


async def started_before_paywall(
    resource_uuid: str, user_id: int, db_session: AsyncSession
) -> bool:
    """True for a student who was already taking this course before it went behind
    an offer.

    Putting a paid offer on a course that has students in it must not lock out the
    people in the middle of it; only students who start afterwards have to pay.
    Anything we cannot read with certainty (no run, an unparseable date) is NOT
    treated as a head start, so this can only ever keep existing students in.
    """
    if not resource_uuid or not user_id:
        return False
    since = await _paywall_since(resource_uuid, db_session)
    if since is None:
        return False
    course_id = (
        await db_session.execute(select(Course.id).where(Course.course_uuid == resource_uuid))
    ).scalars().first()
    if course_id is None:
        return False
    runs = (
        await db_session.execute(
            select(TrailRun.creation_date).where(
                TrailRun.course_id == course_id,
                TrailRun.user_id == user_id,
                TrailRun.status.in_(_COUNTS_AS_STARTED),
            )
        )
    ).scalars().all()
    for created in runs:
        try:
            if datetime.fromisoformat(str(created)) < since:
                return True
        except (TypeError, ValueError):
            continue
    return False


async def check_enrollment_access(
    resource_uuid: str, user_id: int, db_session: AsyncSession
) -> bool:
    """True if the user has a paid enrollment granting access to this resource, or
    started the course before it went behind an offer."""
    if not resource_uuid or not user_id:
        return False

    offer_ids = await _offer_ids_for_resource(resource_uuid, db_session)
    if not offer_ids:
        return False

    try:
        if await started_before_paywall(resource_uuid, user_id, db_session):
            return True
    except Exception:
        pass  # cannot decide: no head start, fall through to the enrolment check

    enrollment = (
        await db_session.execute(
            select(PaymentsEnrollment.id).where(
                PaymentsEnrollment.offer_id.in_(offer_ids),
                PaymentsEnrollment.user_id == user_id,
                PaymentsEnrollment.status.in_(GRANTING_STATUSES),
            )
        )
    ).scalars().first()

    return enrollment is not None
