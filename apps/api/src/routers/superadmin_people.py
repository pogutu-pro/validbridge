"""Platform-wide search and people profiles for the superadmin console.

Search and profiles are read-only and open to all staff. The few account actions
(sign out everywhere, unlock, mark email verified) are owner-only, need a reason,
and are audited.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLog
from src.db.organizations import Organization
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.routers.users import _invalidate_session_cache
from src.routers.superadmin import _acting_user_id, _like_pattern
from src.security.auth import revoke_user_sessions_before
from src.security.staff import OWNER, require_staff
from src.services.audit.superadmin_audit import SUPERADMIN_AUDIT_RESOURCE, record_superadmin_action

router = APIRouter()

SEARCH_LIMIT = 8


def _person(u: User) -> dict:
    return {
        "user_uuid": u.user_uuid, "username": u.username, "email": u.email,
        "name": f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username,
    }


@router.get("/search")
async def global_search(
    q: str = Query("", max_length=100),
    current_user: Any = Depends(require_staff("read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Schools and people matching a name, slug, username or email."""
    q = q.strip()
    if len(q) < 2:
        return {"people": [], "orgs": []}
    pattern = _like_pattern(q)
    users = (
        await db_session.execute(
            select(User)
            .where(or_(*(col.ilike(pattern, escape="\\") for col in (User.username, User.email, User.first_name, User.last_name))))
            .order_by(User.id.desc())
            .limit(SEARCH_LIMIT)
        )
    ).scalars().all()
    orgs = (
        await db_session.execute(
            select(Organization)
            .where(or_(Organization.name.ilike(pattern, escape="\\"), Organization.slug.ilike(pattern, escape="\\")))
            .order_by(Organization.id.desc())
            .limit(SEARCH_LIMIT)
        )
    ).scalars().all()
    return {
        "people": [_person(u) for u in users],
        "orgs": [{"id": o.id, "name": o.name, "slug": o.slug} for o in orgs],
    }


async def _get_user(db: AsyncSession, user_uuid: str) -> User:
    user = (await db.execute(select(User).where(User.user_uuid == user_uuid))).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="Person not found")
    return user


@router.get("/people/{user_uuid}")
async def person_profile(
    user_uuid: str,
    current_user: Any = Depends(require_staff("read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = await _get_user(db_session, user_uuid)
    memberships = (
        await db_session.execute(
            select(Organization.id, Organization.name, Organization.slug, Role.name, UserOrganization.creation_date)
            .join(UserOrganization, UserOrganization.org_id == Organization.id)
            .outerjoin(Role, Role.id == UserOrganization.role_id)
            .where(UserOrganization.user_id == user.id)
            .order_by(Organization.name)
        )
    ).all()
    # Console actions staff have taken on this person.
    history = (
        await db_session.execute(
            select(AuditLog)
            .where(AuditLog.resource == SUPERADMIN_AUDIT_RESOURCE, AuditLog.resource_id == user.user_uuid)
            .order_by(AuditLog.id.desc())
            .limit(20)
        )
    ).scalars().all()
    now = datetime.now(timezone.utc).isoformat()
    return {
        **_person(user),
        "email_verified": user.email_verified, "signup_method": user.signup_method,
        "created": user.creation_date, "last_login_at": user.last_login_at, "last_login_ip": user.last_login_ip,
        "failed_login_attempts": user.failed_login_attempts, "locked_until": user.locked_until,
        "locked": bool(user.locked_until and user.locked_until > now),
        "staff_role": OWNER if user.is_superadmin else user.platform_role,
        "memberships": [
            {"org_id": oid, "org_name": name, "org_slug": slug, "role": role, "joined": joined}
            for oid, name, slug, role, joined in memberships
        ],
        "history": [
            {"id": h.id, "created_at": h.created_at, "actor": h.username, "action": h.action, "reason": (h.payload or {}).get("reason")}
            for h in history
        ],
    }


class ReasonBody(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)


async def _act(request: Request, db: AsyncSession, actor: Any, user_uuid: str, action: str, reason: str, change) -> dict:
    user = await _get_user(db, user_uuid)
    before, after = change(user)
    db.add(user)
    await db.commit()
    await record_superadmin_action(
        db, _acting_user_id(actor), action, reason=reason, before=before, after=after,
        request=request, resource_id=user.user_uuid, diff_only=False, strict=True,
    )
    return {"ok": True, "user_uuid": user.user_uuid}


@router.post("/people/{user_uuid}/sign-out")
async def sign_out_everywhere(
    user_uuid: str,
    body: ReasonBody,
    request: Request,
    current_user: Any = Depends(require_staff("people_write", session_only=True)),
    db_session: AsyncSession = Depends(get_db_session),
):
    """End every session this person has. They must sign in again."""
    user = await _get_user(db_session, user_uuid)
    if not revoke_user_sessions_before(user.id):
        raise HTTPException(status_code=503, detail="Could not end the sessions right now. Try again shortly.")
    _invalidate_session_cache(user.id)
    await record_superadmin_action(
        db_session, _acting_user_id(current_user), "people.sign_out", reason=body.reason,
        request=request, resource_id=user.user_uuid, diff_only=False, strict=True,
    )
    return {"ok": True, "user_uuid": user.user_uuid}


@router.post("/people/{user_uuid}/unlock")
async def unlock_account(
    user_uuid: str,
    body: ReasonBody,
    request: Request,
    current_user: Any = Depends(require_staff("people_write", session_only=True)),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Clear a failed-login lockout."""

    def change(u: User):
        before = {"locked_until": u.locked_until, "failed_login_attempts": u.failed_login_attempts}
        u.locked_until, u.failed_login_attempts = None, 0
        return before, {"locked_until": None, "failed_login_attempts": 0}

    return await _act(request, db_session, current_user, user_uuid, "people.unlock", body.reason, change)


@router.post("/people/{user_uuid}/verify-email")
async def mark_email_verified(
    user_uuid: str,
    body: ReasonBody,
    request: Request,
    current_user: Any = Depends(require_staff("people_write", session_only=True)),
    db_session: AsyncSession = Depends(get_db_session),
):
    """For people who cannot receive the verification email."""

    def change(u: User):
        before = {"email_verified": u.email_verified}
        u.email_verified, u.email_verified_at = True, datetime.now(timezone.utc).isoformat()
        return before, {"email_verified": True}

    return await _act(request, db_session, current_user, user_uuid, "people.verify_email", body.reason, change)
