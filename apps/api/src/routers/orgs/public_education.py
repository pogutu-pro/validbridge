"""Org-facing Public Education application endpoints (org admins only)."""

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.security.features_utils.dependencies import require_org_admin
from src.services.orgs.public_education import (
    PublicEdApplicationRead,
    get_latest_application,
    submit_application,
    to_read,
)

router = APIRouter()


@router.get(
    "/{org_id}/public-education/application",
    response_model=Optional[PublicEdApplicationRead],
    summary="Get the org's Public Education application",
    description="Latest Public Education verification application for this organization, or null.",
    dependencies=[Depends(require_org_admin)],
)
async def api_get_public_ed_application(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
) -> Optional[PublicEdApplicationRead]:
    app = await get_latest_application(org_id, db_session)
    return to_read(app) if app else None


@router.post(
    "/{org_id}/public-education/application",
    response_model=PublicEdApplicationRead,
    summary="Apply for Public Education access",
    description=(
        "Create or update a pending Public Education verification application. "
        "The optional registration document (PDF/JPG/PNG, 5 MB max) is stored privately."
    ),
    dependencies=[Depends(require_org_admin)],
)
async def api_submit_public_ed_application(
    org_id: int,
    institution: str = Form(...),
    institution_type: str = Form(...),
    reg_number: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    agreement_accepted: bool = Form(False),
    document: Optional[UploadFile] = File(None),
    db_session: AsyncSession = Depends(get_db_session),
) -> PublicEdApplicationRead:
    app = await submit_application(
        org_id,
        institution=institution,
        institution_type=institution_type,
        reg_number=reg_number,
        email=email,
        agreement_accepted=agreement_accepted,
        document=document,
        db_session=db_session,
    )
    return to_read(app)
