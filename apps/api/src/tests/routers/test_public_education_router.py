"""Public Education application endpoints (org admin) and superadmin review."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.billing.public_education import PublicEdApplication
from src.db.organization_config import OrganizationConfig
from src.db.organizations import OnboardingIntent, OrganizationCreate
from src.routers.orgs.public_education import router as public_ed_router
from src.routers.superadmin import router as superadmin_router
from src.security.auth import get_current_user
from src.security.submission_file_access import is_private_org_file
from src.security.superadmin import require_superadmin
from src.services.orgs.public_education import add_months, is_official_domain

BASE = "/api/v1/orgs/1/public-education/application"
SA = "/api/v1/ee/superadmin/public-education/applications"
FORM = {
    "institution": "Kisumu Boys High School",
    "institution_type": "public_secondary",
    "reg_number": "TSC-12345",
    "email": "head@kisumuboys.sc.ke",
    "agreement_accepted": "true",
}


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(public_ed_router, prefix="/api/v1/orgs")
    app.include_router(superadmin_router, prefix="/api/v1/ee/superadmin")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def org_config(db, org):
    row = OrganizationConfig(
        org_id=org.id,
        config={"config_version": "2.0", "plan": "starter"},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(row)
    await db.commit()
    return row


def as_user(app, user):
    app.dependency_overrides[get_current_user] = lambda: user


def as_superadmin(app, user):
    app.dependency_overrides[require_superadmin] = lambda: user


class TestOrgApplication:
    async def test_admin_submits_and_reads(self, client, app, admin_user, org):
        as_user(app, admin_user)
        assert (await client.get(BASE)).json() is None

        res = await client.post(BASE, data=FORM)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "pending"
        assert body["email_domain"] == "kisumuboys.sc.ke"
        assert body["official_domain"] is True
        assert body["agreement_version"] == "2026-09"
        assert "document_key" not in body

        # Resubmitting updates the same pending row.
        res2 = await client.post(BASE, data={**FORM, "institution": "Kisumu Boys"})
        assert res2.json()["id"] == body["id"]
        got = await client.get(BASE)
        assert got.json()["institution"] == "Kisumu Boys"

    async def test_regular_member_forbidden(self, client, app, regular_user, org):
        as_user(app, regular_user)
        assert (await client.post(BASE, data=FORM)).status_code == 403
        assert (await client.get(BASE)).status_code == 403

    async def test_validation(self, client, app, admin_user, org):
        as_user(app, admin_user)
        no_proof = {k: v for k, v in FORM.items() if k != "reg_number"}
        assert (await client.post(BASE, data=no_proof)).status_code == 422
        assert (await client.post(BASE, data={**FORM, "agreement_accepted": "false"})).status_code == 422
        assert (await client.post(BASE, data={**FORM, "institution_type": "private"})).status_code == 422

    async def test_document_stored_under_private_prefix(self, client, app, admin_user, org, db):
        as_user(app, admin_user)
        with patch(
            "src.services.utils.upload_content.upload_file",
            new=AsyncMock(return_value="abc_public_ed.pdf"),
        ) as up:
            no_reg = {k: v for k, v in FORM.items() if k != "reg_number"}
            res = await client.post(
                BASE, data=no_reg, files={"document": ("reg.pdf", b"%PDF-1.4 x", "application/pdf")}
            )
        assert res.status_code == 200, res.text
        assert res.json()["has_document"] is True
        assert up.await_args.kwargs["directory"] == "private/public_education"
        row = (await db.execute(select(PublicEdApplication))).scalars().first()
        assert row.document_key == "orgs/org_test/private/public_education/abc_public_ed.pdf"
        assert is_private_org_file(row.document_key.split("/"))


class TestSuperadminReview:
    async def test_requires_superadmin(self, client):
        assert (await client.get(f"{SA}?status=pending")).status_code == 401
        assert (await client.post(f"{SA}/1/approve")).status_code == 401

    async def test_approve_sets_plan_and_expiry(self, client, app, admin_user, org, org_config, db):
        as_user(app, admin_user)
        app_id = (await client.post(BASE, data=FORM)).json()["id"]

        as_superadmin(app, admin_user)
        listed = await client.get(f"{SA}?status=pending")
        assert listed.status_code == 200
        assert listed.json()["total"] == 1
        assert listed.json()["items"][0]["org_slug"] == org.slug

        res = await client.post(f"{SA}/{app_id}/approve", json={"reason": "TSC verified"})
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "approved"
        assert res.json()["expires_at"] is not None

        cfg = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))).scalars().first()
        await db.refresh(cfg)
        assert cfg.config["plan"] == "public-education"
        assert (await client.get(f"{SA}?status=pending")).json()["total"] == 0
        # Cannot review twice.
        assert (await client.post(f"{SA}/{app_id}/reject")).status_code == 409

    async def test_reject(self, client, app, admin_user, org, org_config):
        as_user(app, admin_user)
        app_id = (await client.post(BASE, data=FORM)).json()["id"]
        as_superadmin(app, admin_user)
        res = await client.post(f"{SA}/{app_id}/reject", json={"reason": "Private school"})
        assert res.status_code == 200
        assert res.json()["status"] == "rejected"
        assert res.json()["review_note"] == "Private school"
        assert (await client.post(f"{SA}/999/approve")).status_code == 404


class TestHelpers:
    def test_add_months_clamps(self):
        assert add_months(datetime(2028, 2, 29), 12) == datetime(2029, 2, 28)

    def test_official_domain(self):
        assert is_official_domain("uonbi.ac.ke")
        assert not is_official_domain("gmail.com")

    def test_private_path_guard(self):
        assert is_private_org_file("orgs/u/./private/x.pdf".split("/"))
        assert not is_private_org_file("orgs/u/logos/x.png".split("/"))


class TestCreateOrgStoresIntent:
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
    @patch("src.routers.users._invalidate_session_cache")
    async def test_intent_in_config(self, _c, _m, mock_request, db, admin_user):
        from src.services.orgs.orgs import create_org

        body = OrganizationCreate(
            name="Kisumu Boys",
            slug="kisumu-boys",
            email="a@b.com",
            onboarding=OnboardingIntent(role="admin", institution_type="public_school"),
        )
        result = await create_org(mock_request, body, admin_user, db)
        onboarding = result.config.config["onboarding"]
        assert onboarding["role"] == "admin"
        assert onboarding["institution_type"] == "public_school"
        assert onboarding["onboarding_version"] == 2
        assert onboarding["created_by_user_id"] == admin_user.id


class TestPublicEdDocument:
    async def test_superadmin_reads_document(self, client, app, admin_user, org, org_config, db):
        as_user(app, admin_user)
        app_id = (await client.post(BASE, data=FORM)).json()["id"]
        row = (await db.execute(select(PublicEdApplication).where(PublicEdApplication.id == app_id))).scalars().first()
        row.document_key = f"orgs/{org.org_uuid}/private/public_ed/reg.pdf"
        db.add(row)
        await db.commit()

        as_superadmin(app, admin_user)
        with patch("src.services.utils.upload_content.read_content", AsyncMock(return_value=b"%PDF-1.4")) as rc:
            res = await client.get(f"{SA}/{app_id}/document")
        assert res.status_code == 200
        assert res.headers["content-type"] == "application/pdf"
        assert res.headers["cache-control"] == "no-store"
        assert res.content == b"%PDF-1.4"
        rc.assert_awaited_once_with("private/public_ed", "orgs", org.org_uuid, "reg.pdf")

    async def test_no_document_is_404(self, client, app, admin_user, org, org_config):
        as_user(app, admin_user)
        app_id = (await client.post(BASE, data=FORM)).json()["id"]
        as_superadmin(app, admin_user)
        assert (await client.get(f"{SA}/{app_id}/document")).status_code == 404
