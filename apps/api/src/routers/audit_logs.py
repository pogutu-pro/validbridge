"""Org-wide request audit log viewer.

Reads the append-only ``auditlog`` table written by the request audit
middleware (``src/core/middleware/audit_log.py``) and exposes it to org admins
at ``/ee/audit_logs`` — the exact surface the web client already targets.

Security mirrors ``routers/audit.py`` (the per-student dossier):
- mount-level dependency rejects anonymous callers (401) and API tokens (403);
- every handler re-verifies the caller is an admin OF ``org_id``, so an admin
  can never read another organization's audit rows (no cross-org disclosure);
- in the shared demo org, rows are scoped to the caller's own actions.
"""

import csv
import io
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLog
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.routers.analytics import _verify_org_admin, _verify_org_membership
from src.security.auth import get_current_user, resolve_acting_user_id
from src.services.demo.guards import is_demo_org
from src.services.orgs.users import _csv_safe

logger = logging.getLogger(__name__)

router = APIRouter()

_CSV_COLUMNS = [
    "id", "created_at", "user_id", "username",
    "resource", "resource_id",
    "method", "path", "action",
    "ip_address", "user_agent", "status_code",
]


# ---------------------------------------------------------------------------
# Shared guards + helpers
# ---------------------------------------------------------------------------

async def _require_admin(
    current_user, org_id: int, db_session: AsyncSession
) -> int:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    acting_id = resolve_acting_user_id(current_user)
    await _verify_org_membership(acting_id, org_id, db_session)
    await _verify_org_admin(acting_id, org_id, db_session)
    return acting_id


def _parse_datetime(value: str, name: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {name}")


def _like_pattern(search: str) -> str:
    escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _apply_filters(
    statement,
    *,
    org_id: int,
    action: str = "",
    user_id: int | None = None,
    username: str = "",
    name: str = "",
    resource: str = "",
    ip_address: str = "",
    status_code: int | None = None,
    start_date: str = "",
    end_date: str = "",
):
    statement = statement.where(AuditLog.org_id == org_id)
    if action:
        statement = statement.where(AuditLog.action.ilike(_like_pattern(action), escape="\\"))
    if user_id:
        statement = statement.where(AuditLog.user_id == user_id)
    if username:
        statement = statement.where(AuditLog.username.ilike(_like_pattern(username), escape="\\"))
    elif name:
        # The UI exposes a "name" search field; fall back to username lookup.
        statement = statement.where(AuditLog.username.ilike(_like_pattern(name), escape="\\"))
    if resource:
        statement = statement.where(AuditLog.resource == resource)
    if ip_address:
        statement = statement.where(AuditLog.ip_address.ilike(_like_pattern(ip_address), escape="\\"))
    if status_code is not None:
        statement = statement.where(AuditLog.status_code == status_code)
    if start_date:
        statement = statement.where(AuditLog.created_at >= _parse_datetime(start_date, "start_date"))
    if end_date:
        statement = statement.where(AuditLog.created_at <= _parse_datetime(end_date, "end_date"))
    return statement


def _serialize(row: AuditLog) -> dict:
    return {
        "id": row.id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "user_id": row.user_id,
        "username": row.username,
        "resource": row.resource,
        "resource_id": row.resource_id,
        "path": row.path,
        "method": row.method,
        "action": row.action,
        "ip_address": row.ip_address,
        "status_code": row.status_code,
        "payload": row.payload,
    }


# ---------------------------------------------------------------------------
# GET /ee/audit_logs/ — paginated, filtered list
# ---------------------------------------------------------------------------

# The web client calls `/ee/audit_logs/` (trailing slash), so mount the list at
# "/" to match it directly and avoid a redirect.
@router.get(
    "/",
    summary="Org-wide audit logs list",
    responses={
        200: {"description": "Paginated audit rows"},
        401: {"description": "Authentication required"},
        403: {"description": "Caller is not an org admin"},
        400: {"description": "Invalid parameter"},
    },
)
async def list_audit_logs(
    org_id: int = Query(...),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    action: str = Query(""),
    user_id: int | None = Query(None),
    username: str = Query(""),
    name: str = Query(""),
    resource: str = Query(""),
    ip_address: str = Query(""),
    status_code: int | None = Query(None),
    start_date: str = Query(""),
    end_date: str = Query(""),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    acting_id = await _require_admin(current_user, org_id, db_session)

    statement = _apply_filters(
        select(AuditLog),
        org_id=org_id,
        action=action,
        user_id=user_id,
        username=username,
        name=name,
        resource=resource,
        ip_address=ip_address,
        status_code=status_code,
        start_date=start_date,
        end_date=end_date,
    )
    if await is_demo_org(org_id, db_session):
        statement = statement.where(AuditLog.user_id == acting_id)

    total = (
        await db_session.execute(select(func.count()).select_from(statement.subquery()))
    ).scalar_one()

    rows = (
        await db_session.execute(
            statement.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
        )
    ).scalars().all()

    return {"items": [_serialize(r) for r in rows], "total": int(total)}


# ---------------------------------------------------------------------------
# GET /ee/audit_logs/export — full CSV (no pagination)
# ---------------------------------------------------------------------------

@router.get(
    "/export",
    summary="Export org-wide audit logs as CSV",
    responses={
        200: {"description": "CSV attachment"},
        401: {"description": "Authentication required"},
        403: {"description": "Caller is not an org admin"},
        400: {"description": "Invalid parameter"},
    },
)
async def export_audit_logs(
    org_id: int = Query(...),
    action: str = Query(""),
    user_id: int | None = Query(None),
    username: str = Query(""),
    name: str = Query(""),
    resource: str = Query(""),
    ip_address: str = Query(""),
    status_code: int | None = Query(None),
    start_date: str = Query(""),
    end_date: str = Query(""),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    acting_id = await _require_admin(current_user, org_id, db_session)

    statement = _apply_filters(
        select(AuditLog),
        org_id=org_id,
        action=action,
        user_id=user_id,
        username=username,
        name=name,
        resource=resource,
        ip_address=ip_address,
        status_code=status_code,
        start_date=start_date,
        end_date=end_date,
    )
    if await is_demo_org(org_id, db_session):
        statement = statement.where(AuditLog.user_id == acting_id)

    rows = (
        await db_session.execute(statement.order_by(AuditLog.created_at.asc()))
    ).scalars().all()

    def generate():
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=_CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        for row in rows:
            serialized = _serialize(row)
            ordered = {col: serialized.get(col, "") for col in _CSV_COLUMNS}
            writer.writerow({k: _csv_safe(v) for k, v in ordered.items()})
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit_logs.csv"'},
    )