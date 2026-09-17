"""Router tests for the first-party platform superadmin API (src/routers/superadmin.py)."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import SuperadminAPITokenUser
from src.routers.superadmin import router as superadmin_router
from src.security.superadmin import require_superadmin


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(superadmin_router, prefix="/api/v1/ee/superadmin")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def auth_as(app, user):
    app.dependency_overrides[require_superadmin] = lambda: user


class TestSuperadminGate:
    async def test_status_requires_authentication(self, client):
        # No dependency override: the real require_superadmin runs and should
        # reject the anonymous caller before anything else.
        response = await client.get("/api/v1/ee/superadmin/status")
        assert response.status_code == 401

    async def test_status_as_superadmin(self, client, app, admin_user):
        auth_as(app, admin_user)
        response = await client.get("/api/v1/ee/superadmin/status")
        assert response.status_code == 200
        assert response.json() == {"is_superadmin": True}


class TestOrganizations:
    async def test_list_organizations_shape(self, client, app, admin_user, org):
        auth_as(app, admin_user)
        response = await client.get("/api/v1/ee/superadmin/organizations?page=1&limit=10")
        assert response.status_code == 200
        body = response.json()
        assert set(["items", "total", "page", "limit"]).issubset(body.keys())
        assert body["total"] == 1
        item = body["items"][0]
        for field in ("id", "org_uuid", "name", "slug", "plan", "user_count", "course_count", "custom_domains", "admin_users"):
            assert field in item
        assert item["user_count"] == 1

    async def test_organization_detail_and_children(self, client, app, admin_user, org):
        auth_as(app, admin_user)

        detail = await client.get(f"/api/v1/ee/superadmin/organizations/{org.id}")
        assert detail.status_code == 200
        assert detail.json()["plan"] == "free"
        assert "config" in detail.json()

        courses = await client.get(f"/api/v1/ee/superadmin/organizations/{org.id}/courses")
        assert courses.status_code == 200
        assert courses.json()["total"] == 0

        users = await client.get(f"/api/v1/ee/superadmin/organizations/{org.id}/users")
        assert users.status_code == 200
        assert users.json()["total"] == 1
        assert users.json()["items"][0]["role_name"] == "Admin"

    async def test_missing_org_is_404(self, client, app, admin_user):
        auth_as(app, admin_user)
        response = await client.get("/api/v1/ee/superadmin/organizations/9999")
        assert response.status_code == 404


class TestPlatformUsers:
    async def test_list_users_with_memberships(self, client, app, admin_user, org):
        auth_as(app, admin_user)
        response = await client.get("/api/v1/ee/superadmin/users?page=1&limit=10")
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        user = body["items"][0]
        assert user["org_count"] == 1
        assert user["orgs"][0]["slug"] == org.slug


class TestSuperadminTokens:
    async def test_token_lifecycle(self, client, app, admin_user):
        auth_as(app, admin_user)

        created = await client.post(
            "/api/v1/ee/superadmin/tokens/",
            json={"name": "agency-test"},
        )
        assert created.status_code == 200
        payload = created.json()
        assert payload["token"].startswith("vb_sa_")
        token_uuid = payload["token_uuid"]

        listed = await client.get("/api/v1/ee/superadmin/tokens/")
        assert listed.status_code == 200
        assert isinstance(listed.json(), list)
        assert any(t["token_uuid"] == token_uuid for t in listed.json())

        patched = await client.patch(
            f"/api/v1/ee/superadmin/tokens/{token_uuid}",
            json={"description": "updated"},
        )
        assert patched.status_code == 200
        assert patched.json()["description"] == "updated"

        revoked = await client.delete(f"/api/v1/ee/superadmin/tokens/{token_uuid}")
        assert revoked.status_code == 200

    async def test_api_token_cannot_mint_tokens(self, client, app):
        # A vb_sa_ principal passes require_superadmin but must be rejected by
        # the session-only guard on token mutation.
        auth_as(app, SuperadminAPITokenUser(id=1, created_by_user_id=1))
        response = await client.post(
            "/api/v1/ee/superadmin/tokens/",
            json={"name": "nope"},
        )
        assert response.status_code == 403
