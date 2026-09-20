"""
Enrollment-based access check.

Used by the RBAC layer (security/rbac/rbac.py) as the paywall safety net: a
user who holds a completed/active enrollment for an offer always retains access
to the offer's resources, independent of UserGroup membership state (e.g. if an
admin later removes them from a synced group).
"""


from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

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


async def check_enrollment_access(
    resource_uuid: str, user_id: int, db_session: AsyncSession
) -> bool:
    """True if the user has a paid enrollment granting access to this resource."""
    if not resource_uuid or not user_id:
        return False

    offer_ids = await _offer_ids_for_resource(resource_uuid, db_session)
    if not offer_ids:
        return False

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
