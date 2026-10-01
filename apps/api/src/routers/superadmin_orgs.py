"""
Superadmin organization management: suspend, unsuspend, delete.

Every action needs a signed-in superadmin session (not an API token) and a
reason, and is audit-logged. Deleting is deliberately slow to do by accident:
suspend first → ask for a confirmation token → delete with that token and the
org's slug typed exactly. See src/services/orgs/suspension.py.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.org_suspensions import OrgSuspension
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.routers.superadmin import _acting_user_id, _invalidate_org_caches, require_session_superadmin
from src.security.superadmin import require_superadmin
from src.services.audit.superadmin_audit import record_superadmin_action
from src.services.orgs import suspension as svc

logger = logging.getLogger(__name__)
router = APIRouter()

ADMIN_ROLE_ID = 1


class Reason(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class SuspendBody(Reason):
    message: str | None = Field(default=None, max_length=500)


class DeleteBody(Reason):
    confirm_token: str = Field(max_length=200)
    confirm_slug: str = Field(max_length=200)


async def _org(org_id: int, db: AsyncSession) -> Organization:
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def _invalidate_members(org_id: int, db: AsyncSession) -> None:
    from src.routers.users import _invalidate_session_cache

    for uid in (
        await db.execute(select(UserOrganization.user_id).where(UserOrganization.org_id == org_id))
    ).scalars().all():
        _invalidate_session_cache(uid)


async def _admin_emails(org_id: int, db: AsyncSession) -> list[str]:
    from src.db.users import User

    rows = (
        await db.execute(
            select(User.email)
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .where(UserOrganization.org_id == org_id, UserOrganization.role_id == ADMIN_ROLE_ID)
        )
    ).scalars().all()
    return [e for e in rows if e][:10]


@router.get("/organizations/{org_id}/status")
async def api_org_status(
    org_id: int,
    current_user: Any = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    org = await _org(org_id, db)
    s = await svc.get_suspension(org_id, db)
    members = (await db.execute(select(func.count()).where(UserOrganization.org_id == org_id))).scalar_one()
    courses = (await db.execute(select(func.count()).where(Course.org_id == org_id))).scalar_one()
    return {
        "org_id": org_id,
        "slug": org.slug,
        "suspended": s is not None,
        "suspended_at": s.suspended_at.isoformat() if s else None,
        "reason": s.reason if s else None,
        "message": s.message if s else None,
        "members": int(members),
        "courses": int(courses),
        "is_demo": bool(org.is_demo),
    }


@router.post("/organizations/{org_id}/suspend")
async def api_suspend(
    org_id: int,
    body: SuspendBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    org = await _org(org_id, db)
    if org.is_demo:
        raise HTTPException(status_code=403, detail="The demo organization cannot be suspended.")
    actor = _acting_user_id(current_user)
    row = await svc.get_suspension(org_id, db) or OrgSuspension(org_id=org_id, reason=body.reason)
    row.reason, row.message, row.suspended_by = body.reason, body.message, actor or None
    db.add(row)
    await db.commit()
    await _invalidate_members(org_id, db)
    _invalidate_org_caches(org)
    await record_superadmin_action(
        db, actor, "org.suspend", org_id=org_id, reason=body.reason,
        before={"suspended": False}, after={"suspended": True, "message": body.message},
        request=request, strict=True,
    )
    return {"status": "suspended"}


@router.post("/organizations/{org_id}/unsuspend")
async def api_unsuspend(
    org_id: int,
    body: Reason,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    org = await _org(org_id, db)
    row = await svc.get_suspension(org_id, db)
    if row is None:
        return {"status": "active"}
    await db.delete(row)
    await db.commit()
    await _invalidate_members(org_id, db)
    _invalidate_org_caches(org)
    await record_superadmin_action(
        db, _acting_user_id(current_user), "org.unsuspend", org_id=org_id, reason=body.reason,
        before={"suspended": True}, after={"suspended": False}, request=request, strict=True,
    )
    return {"status": "active"}


@router.post("/organizations/{org_id}/delete/prepare")
async def api_prepare_delete(
    org_id: int,
    body: Reason,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """Step 1 of 2: check the org can be deleted and issue a 10-minute token."""
    org = await _org(org_id, db)
    await svc.assert_deletable(org, db)
    actor = _acting_user_id(current_user)
    members = (await db.execute(select(func.count()).where(UserOrganization.org_id == org_id))).scalar_one()
    courses = (await db.execute(select(func.count()).where(Course.org_id == org_id))).scalar_one()
    await record_superadmin_action(
        db, actor, "org.delete_prepare", org_id=org_id, reason=body.reason,
        after={"slug": org.slug}, request=request, diff_only=False,
    )
    return {
        "confirm_token": svc.make_delete_token(org_id, actor),
        "expires_in": svc.CONFIRM_TTL_SECONDS,
        "slug": org.slug,
        "name": org.name,
        "members": int(members),
        "courses": int(courses),
    }


@router.delete("/organizations/{org_id}")
async def api_delete(
    org_id: int,
    body: DeleteBody,
    request: Request,
    current_user: Any = Depends(require_session_superadmin),
    db: AsyncSession = Depends(get_db_session),
):
    """Step 2 of 2: permanently delete the org and everything in it."""
    org = await _org(org_id, db)
    await svc.assert_deletable(org, db)
    actor = _acting_user_id(current_user)
    if not svc.check_delete_token(body.confirm_token, org_id, actor):
        raise HTTPException(status_code=400, detail="Confirmation expired or invalid. Start again.")
    if body.confirm_slug.strip() != org.slug:
        raise HTTPException(status_code=400, detail="The typed slug doesn't match this organization.")

    name, slug = org.name, org.slug
    admins = await _admin_emails(org_id, db)
    await _invalidate_members(org_id, db)
    # The audit row is written first and must succeed: an irreversible action
    # never happens un-audited.
    await record_superadmin_action(
        db, actor, "org.delete", org_id=org_id, reason=body.reason,
        before={"name": name, "slug": slug}, after={"deleted": True},
        request=request, diff_only=False, strict=True,
    )
    org = await _org(org_id, db)
    await db.delete(org)  # related rows go by the database's CASCADE rules
    await db.commit()
    _invalidate_org_caches(Organization(id=org_id, slug=slug, name=name))
    logger.warning("AUDIT: superadmin %s deleted organization %s (%s)", actor, org_id, slug)

    try:
        from src.services.users.emails import send_org_deleted_email

        for email in admins:
            send_org_deleted_email(email, name)
    except Exception:
        logger.exception("org deletion emails failed")
    return {"status": "deleted", "org_id": org_id, "name": name}
