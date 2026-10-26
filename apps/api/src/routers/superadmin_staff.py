"""Platform staff management and the superadmin audit viewer.

Staff tiers (``security/staff.py``): owners are managed in the database; owners can
give an existing user Support or Finance access here and take it away again.
The audit viewer reads the ``auditlog`` table: by default only superadmin actions
(who changed what, why, before and after); owners can also read raw request rows.
Finance can read only the money rows.
"""

import csv
import io
from datetime import datetime
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLog
from src.db.organizations import Organization
from src.db.users import User
from src.routers.superadmin import _acting_user_id, _like_pattern
from src.security.staff import FINANCE, LIMITED_ROLES, OWNER, require_staff, staff_role_of
from src.services.audit.superadmin_audit import SUPERADMIN_AUDIT_RESOURCE, record_superadmin_action

router = APIRouter()

MAX_PAGE = 100
EXPORT_LIMIT = 5000


# ---------------------------------------------------------------------------
# Staff
# ---------------------------------------------------------------------------


def _staff_row(u: User) -> dict:
    return {
        "user_uuid": u.user_uuid, "username": u.username, "email": u.email, "name": f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username,
        "role": OWNER if u.is_superadmin else u.platform_role, "last_login_at": u.last_login_at,
    }


@router.get("/staff")
async def list_staff(
    current_user: Any = Depends(require_staff("staff_manage")),
    db_session: AsyncSession = Depends(get_db_session),
):
    rows = (
        await db_session.execute(
            select(User).where(or_(User.is_superadmin.is_(True), User.platform_role.in_(LIMITED_ROLES))).order_by(User.is_superadmin.desc(), User.first_name, User.id)
        )
    ).scalars().all()
    return {"items": [_staff_row(u) for u in rows]}


class StaffRoleBody(BaseModel):
    role: Optional[Literal["support", "finance"]] = None
    reason: str = Field(min_length=3, max_length=1000)


class StaffAddBody(StaffRoleBody):
    email: str = Field(min_length=3, max_length=254)


async def _set_role(request: Request, db: AsyncSession, actor: Any, target: User, role: Optional[str], reason: str) -> dict:
    if target.is_superadmin:
        raise HTTPException(status_code=409, detail="Owners are managed in the database, not here")
    actor_id = _acting_user_id(actor)
    if target.id == actor_id:
        raise HTTPException(status_code=409, detail="You cannot change your own access")
    before = target.platform_role
    target.platform_role = role
    db.add(target)
    await db.commit()
    await db.refresh(target)
    try:
        from src.routers.users import _invalidate_session_cache

        _invalidate_session_cache(target.id)  # so the new access shows on their next page load
    except Exception:  # pragma: no cover - cache is an optimisation
        pass
    await record_superadmin_action(
        db, actor_id, "staff.role_change", reason=reason, before={"role": before}, after={"role": role},
        request=request, resource_id=target.user_uuid, diff_only=False, strict=True,
    )
    return _staff_row(target)


@router.put("/staff/{user_uuid}")
async def set_staff_role(
    user_uuid: str, body: StaffRoleBody, request: Request,
    current_user: Any = Depends(require_staff("staff_manage", session_only=True)),
    db_session: AsyncSession = Depends(get_db_session),
):
    target = (await db_session.execute(select(User).where(User.user_uuid == user_uuid))).scalars().first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    return await _set_role(request, db_session, current_user, target, body.role, body.reason)


@router.post("/staff")
async def add_staff(
    body: StaffAddBody, request: Request,
    current_user: Any = Depends(require_staff("staff_manage", session_only=True)),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Give an existing account Support or Finance access, found by email."""
    if body.role is None:
        raise HTTPException(status_code=422, detail="Choose support or finance")
    target = (await db_session.execute(select(User).where(func.lower(User.email) == body.email.strip().lower()))).scalars().first()
    if target is None:
        raise HTTPException(status_code=404, detail="No account with that email. They need to sign up first.")
    return await _set_role(request, db_session, current_user, target, body.role, body.reason)


# ---------------------------------------------------------------------------
# Audit viewer
# ---------------------------------------------------------------------------


def _filtered(
    kind: str, role: str, actor: str, org_id: Optional[int], action: str, q: str, since: Optional[datetime], until: Optional[datetime]
):
    stmt = select(AuditLog, Organization.name).outerjoin(Organization, Organization.id == AuditLog.org_id)
    if kind == "requests":
        stmt = stmt.where(or_(AuditLog.resource.is_(None), AuditLog.resource != SUPERADMIN_AUDIT_RESOURCE))
    else:
        stmt = stmt.where(AuditLog.resource == SUPERADMIN_AUDIT_RESOURCE)
    if role == FINANCE:
        # Finance reads the money trail only.
        stmt = stmt.where(AuditLog.action.like("superadmin.billing.%"))
    if actor.strip():
        stmt = stmt.where(AuditLog.username.ilike(_like_pattern(actor.strip()), escape="\\"))
    if org_id is not None:
        stmt = stmt.where(AuditLog.org_id == org_id)
    if action.strip():
        stmt = stmt.where(AuditLog.action.ilike(_like_pattern(action.strip()), escape="\\"))
    if q.strip():
        pattern = _like_pattern(q.strip())
        stmt = stmt.where(or_(AuditLog.action.ilike(pattern, escape="\\"), AuditLog.username.ilike(pattern, escape="\\"),
                              AuditLog.resource_id.ilike(pattern, escape="\\"), AuditLog.path.ilike(pattern, escape="\\")))
    if since is not None:
        stmt = stmt.where(AuditLog.created_at >= since)
    if until is not None:
        stmt = stmt.where(AuditLog.created_at <= until)
    return stmt


def _item(row: AuditLog, org_name: Optional[str]) -> dict:
    payload = row.payload if isinstance(row.payload, dict) else {}
    return {
        "id": row.id, "created_at": row.created_at, "actor_id": row.user_id, "actor": row.username, "action": row.action,
        "org_id": row.org_id, "org_name": org_name, "resource_id": row.resource_id, "reason": payload.get("reason"),
        "before": payload.get("before"), "after": payload.get("after"), "ip_address": row.ip_address,
        "method": row.method, "path": row.path, "status_code": row.status_code,
    }


async def _caller_role(current_user: Any, db: AsyncSession) -> str:
    user_id = getattr(current_user, "created_by_user_id", None) or current_user.id
    return await staff_role_of(user_id, db) or OWNER


def _guard_kind(kind: str, role: str) -> None:
    if kind == "requests" and role != OWNER:
        raise HTTPException(status_code=403, detail="Only owners can read raw request logs")


@router.get("/audit")
async def audit_log(
    kind: Literal["actions", "requests"] = "actions", actor: str = "", org_id: Optional[int] = None, action: str = "", q: str = "",
    since: Optional[datetime] = None, until: Optional[datetime] = None,
    page: int = Query(default=1, ge=1), limit: int = Query(default=25, ge=1, le=MAX_PAGE),
    current_user: Any = Depends(require_staff("audit_read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    role = await _caller_role(current_user, db_session)
    _guard_kind(kind, role)
    stmt = _filtered(kind, role, actor, org_id, action, q, since, until)
    total = int((await db_session.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0)
    rows = (await db_session.execute(stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).offset((page - 1) * limit).limit(limit))).all()
    return {"items": [_item(r, name) for r, name in rows], "total": total, "page": page, "limit": limit, "role": role}


@router.get("/audit/export")
async def audit_export(
    request: Request,
    kind: Literal["actions", "requests"] = "actions", actor: str = "", org_id: Optional[int] = None, action: str = "", q: str = "",
    since: Optional[datetime] = None, until: Optional[datetime] = None,
    current_user: Any = Depends(require_staff("audit_read", session_only=True)),
    db_session: AsyncSession = Depends(get_db_session),
):
    role = await _caller_role(current_user, db_session)
    _guard_kind(kind, role)
    stmt = _filtered(kind, role, actor, org_id, action, q, since, until)
    rows = (await db_session.execute(stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(EXPORT_LIMIT))).all()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["time", "actor", "action", "school", "reference", "reason", "before", "after", "ip"])
    for row, org_name in rows:
        it = _item(row, org_name)
        # A leading = + - @ would be run as a formula by a spreadsheet; neutralise it.
        safe = lambda v: ("'" + str(v)) if isinstance(v, str) and v[:1] in "=+-@" else ("" if v is None else v)  # noqa: E731
        writer.writerow([it["created_at"].isoformat() if it["created_at"] else "", safe(it["actor"]), safe(it["action"]), safe(it["org_name"]),
                         safe(it["resource_id"]), safe(it["reason"]), safe(str(it["before"]) if it["before"] is not None else ""),
                         safe(str(it["after"]) if it["after"] is not None else ""), safe(it["ip_address"])])
    await record_superadmin_action(
        db_session, _acting_user_id(current_user), "audit.export", reason=f"{len(rows)} rows ({kind})", request=request, diff_only=False,
    )
    return Response(content=out.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="audit-log.csv"'})
