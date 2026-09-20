"""Router tests for src/routers/sso.py."""

from datetime import UTC
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.sso import SSOConfig
from src.db.users import PublicUser
from src.routers.sso import router as sso_router
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.services.sso.providers.base import Identity

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _admin_public_user():
    return PublicUser(
        id=1,
        username="admin",
        first_name="Admin",
        last_name="User",
        email="admin@test.com",
        user_uuid="user_admin",
    )


@pytest.fixture(autouse=True)
def _patch_guards(monkeypatch):
    """Bypass the org-admin and demo-org DB guards; each test controls the DB
    session mock directly."""

    async def _noop_admin(user_id, org_id, db_session):
        return None

    async def _not_demo(org_id, db_session):
        return False

    monkeypatch.setattr("src.routers.sso.require_org_admin", _noop_admin)
    monkeypatch.setattr("src.routers.sso.is_demo_org", _not_demo)


@pytest.fixture
def db_session():
    session = MagicMock()
    session.execute = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    session.add = MagicMock()
    return session


@pytest.fixture
def app(db_session):
    app = FastAPI()
    app.include_router(sso_router, prefix="/api/v1/auth/sso")

    async def _db():
        return db_session

    app.dependency_overrides[get_db_session] = _db
    app.dependency_overrides[get_authenticated_non_api_token_user] = lambda: _admin_public_user()
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ---------------------------------------------------------------------------
# Authz: anonymous → 401, API token → 403 on admin endpoints (E1–E6)
# ---------------------------------------------------------------------------

async def test_providers_rejects_anonymous(db_session):
    app = FastAPI()
    app.include_router(sso_router, prefix="/api/v1/auth/sso")

    async def _db():
        return db_session

    app.dependency_overrides[get_db_session] = _db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.get("/api/v1/auth/sso/providers?org_id=1")
    assert resp.status_code == 401


async def test_providers_rejects_api_token(db_session):
    app = FastAPI()
    app.include_router(sso_router, prefix="/api/v1/auth/sso")

    async def _db():
        return db_session

    from src.security.api_token_utils import get_authenticated_non_api_token_user as dep

    def _reject():
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="API tokens cannot access")

    app.dependency_overrides[get_db_session] = _db
    app.dependency_overrides[dep] = _reject

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.get("/api/v1/auth/sso/providers?org_id=1")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# E1–E6 with admin org checks
# ---------------------------------------------------------------------------

def _seed_config(db_session, config=None):
    config = config or SSOConfig(
        id=1,
        org_id=1,
        provider="workos",
        enabled=True,
        domains=["example.com"],
        auto_provision_users=False,
        default_role_id=None,
        provider_config={},
    )
    result = MagicMock()
    result.scalars.return_value.all.return_value = [config]
    result.scalars.return_value.first.return_value = config
    db_session.execute.return_value = result
    return config


async def test_get_config_returns_serialized(db_session, client):
    from datetime import datetime

    config = SSOConfig(
        id=1,
        org_id=1,
        provider="workos",
        enabled=True,
        domains=["example.com"],
        auto_provision_users=False,
        default_role_id=None,
        provider_config={},
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    _seed_config(db_session, config)
    resp = await client.get("/api/v1/auth/sso/1/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "workos"
    assert body["enabled"] is True
    assert body["domains"] == ["example.com"]


async def test_get_config_404_when_absent(db_session, client):
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    db_session.execute.return_value = result
    resp = await client.get("/api/v1/auth/sso/1/config")
    assert resp.status_code == 404


async def test_create_config_unknown_provider(db_session, client):
    resp = await client.post(
        "/api/v1/auth/sso/1/config", json={"provider": "bogus", "enabled": True}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "sso_misconfigured"


async def test_create_config_requires_domains_when_auto_provision(db_session, client):
    resp = await client.post(
        "/api/v1/auth/sso/1/config",
        json={"provider": "workos", "enabled": True, "auto_provision_users": True},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "sso_misconfigured"


# ---------------------------------------------------------------------------
# E7 — check
# ---------------------------------------------------------------------------

async def test_check_sso_disabled_when_no_org(db_session, client):
    result = MagicMock()
    result.scalars.return_value.first.return_value = None
    db_session.execute.return_value = result
    resp = await client.get("/api/v1/auth/sso/check?org_slug=nope")
    assert resp.status_code == 200
    assert resp.json() == {"sso_enabled": False, "provider": None}


# ---------------------------------------------------------------------------
# E9 — callback error contract
# ---------------------------------------------------------------------------

async def test_callback_missing_params(db_session, client):
    resp = await client.get("/api/v1/auth/sso/callback")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "missing_params"


async def test_callback_invalid_state(db_session, client):
    with patch("src.routers.sso.consume_state_token", side_effect=ValueError("state_invalid_or_expired")):
        resp = await client.get(
            "/api/v1/auth/sso/callback", params={"code": "c", "state": "s"}
        )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "state_invalid_or_expired"


async def test_callback_domain_rejected(db_session, client, monkeypatch):
    from src.db.organizations import Organization

    org = Organization(id=1, name="Org", slug="acme", email="a@b.com", org_uuid="u")
    config = SSOConfig(
        id=1,
        org_id=1,
        provider="custom_oidc",
        enabled=True,
        domains=["example.com"],
        auto_provision_users=False,
    )

    state_payload = {"sub": "acme", "provider": "custom_oidc", "return_url": "/"}
    monkeypatch.setattr(
        "src.routers.sso.consume_state_token", lambda s: dict(state_payload)
    )

    async def fake_resolve(db, slug):
        return org

    monkeypatch.setattr("src.routers.sso.resolve_org_by_slug", fake_resolve)

    async def fake_get_config(db, org_id):
        return config

    monkeypatch.setattr("src.routers.sso._get_config", fake_get_config)

    class FakeAdapter:
        provider_id = "custom_oidc"

        def available(self, provider_config=None):
            return True

        async def exchange_code(self, *, code, state_extra, config, request):
            return Identity(
                email="user@evil.com",
                email_verified=True,
                name="Evil",
                provider="custom_oidc",
                raw_id="x",
            )

    monkeypatch.setattr("src.routers.sso.get_adapter", lambda p: FakeAdapter())

    resp = await client.get(
        "/api/v1/auth/sso/callback", params={"code": "c", "state": "s"}
    )
    assert resp.status_code == 403
    assert resp.json()["detail"]["error_code"] == "email_domain_rejected"
