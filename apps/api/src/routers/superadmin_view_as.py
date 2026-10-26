"""Read-only "view as school" for platform staff.

Staff open a short-lived grant for one school by giving a reason. While the grant
is valid they can read what that school's admins see (billing overview, invoices,
wallet ledger, members). It is read-only by construction: these are GET endpoints
over the same view builders the school uses, and there is no token that acts as a
school user. Starting a grant and opening each page is written to the audit log.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.routers import billing as school_billing
from src.routers.superadmin import _acting_user_id
from src.security.security import ALGORITHM, SECRET_KEY
from src.security.staff import capabilities_of, require_staff, staff_role_of
from src.services.audit.superadmin_audit import record_superadmin_action

router = APIRouter()

GRANT_MINUTES = 30
GRANT_TYPE = "view_as"
MONEY_PAGES = ("billing", "invoices", "ledger")
Page = Literal["billing", "invoices", "ledger", "members"]


class ViewAsBody(BaseModel):
    org_id: int
    reason: str = Field(min_length=5, max_length=1000)


def _issue(user_id: int, org_id: int) -> tuple[str, datetime]:
    expires = datetime.now(timezone.utc) + timedelta(minutes=GRANT_MINUTES)
    token = jwt.encode({"typ": GRANT_TYPE, "sub": str(user_id), "org": org_id, "exp": expires}, SECRET_KEY, algorithm=ALGORITHM)
    return token, expires


def _check_grant(token: str, user_id: int, org_id: int) -> None:
    """The grant must be ours, for this school, and unexpired."""
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="This view has expired. Start it again with a reason.")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid view grant")
    if claims.get("typ") != GRANT_TYPE or claims.get("sub") != str(user_id) or claims.get("org") != org_id:
        raise HTTPException(status_code=403, detail="This view grant is not for you or not for this school")


@router.post("/view-as")
async def start_view_as(
    body: ViewAsBody,
    request: Request,
    current_user: Any = Depends(require_staff("view_as", session_only=True)),
    db_session: AsyncSession = Depends(get_db_session),
):
    org = (await db_session.execute(select(Organization).where(Organization.id == body.org_id))).scalars().first()
    if org is None:
        raise HTTPException(status_code=404, detail="School not found")
    actor_id = _acting_user_id(current_user)
    await record_superadmin_action(
        db_session, actor_id, "view_as.start", org_id=org.id, reason=body.reason, after={"minutes": GRANT_MINUTES},
        request=request, diff_only=False, strict=True,
    )
    token, expires = _issue(actor_id, org.id)
    return {"grant": token, "expires_at": expires, "org": {"id": org.id, "name": org.name, "slug": org.slug}}


@router.get("/view-as/{org_id}/{page}")
async def view_as_page(
    org_id: int,
    page: Page,
    request: Request,
    x_view_as_grant: str = Header(default=""),
    current_user: Any = Depends(require_staff("view_as", session_only=True)),
    db_session: AsyncSession = Depends(get_db_session),
):
    actor_id = _acting_user_id(current_user)
    _check_grant(x_view_as_grant, actor_id, org_id)
    caps = capabilities_of(await staff_role_of(actor_id, db_session))
    if page in MONEY_PAGES and "billing_read" not in caps:
        raise HTTPException(status_code=403, detail="Your role cannot view billing")
    if page == "members" and "read" not in caps:
        raise HTTPException(status_code=403, detail="Your role cannot view members")

    await record_superadmin_action(
        db_session, actor_id, "view_as.page", org_id=org_id, after={"page": page}, request=request, diff_only=False, strict=True,
    )

    if page == "billing":
        data = await school_billing.api_overview(org_id, actor=None, db_session=db_session)
        data.pop("public_key", None)
        return data
    if page == "invoices":
        return await school_billing.api_invoices(org_id, actor=None, db_session=db_session)
    if page == "ledger":
        return await school_billing.api_ledger(org_id, actor=None, db_session=db_session)
    rows = (
        await db_session.execute(
            select(User, UserOrganization.role_id)
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .where(UserOrganization.org_id == org_id)
            .order_by(UserOrganization.role_id, User.first_name, User.id)
            .limit(300)
        )
    ).all()
    return [
        {"user_uuid": u.user_uuid, "name": f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username,
         "username": u.username, "email": u.email, "role_id": role_id}
        for u, role_id in rows
    ]
