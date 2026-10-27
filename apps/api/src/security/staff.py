"""Platform staff tiers.

Three kinds of platform staff:

* **owner**: ``User.is_superadmin``. Full power; this is the flag the whole platform
  already treats as an all-access bypass, so it is unchanged.
* **support** and **finance**: ``User.platform_role``. They are NOT superadmins, so
  none of the platform's tenant-level bypasses ever applies to them. They can only
  use the platform console, and only for the capabilities listed here. That makes a
  new tier safe by default: forgetting to restrict something leaves it owner-only.

Every console route names the capability it needs (``require_staff``), and the
server decides. The UI only hides what the server would refuse.
"""

import functools
from typing import Any, Optional

from fastapi import Depends, HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import User
from src.security.superadmin import (
    _get_current_user_lazy,
    ensure_ee_superadmin_surface,
    ensure_superadmin_2fa,
    is_user_superadmin,
)

OWNER, SUPPORT, FINANCE = "owner", "support", "finance"
LIMITED_ROLES = (SUPPORT, FINANCE)

# What each capability allows:
#   read           look at schools, people, courses, usage and analytics
#   billing_read   look at money: invoices, wallet, plans, reports
#   billing_write  change money: record payments, void, refund, adjust, overrides, deals
#   trial_grant    start a free trial (reversible, so Support may do it too)
#   audit_read     read the audit trail (finance sees only the money rows)
#   org_write      create schools and change their plan, features and settings
#   destructive    suspend, restore and delete schools
#   tokens         platform API tokens
#   billing_admin  catalogue, enforcement mode and the billing run
#   staff_manage   grant or remove Support and Finance access
#   people_write   sign people out, unlock accounts, mark email verified
#   revenue_read   see what each school collects from its own students
#   view_as        open a reason-gated, read-only view of what a school sees
ALL_CAPABILITIES = frozenset({
    "read", "billing_read", "billing_write", "trial_grant", "audit_read", "org_write", "destructive", "tokens", "billing_admin", "staff_manage", "view_as", "people_write", "revenue_read",
})
CAPABILITIES: dict[str, frozenset[str]] = {
    OWNER: ALL_CAPABILITIES,
    SUPPORT: frozenset({"read", "billing_read", "trial_grant", "audit_read", "view_as"}),
    FINANCE: frozenset({"read", "billing_read", "billing_write", "trial_grant", "audit_read", "view_as", "revenue_read"}),
}


def capabilities_of(role: Optional[str]) -> frozenset[str]:
    return CAPABILITIES.get(role or "", frozenset())


async def staff_role_of(user_id: int, db: AsyncSession) -> Optional[str]:
    """owner, support, finance, or None for someone who is not platform staff."""
    row = (await db.execute(select(User.is_superadmin, User.platform_role).where(User.id == user_id))).first()
    if row is None:
        return None
    if row[0]:
        return OWNER
    return row[1] if row[1] in LIMITED_ROLES else None


@functools.lru_cache(maxsize=None)
def require_staff(capability: str, *, session_only: bool = False):
    """Dependency factory: the caller must be platform staff whose tier grants ``capability``.

    ``session_only`` additionally refuses API tokens (used for money, deletion and
    staff management, which must come from a signed-in person). It is built on the
    plain dependency, so identity is resolved in exactly one place.
    """
    if capability not in ALL_CAPABILITIES:
        raise ValueError(f"unknown capability {capability!r}")

    if session_only:
        base = require_staff(capability)

        async def session_dependency(current_user: Any = Depends(base)) -> Any:
            from src.db.users import APITokenUser, SuperadminAPITokenUser

            if isinstance(current_user, (SuperadminAPITokenUser, APITokenUser)):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This endpoint requires a signed-in superadmin session, not an API token",
                )
            return current_user

        session_dependency.__name__ = f"require_staff_{capability}_session"
        return session_dependency

    async def dependency(current_user=Depends(_get_current_user_lazy), db_session: AsyncSession = Depends(get_db_session)) -> Any:
        from src.db.users import AnonymousUser, APITokenUser, SuperadminAPITokenUser

        if isinstance(current_user, AnonymousUser):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
        ensure_ee_superadmin_surface()
        if isinstance(current_user, APITokenUser):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Superadmin access required")
        if isinstance(current_user, SuperadminAPITokenUser):
            # Platform tokens act with the owner's power, and only while their creator is still an owner.
            if not await is_user_superadmin(current_user.created_by_user_id, db_session):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token creator is no longer a superadmin")
            return current_user

        role = await staff_role_of(current_user.id, db_session)
        if role is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Superadmin access required")
        if capability not in capabilities_of(role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your {role} access does not include this action. Ask an owner.",
            )
        await ensure_superadmin_2fa(current_user, db_session)
        return current_user

    dependency.__name__ = f"require_staff_{capability}"
    _ISSUED.append(dependency)
    return dependency


# Every identity dependency handed out above, so tests can stand in for the signed-in staff member.
_ISSUED: list = []


def all_staff_dependencies() -> list:
    return list(_ISSUED)
