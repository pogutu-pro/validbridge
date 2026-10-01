"""Public Education verification applications (pricechange.md §7, W7).

An org admin applies once with institution details and, optionally, a
registration document. A platform superadmin approves (org moves to the
``public-education`` plan for 12 months) or rejects. Documents are written
under ``orgs/{uuid}/private/public_education/`` which the public content
routes refuse to serve (see ``is_private_org_file``).
"""

from __future__ import annotations

import calendar
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.billing._common import utcnow
from src.db.billing.public_education import PublicEdApplication
from src.db.organizations import Organization

AGREEMENT_VERSION = "2026-09"
INSTITUTION_TYPES = (
    "public_primary",
    "public_secondary",
    "tvet",
    "public_university",
    "government_training",
)
OFFICIAL_EMAIL_SUFFIXES = (".ac.ke", ".sc.ke", ".go.ke", ".ed.ke")
DOCUMENT_MAX_BYTES = 5 * 1024 * 1024
PRIVATE_DOC_DIR = "private/public_education"
PUBLIC_ED_PLAN = "public-education"


class PublicEdApplicationRead(BaseModel):
    id: int
    org_id: int
    status: str
    institution: str
    type: str
    reg_number: Optional[str] = None
    email_domain: Optional[str] = None
    official_domain: bool = False
    has_document: bool = False
    agreement_version: Optional[str] = None
    review_note: Optional[str] = None
    created_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


def is_official_domain(domain: Optional[str]) -> bool:
    d = (domain or "").strip().lower()
    return any(d.endswith(s) for s in OFFICIAL_EMAIL_SUFFIXES)


def email_domain_of(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return None
    domain = email.rsplit("@", 1)[1].strip().lower()
    return domain[:255] or None


def add_months(dt: datetime, months: int) -> datetime:
    month_index = dt.month - 1 + months
    year = dt.year + month_index // 12
    month = month_index % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def to_read(app: PublicEdApplication) -> PublicEdApplicationRead:
    return PublicEdApplicationRead(
        id=int(app.id or 0),
        org_id=app.org_id,
        status=app.status,
        institution=app.institution,
        type=app.type,
        reg_number=app.reg_number,
        email_domain=app.email_domain,
        official_domain=is_official_domain(app.email_domain),
        has_document=bool(app.document_key),
        agreement_version=app.agreement_version,
        review_note=app.review_note,
        created_at=app.created_at,
        reviewed_at=app.reviewed_at,
        expires_at=app.expires_at,
    )


async def get_latest_application(
    org_id: int, db_session: AsyncSession
) -> Optional[PublicEdApplication]:
    return (
        await db_session.execute(
            select(PublicEdApplication)
            .where(PublicEdApplication.org_id == org_id)
            .order_by(PublicEdApplication.id.desc())  # type: ignore[union-attr]
        )
    ).scalars().first()


async def _store_document(org: Organization, document: UploadFile) -> str:
    from src.services.utils.upload_content import upload_file

    filename = await upload_file(
        file=document,
        directory=PRIVATE_DOC_DIR,
        type_of_dir="orgs",
        uuid=org.org_uuid,
        allowed_types=["document", "image"],
        filename_prefix="public_ed",
        max_size=DOCUMENT_MAX_BYTES,
    )
    return f"orgs/{org.org_uuid}/{PRIVATE_DOC_DIR}/{filename}"


async def submit_application(
    org_id: int,
    *,
    institution: str,
    institution_type: str,
    reg_number: Optional[str],
    email: Optional[str],
    agreement_accepted: bool,
    document: Optional[UploadFile],
    db_session: AsyncSession,
) -> PublicEdApplication:
    institution = (institution or "").strip()
    if not institution or len(institution) > 255:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Institution name is required")
    if institution_type not in INSTITUTION_TYPES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Institution type must be one of: {', '.join(INSTITUTION_TYPES)}",
        )
    if not agreement_accepted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "The Public Education agreement must be accepted"
        )
    reg_number = (reg_number or "").strip()[:128] or None
    has_document = document is not None and bool(document.filename)
    if not reg_number and not has_document:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Provide a registration number or upload a registration document",
        )

    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")

    app = await get_latest_application(org_id, db_session)
    now = utcnow()
    if app is not None and app.status == "approved":
        expires = app.expires_at
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=now.tzinfo)
        if expires is None or expires > now:
            raise HTTPException(status.HTTP_409_CONFLICT, "Public Education access is already approved")
    if app is None or app.status in ("approved", "expired"):
        # A renewal starts a fresh application row; history is kept.
        app = PublicEdApplication(org_id=org_id, institution=institution, type=institution_type)

    app.institution = institution
    app.type = institution_type
    app.reg_number = reg_number
    app.email_domain = email_domain_of(email)
    app.agreement_version = AGREEMENT_VERSION
    app.status = "pending"
    app.review_note = None
    app.reviewed_by = None
    app.reviewed_at = None
    app.updated_at = now
    if has_document:
        app.document_key = await _store_document(org, document)  # type: ignore[arg-type]

    db_session.add(app)
    await db_session.commit()
    await db_session.refresh(app)
    return app
