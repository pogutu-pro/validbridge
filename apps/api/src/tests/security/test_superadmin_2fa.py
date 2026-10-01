"""VALIDBRIDGE_SUPERADMIN_REQUIRE_2FA: superadmin sessions need a confirmed 2FA factor."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.user_mfa import UserMFA
from src.db.users import APITokenUser, PublicUser, SuperadminAPITokenUser
from src.routers.orgs.ai_credits import router as ai_credits_router
from src.security.auth import get_current_user
from src.security.superadmin import (
    SUPERADMIN_2FA_REQUIRED_CODE,
    SUPERADMIN_REQUIRE_2FA_ENV,
    ensure_superadmin_2fa,
    require_superadmin,
    superadmin_2fa_required,
)


@pytest.fixture(autouse=True)
def ee_mode():
    # The suite pins 'oss' globally; the superadmin surface only exists on EE/SaaS.
    with patch("src.core.deployment_mode.get_deployment_mode", return_value="ee"):
        yield


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv(SUPERADMIN_REQUIRE_2FA_ENV, "true")


@pytest.fixture
def flag_off(monkeypatch):
    monkeypatch.delenv(SUPERADMIN_REQUIRE_2FA_ENV, raising=False)


def _session_user(user_id: int = 1) -> PublicUser:
    return PublicUser(
        id=user_id,
        username="sa",
        first_name="Super",
        last_name="Admin",
        email="sa@test.com",
        user_uuid=f"user_sa{user_id}",
    )


async def _enrol(db, user_id: int, confirmed: bool = True) -> None:
    db.add(
        UserMFA(
            user_id=user_id,
            secret_encrypted="ciphertext",
            confirmed_at=str(datetime.now()) if confirmed else None,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()


def _superadmin_patch(value: bool = True):
    return patch(
        "src.security.superadmin.is_user_superadmin",
        new=AsyncMock(return_value=value),
    )


class TestFlagParsing:
    @pytest.mark.parametrize("raw", ["1", "true", "TRUE", " yes ", "on"])
    def test_truthy(self, monkeypatch, raw):
        monkeypatch.setenv(SUPERADMIN_REQUIRE_2FA_ENV, raw)
        assert superadmin_2fa_required() is True

    @pytest.mark.parametrize("raw", ["", "0", "false", "no", "off", "maybe"])
    def test_falsy(self, monkeypatch, raw):
        monkeypatch.setenv(SUPERADMIN_REQUIRE_2FA_ENV, raw)
        assert superadmin_2fa_required() is False

    def test_default_is_off(self, flag_off):
        assert superadmin_2fa_required() is False


class TestRequireSuperadmin2FA:
    async def test_flag_off_unenrolled_session_passes(self, db, admin_user, flag_off):
        user = _session_user(admin_user.id)
        with _superadmin_patch():
            assert await require_superadmin(current_user=user, db_session=db) is user

    async def test_flag_on_unenrolled_session_is_rejected(self, db, admin_user, flag_on):
        user = _session_user(admin_user.id)
        with _superadmin_patch(), pytest.raises(HTTPException) as exc:
            await require_superadmin(current_user=user, db_session=db)
        assert exc.value.status_code == 403
        assert exc.value.detail["error_code"] == SUPERADMIN_2FA_REQUIRED_CODE

    async def test_flag_on_unconfirmed_enrolment_is_rejected(self, db, admin_user, flag_on):
        await _enrol(db, admin_user.id, confirmed=False)
        user = _session_user(admin_user.id)
        with _superadmin_patch(), pytest.raises(HTTPException) as exc:
            await require_superadmin(current_user=user, db_session=db)
        assert exc.value.detail["error_code"] == SUPERADMIN_2FA_REQUIRED_CODE

    async def test_flag_on_enrolled_session_passes(self, db, admin_user, flag_on):
        await _enrol(db, admin_user.id)
        user = _session_user(admin_user.id)
        with _superadmin_patch():
            assert await require_superadmin(current_user=user, db_session=db) is user

    async def test_flag_on_superadmin_token_passes_without_2fa(self, db, admin_user, flag_on):
        token_user = SuperadminAPITokenUser(id=7, created_by_user_id=admin_user.id)
        with _superadmin_patch():
            assert await require_superadmin(current_user=token_user, db_session=db) is token_user

    async def test_flag_on_non_superadmin_still_gets_plain_403(self, db, regular_user, flag_on):
        user = _session_user(regular_user.id)
        with _superadmin_patch(False), pytest.raises(HTTPException) as exc:
            await require_superadmin(current_user=user, db_session=db)
        assert exc.value.status_code == 403
        assert exc.value.detail == "Superadmin access required"


class TestEnsureSuperadmin2FA:
    async def test_org_api_token_is_exempt(self, db, flag_on):
        await ensure_superadmin_2fa(APITokenUser(id=3, org_id=1, created_by_user_id=1), db)

    async def test_session_without_id_is_rejected(self, db, flag_on):
        with pytest.raises(HTTPException):
            await ensure_superadmin_2fa(object(), db)


class TestSuperadminRouterGate:
    """End to end through the real dependency on the superadmin router."""

    @pytest.fixture
    def app(self, db, admin_user):
        from src.routers.superadmin import router as superadmin_router
        from src.security.superadmin import _get_current_user_lazy

        app = FastAPI()
        app.include_router(superadmin_router, prefix="/api/v1/ee/superadmin")
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[_get_current_user_lazy] = lambda: _session_user(admin_user.id)
        yield app
        app.dependency_overrides.clear()

    async def _status(self, app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.get("/api/v1/ee/superadmin/status")

    async def test_blocked_until_enrolled(self, app, db, admin_user, flag_on):
        with _superadmin_patch():
            blocked = await self._status(app)
            assert blocked.status_code == 403
            assert blocked.json()["detail"]["error_code"] == SUPERADMIN_2FA_REQUIRED_CODE

            await _enrol(db, admin_user.id)
            allowed = await self._status(app)
        assert allowed.status_code == 200

    async def test_flag_off_allows(self, app, flag_off):
        with _superadmin_patch():
            response = await self._status(app)
        assert response.status_code == 200


class TestAICreditsGate:
    async def test_credit_set_requires_2fa_when_flag_on(self, db, admin_user, org, flag_on):
        app = FastAPI()
        app.include_router(ai_credits_router, prefix="/api/v1/orgs")
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: _session_user(admin_user.id)
        with patch(
            "src.routers.orgs.ai_credits.is_user_superadmin",
            new=AsyncMock(return_value=True),
        ), patch("src.routers.orgs.ai_credits.set_ai_credits", return_value=5) as set_mock:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                response = await c.post(f"/api/v1/orgs/{org.id}/ai-credits/set", json={"amount": 5})
        assert response.status_code == 403
        assert response.json()["detail"]["error_code"] == SUPERADMIN_2FA_REQUIRED_CODE
        set_mock.assert_not_called()
