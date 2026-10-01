"""record_superadmin_action and its use on the superadmin mutation endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLog
from src.db.organization_config import OrganizationConfig
from src.db.users import SuperadminAPITokenUser
from src.routers.orgs.ai_credits import router as ai_credits_router
from src.routers.superadmin import router as superadmin_router
from src.security.auth import get_current_user
from src.security.superadmin import require_superadmin
from src.services.audit.superadmin_audit import (
    SUPERADMIN_AUDIT_RESOURCE,
    record_superadmin_action,
)


async def _rows(db) -> list[AuditLog]:
    return list(
        (
            await db.execute(
                select(AuditLog).where(AuditLog.resource == SUPERADMIN_AUDIT_RESOURCE).order_by(AuditLog.id)
            )
        ).scalars().all()
    )


class TestRecordSuperadminAction:
    async def test_writes_row_with_reason_before_after(self, db, admin_user, org):
        row = await record_superadmin_action(
            db,
            admin_user.id,
            "org.plan_change",
            org_id=org.id,
            reason="  upgrade agreed by phone  ",
            before={"plan": "starter"},
            after={"plan": "business"},
        )
        assert row is not None
        rows = await _rows(db)
        assert len(rows) == 1
        saved = rows[0]
        assert saved.action == "superadmin.org.plan_change"
        assert saved.user_id == admin_user.id
        assert saved.username == admin_user.username
        assert saved.org_id == org.id
        assert saved.resource_id == str(org.id)
        assert saved.method == "SYSTEM"
        assert saved.payload == {
            "reason": "upgrade agreed by phone",
            "before": {"plan": "starter"},
            "after": {"plan": "business"},
        }

    async def test_dicts_are_reduced_to_changed_keys(self, db, admin_user):
        await record_superadmin_action(
            db,
            admin_user.id,
            "org.config_update",
            before={"a": 1, "b": {"x": 1}, "same": True, "gone": 1},
            after={"a": 2, "b": {"x": 1}, "same": True, "new": 3},
        )
        payload = (await _rows(db))[0].payload
        assert payload["before"] == {"a": 1, "gone": 1}
        assert payload["after"] == {"a": 2, "new": 3}

    async def test_secrets_are_redacted(self, db, admin_user):
        await record_superadmin_action(
            db,
            admin_user.id,
            "org.config_update",
            before={"smtp_password": "old"},
            after={"smtp_password": "new", "nested": {"api_key": "k"}},
        )
        payload = (await _rows(db))[0].payload
        assert payload["before"]["smtp_password"] == "[REDACTED]"
        assert payload["after"]["smtp_password"] == "[REDACTED]"
        assert payload["after"]["nested"]["api_key"] == "[REDACTED]"

    async def test_prefix_is_not_doubled(self, db, admin_user):
        await record_superadmin_action(db, admin_user.id, "superadmin.x")
        assert (await _rows(db))[0].action == "superadmin.x"

    async def test_write_failure_is_swallowed_unless_strict(self, db, admin_user):
        with patch.object(db, "commit", new=AsyncMock(side_effect=RuntimeError("db down"))):
            assert await record_superadmin_action(db, admin_user.id, "x") is None
            with pytest.raises(RuntimeError):
                await record_superadmin_action(db, admin_user.id, "x", strict=True)


# ---------------------------------------------------------------------------
# Router integration
# ---------------------------------------------------------------------------

@pytest.fixture
def ee_mode():
    with patch("src.core.deployment_mode.get_deployment_mode", return_value="ee"):
        yield


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(superadmin_router, prefix="/api/v1/ee/superadmin")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[require_superadmin] = lambda: admin_user
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
        config={"config_version": "2.0", "plan": "starter", "admin_toggles": {"security": {"require_2fa": False}}},
    )
    db.add(row)
    await db.commit()
    return row


class TestSuperadminRouterAudit:
    async def test_plan_change_is_audited(self, client, db, org, org_config, admin_user):
        response = await client.put(
            f"/api/v1/ee/superadmin/organizations/{org.id}/plan",
            json={"plan": "business", "reason": "invoice 42 paid"},
        )
        assert response.status_code == 200
        rows = await _rows(db)
        assert [r.action for r in rows] == ["superadmin.org.plan_change"]
        assert rows[0].org_id == org.id
        assert rows[0].user_id == admin_user.id
        assert rows[0].method == "PUT"
        assert rows[0].path == f"/api/v1/ee/superadmin/organizations/{org.id}/plan"
        assert rows[0].payload == {
            "reason": "invoice 42 paid",
            "before": {"plan": "starter"},
            "after": {"plan": "business"},
        }

    async def test_rejected_plan_change_is_not_audited(self, client, db, org, org_config):
        response = await client.put(
            f"/api/v1/ee/superadmin/organizations/{org.id}/plan",
            json={"plan": "not-a-plan"},
        )
        assert response.status_code == 400
        assert await _rows(db) == []

    async def test_config_change_is_audited_as_diff(self, client, db, org, org_config):
        new_config = {"config_version": "2.0", "plan": "starter", "admin_toggles": {"security": {"require_2fa": True}}}
        response = await client.put(
            f"/api/v1/ee/superadmin/organizations/{org.id}/config",
            json={"config": new_config},
        )
        assert response.status_code == 200
        row = (await _rows(db))[0]
        assert row.action == "superadmin.org.config_update"
        assert row.payload["reason"] is None
        assert row.payload["before"] == {"admin_toggles": {"security": {"require_2fa": False}}}
        assert row.payload["after"] == {"admin_toggles": {"security": {"require_2fa": True}}}

    async def test_admin_toggles_change_is_audited(self, client, db, org, org_config):
        response = await client.put(
            f"/api/v1/ee/superadmin/organizations/{org.id}/admin_toggles",
            json={"toggles": {"ai": {"disabled": True}}, "reason": "abuse report"},
        )
        assert response.status_code == 200
        row = (await _rows(db))[0]
        assert row.action == "superadmin.org.admin_toggles_update"
        assert row.payload["reason"] == "abuse report"
        assert row.payload["before"] == {}
        assert row.payload["after"] == {"ai": {"disabled": True}}

    async def test_settings_change_is_audited(self, client, db, org):
        with patch("src.services.orgs.orgs.update_org", new=AsyncMock(return_value={})):
            response = await client.put(
                f"/api/v1/ee/superadmin/organizations/{org.id}/settings",
                json={"name": "Renamed Org"},
            )
        assert response.status_code == 200
        row = (await _rows(db))[0]
        assert row.action == "superadmin.org.settings_update"
        assert row.payload["before"] == {"name": "Test Org"}
        assert row.payload["after"] == {"name": "Renamed Org"}

    async def test_token_lifecycle_is_audited_without_token_value(self, client, db, app, admin_user):
        created = await client.post("/api/v1/ee/superadmin/tokens/", json={"name": "ops"})
        assert created.status_code == 200
        secret = created.json()["token"]
        token_uuid = created.json()["token_uuid"]
        await client.patch(f"/api/v1/ee/superadmin/tokens/{token_uuid}", json={"description": "d"})
        await client.delete(f"/api/v1/ee/superadmin/tokens/{token_uuid}")

        rows = await _rows(db)
        assert [r.action for r in rows] == [
            "superadmin.api_token.create",
            "superadmin.api_token.update",
            "superadmin.api_token.revoke",
        ]
        assert all(r.resource_id == token_uuid for r in rows)
        assert rows[0].payload["after"]["name"] == "ops"
        assert secret not in str([r.payload for r in rows])

    async def test_token_principal_is_attributed_to_minting_user(self, client, db, app, org, org_config, admin_user):
        app.dependency_overrides[require_superadmin] = lambda: SuperadminAPITokenUser(
            id=999, created_by_user_id=admin_user.id
        )
        response = await client.put(
            f"/api/v1/ee/superadmin/organizations/{org.id}/plan", json={"plan": "growth"}
        )
        assert response.status_code == 200
        assert (await _rows(db))[0].user_id == admin_user.id


class TestAICreditsAudit:
    @pytest.fixture
    async def credits_client(self, db, admin_user, ee_mode):
        app = FastAPI()
        app.include_router(ai_credits_router, prefix="/api/v1/orgs")
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: admin_user
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c

    async def test_set_add_reset_are_audited(self, credits_client, db, org):
        with patch(
            "src.routers.orgs.ai_credits.is_user_superadmin", new=AsyncMock(return_value=True)
        ), patch(
            "src.routers.orgs.ai_credits.get_ai_credits_summary",
            new=AsyncMock(return_value={"purchased_credits": 40, "used_credits": 7}),
        ), patch("src.routers.orgs.ai_credits.set_ai_credits", return_value=500), patch(
            "src.routers.orgs.ai_credits.add_ai_credits", return_value=510
        ), patch("src.routers.orgs.ai_credits.reset_ai_credits_usage"):
            assert (await credits_client.post(f"/api/v1/orgs/{org.id}/ai-credits/set", json={"amount": 500})).status_code == 200
            assert (await credits_client.post(f"/api/v1/orgs/{org.id}/ai-credits/add", json={"amount": 10})).status_code == 200
            assert (await credits_client.post(f"/api/v1/orgs/{org.id}/ai-credits/reset")).status_code == 200

        rows = await _rows(db)
        assert [(r.action, r.payload["before"], r.payload["after"]) for r in rows] == [
            ("superadmin.ai_credits.set", {"purchased": 40}, {"purchased": 500}),
            ("superadmin.ai_credits.add", {"purchased": 500}, {"purchased": 510, "added": 10}),
            ("superadmin.ai_credits.reset_usage", {"used": 7}, {"used": 0}),
        ]
        assert all(r.org_id == org.id for r in rows)
