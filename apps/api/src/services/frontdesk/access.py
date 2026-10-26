"""Who may use the front desk, and which people it may touch.

The front desk (reception) has its own rights bucket, ``frontdesk``, on the
role. A user is allowed when they are an organisation admin, or when any of their
roles in that organisation grants the bucket's action. Nothing else is implied:
the role carries no ``users``, ``roles`` or ``organizations`` rights, so the
admin endpoints stay closed to it, and every front-desk endpoint re-checks the
limits below on the server.

Limits that hold for every front-desk action:

* only STUDENTS are visible or changeable: people whose role in the organisation
  is the plain learner role. Staff (instructors, maintainers, admins, other
  reception accounts) are never listed, looked up, grouped or emailed from here;
* no role is ever assigned or changed from here, so the front desk cannot
  promote itself or anyone else;
* every lookup is scoped to the organisation in the path.
"""

from typing import Literal

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, APITokenUser
from src.security.org_auth import is_org_admin, is_org_member

STUDENT_ROLE_UUID = "role_global_user"
RECEPTION_ROLE_UUID = "role_global_reception"

Action = Literal["create", "read", "update"]


async def get_org(db: AsyncSession, org_id: int) -> Organization:
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def role_grants(db: AsyncSession, user_id: int, org_id: int, action: Action) -> bool:
    rows = (
        await db.execute(
            select(Role.rights)
            .join(UserOrganization, UserOrganization.role_id == Role.id)
            .where(UserOrganization.user_id == user_id, UserOrganization.org_id == org_id)
        )
    ).scalars().all()
    for rights in rows:
        bucket = (rights or {}).get("frontdesk") if isinstance(rights, dict) else None
        if isinstance(bucket, dict) and bucket.get(f"action_{action}") is True:
            return True
    return False


async def require_frontdesk(request: Request, db: AsyncSession, user, org_id: int, action: Action) -> Organization:
    """Raise unless ``user`` may perform ``action`` at the front desk of this organisation."""
    if isinstance(user, (AnonymousUser, APITokenUser)) or user is None:
        raise HTTPException(status_code=401, detail="Sign in to use the front desk")
    org = await get_org(db, org_id)
    if await is_org_admin(user.id, org.id, db):
        return org
    # A suspended organisation locks its members out, front desk included.
    if not await is_org_member(user.id, org.id, db):
        raise HTTPException(status_code=403, detail="You do not have front desk access")
    if await role_grants(db, user.id, org.id, action):
        return org
    raise HTTPException(status_code=403, detail="You do not have front desk access")


async def student_role_id(db: AsyncSession) -> int:
    role_id = (await db.execute(select(Role.id).where(Role.role_uuid == STUDENT_ROLE_UUID))).scalars().first()
    if role_id is None:  # pragma: no cover - the learner role is part of every install
        raise HTTPException(status_code=500, detail="Learner role is not installed")
    return int(role_id)


async def is_student_in_org(db: AsyncSession, user_id: int, org_id: int) -> bool:
    role_id = await student_role_id(db)
    return (
        await db.execute(
            select(UserOrganization.id).where(
                UserOrganization.user_id == user_id, UserOrganization.org_id == org_id, UserOrganization.role_id == role_id
            )
        )
    ).first() is not None
