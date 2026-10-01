"""
Payments → usergroup sync.

A payments group can back a usergroup so that buyers of its offers are granted
access through the platform's standard usergroup machinery (course listings,
content access, communities, certificates) in addition to the enrollment paywall
(enforced separately in ``payments_access.py``).

  1. The sync target usergroup is created lazily the first time a buyer is
     granted or an admin triggers a manual sync, and is recorded on
     ``PaymentsGroup.usergroup_id``.
  2. Membership mirrors enrollments: a buyer is a member while any of the
     group's offers holds a completed/active enrollment for them.
  3. Resources mirror the group's resources plus the resources of every offer
     linked to the group (union, adding missing and dropping stale).

All functions are idempotent and do not commit — callers decide the
transaction boundary (the webhook handler commits once at the end; the manual
sync endpoint commits through ``service.sync_group``).
"""

import uuid
from datetime import datetime

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.payments.payments_enrollments import (
    EnrollmentStatusEnum,
    PaymentsEnrollment,
)
from src.db.payments.payments_groups import (
    PaymentsGroup,
    PaymentsGroupResource,
    PaymentsOfferResource,
)
from src.db.payments.payments_offers import PaymentsOffer
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup

GRANTING_STATUSES = (EnrollmentStatusEnum.completed, EnrollmentStatusEnum.active)


async def load_group(group_id: int | None, db_session: AsyncSession) -> PaymentsGroup | None:
    """Fetch a payments group by id, returning None instead of raising."""
    if group_id is None:
        return None
    return (
        await db_session.execute(
            select(PaymentsGroup).where(PaymentsGroup.id == group_id)
        )
    ).scalars().first()


async def get_or_create_sync_usergroup(
    group: PaymentsGroup, db_session: AsyncSession
) -> UserGroup:
    """Return the usergroup backing ``group``, creating it on first use.

    The group's ``usergroup_id`` is written back (the caller's transaction
    persists it on commit).
    """
    if group.usergroup_id is not None:
        existing = (
            await db_session.execute(
                select(UserGroup).where(UserGroup.id == group.usergroup_id)
            )
        ).scalars().first()
        if existing is not None:
            return existing

    description = f"Auto-synced from payment group '{group.name}' — managed by ValidBridge payments."
    if group.description:
        description = f"{group.description}\n{description}"
    usergroup = UserGroup(
        org_id=group.org_id,
        name=f"Payments — {group.name}",
        description=description,
        usergroup_uuid=f"usergroup_{uuid.uuid4()}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(usergroup)
    await db_session.flush()
    group.usergroup_id = usergroup.id
    group.update_date = datetime.now()
    db_session.add(group)
    return usergroup


async def _group_offer_ids(group_id: int, db_session: AsyncSession) -> set[int]:
    """Ids of non-archived offers linked to the payments group."""
    return set(
        (
            await db_session.execute(
                select(PaymentsOffer.id).where(
                    PaymentsOffer.payments_group_id == group_id,
                    PaymentsOffer.is_archived.is_(False),
                )
            )
        ).scalars().all()
    )


async def _user_has_granting_enrollment(
    group: PaymentsGroup, user_id: int, db_session: AsyncSession
) -> bool:
    """True if the user holds a granting enrollment on any of the group's offers."""
    offer_ids = await _group_offer_ids(group.id, db_session)
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


async def sync_offer_buyer(
    group: PaymentsGroup,
    offer_id: int,
    user_id: int,
    *,
    granted: bool,
    db_session: AsyncSession,
) -> bool:
    """Add or remove a buyer from the group's sync usergroup.

    ``granted=False`` only removes the user if they hold no other granting
    enrollment on the group's offers (a refunded offer must not yank access
    that a second, still-active offer grants).

    Returns True when membership changed.
    """
    usergroup = await get_or_create_sync_usergroup(group, db_session)

    if not granted:
        desired = await _user_has_granting_enrollment(group, user_id, db_session)
    else:
        desired = True

    row = (
        await db_session.execute(
            select(UserGroupUser).where(
                UserGroupUser.usergroup_id == usergroup.id,
                UserGroupUser.user_id == user_id,
            )
        )
    ).scalars().first()

    if desired and row is None:
        db_session.add(
            UserGroupUser(
                usergroup_id=usergroup.id,
                user_id=user_id,
                org_id=group.org_id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        return True
    if not desired and row is not None:
        await db_session.delete(row)
        return True
    return False


async def _desired_resource_uuids(
    group_id: int, db_session: AsyncSession
) -> set[str]:
    uuids: set[str] = set(
        (
            await db_session.execute(
                select(PaymentsGroupResource.resource_uuid).where(
                    PaymentsGroupResource.payments_group_id == group_id
                )
            )
        ).scalars().all()
    )
    offer_ids = await _group_offer_ids(group_id, db_session)
    if offer_ids:
        uuids.update(
            (
                await db_session.execute(
                    select(PaymentsOfferResource.resource_uuid).where(
                        PaymentsOfferResource.offer_id.in_(offer_ids)
                    )
                )
            ).scalars().all()
        )
    return uuids


async def reconcile_group_resources(
    group: PaymentsGroup, db_session: AsyncSession
) -> tuple[int, int]:
    """Mirror the group's resource set into its usergroup.

    Returns ``(added, removed)`` counts.
    """
    usergroup = await get_or_create_sync_usergroup(group, db_session)
    desired = await _desired_resource_uuids(group.id, db_session)

    current_rows = (
        await db_session.execute(
            select(UserGroupResource).where(
                UserGroupResource.usergroup_id == usergroup.id
            )
        )
    ).scalars().all()
    current = {row.resource_uuid: row for row in current_rows}

    added = 0
    for resource_uuid in desired:
        if resource_uuid not in current:
            db_session.add(
                UserGroupResource(
                    usergroup_id=usergroup.id,
                    resource_uuid=resource_uuid,
                    org_id=group.org_id,
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                )
            )
            added += 1

    removed = 0
    for resource_uuid, row in current.items():
        if resource_uuid not in desired:
            await db_session.delete(row)
            removed += 1

    return added, removed


async def reconcile_group_members(
    group: PaymentsGroup, db_session: AsyncSession
) -> tuple[int, int]:
    """Reconcile the usergroup's members with the group's granting enrollments.

    Returns ``(added, removed)`` counts.
    """
    usergroup = await get_or_create_sync_usergroup(group, db_session)

    offer_ids = await _group_offer_ids(group.id, db_session)
    desired_users: set[int] = set()
    if offer_ids:
        desired_users = set(
            (
                await db_session.execute(
                    select(PaymentsEnrollment.user_id).where(
                        PaymentsEnrollment.offer_id.in_(offer_ids),
                        PaymentsEnrollment.status.in_(GRANTING_STATUSES),
                    )
                )
            ).scalars().all()
        )

    current_rows = (
        await db_session.execute(
            select(UserGroupUser).where(
                UserGroupUser.usergroup_id == usergroup.id
            )
        )
    ).scalars().all()
    current = {row.user_id: row for row in current_rows}

    added = 0
    for user_id in desired_users:
        if user_id not in current:
            db_session.add(
                UserGroupUser(
                    usergroup_id=usergroup.id,
                    user_id=user_id,
                    org_id=group.org_id,
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                )
            )
            added += 1

    removed = 0
    for user_id, row in current.items():
        if user_id not in desired_users:
            await db_session.delete(row)
            removed += 1

    return added, removed