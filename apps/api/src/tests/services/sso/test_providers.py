"""Tests for the WorkOS and OIDC provider adapters."""

from unittest.mock import MagicMock, patch

import pytest

from src.db.sso import SSOConfig
from src.services.sso.providers.oidc import OIDCAdapter
from src.services.sso.providers.workos import WorkOSAdapter
from src.tests.services.sso.fake_oidc import ISSUER, FakeOIDC

# ---------------------------------------------------------------------------
# WorkOS (SDK mocked)
# ---------------------------------------------------------------------------

@pytest.fixture
def workos_env(monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_WORKOS_CLIENT_ID", "client_123")
    monkeypatch.setenv("VALIDBRIDGE_WORKOS_CLIENT_SECRET", "sk_test_123")


def test_workos_available_when_configured(workos_env):
    assert WorkOSAdapter().available()


def test_workos_unavailable_when_missing(monkeypatch):
    monkeypatch.delenv("VALIDBRIDGE_WORKOS_CLIENT_ID", raising=False)
    monkeypatch.delenv("VALIDBRIDGE_WORKOS_CLIENT_SECRET", raising=False)
    assert not WorkOSAdapter().available()


def test_workos_provider_info_shape(workos_env):
    info = WorkOSAdapter().provider_info()
    d = info.as_dict()
    assert d["id"] == "workos"
    assert d["has_setup_portal"] is True
    assert d["available"] is True
    assert any(f["name"] == "organization_id" for f in d["config_fields"])


async def test_workos_build_authorization_url(workos_env):
    config = SSOConfig(org_id=1, provider="workos", provider_config={"organization_id": "org_1"})
    adapter = WorkOSAdapter()

    fake_sso = MagicMock()
    fake_sso.get_authorization_url.return_value = "https://auth.workos.com/authorize"
    fake_client = MagicMock()
    fake_client.sso = fake_sso

    with patch.object(WorkOSAdapter, "_client", return_value=fake_client):
        url, extra = await adapter.build_authorization_url(
            redirect_uri="https://api/callback", state="state123", config=config, request=None
        )
    assert url == "https://auth.workos.com/authorize"
    assert extra == {}
    fake_sso.get_authorization_url.assert_called_once()


async def test_workos_exchange_code(workos_env):
    config = SSOConfig(org_id=1, provider="workos")
    adapter = WorkOSAdapter()

    profile = MagicMock()
    profile.email = "USER@Example.com"
    profile.name = "Jane Doe"
    profile.first_name = "Jane"
    profile.last_name = "Doe"
    profile.idp_id = "idp_1"
    profile.id = "prof_1"
    resp = MagicMock()
    resp.profile = profile

    fake_sso = MagicMock()
    fake_sso.get_profile_and_token.return_value = resp
    fake_client = MagicMock()
    fake_client.sso = fake_sso

    with patch.object(WorkOSAdapter, "_client", return_value=fake_client):
        identity = await adapter.exchange_code(code="c", state_extra={}, config=config, request=None)

    assert identity.email == "user@example.com"
    assert identity.email_verified is True
    assert identity.name == "Jane Doe"
    assert identity.provider == "workos"
    assert identity.raw_id == "idp_1"


# ---------------------------------------------------------------------------
# OIDC (fake IdP via MockTransport)
# ---------------------------------------------------------------------------

def _oidc_env(monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_OIDC_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("VALIDBRIDGE_OIDC_CLIENT_SECRET", "test-client-secret")


def _oidc_config():
    return SSOConfig(
        org_id=1,
        provider="custom_oidc",
        domains=["example.com"],
        provider_config={"issuer": ISSUER},
    )


async def test_oidc_exchange_happy_path(monkeypatch):
    _oidc_env(monkeypatch)
    fake = FakeOIDC()
    code = fake.issue_code(nonce="nonce123")

    adapter = OIDCAdapter(transport=fake.transport())
    identity = await adapter.exchange_code(
        code=code,
        state_extra={"nonce": "nonce123"},
        config=_oidc_config(),
        request=None,
    )

    assert identity.email == "sso.user@example.com"
    assert identity.email_verified is True
    assert identity.name == "SSO User"
    assert identity.provider == "custom_oidc"


async def test_oidc_exchange_invalid_code(monkeypatch):
    _oidc_env(monkeypatch)
    fake = FakeOIDC()

    adapter = OIDCAdapter(transport=fake.transport())
    with pytest.raises(ValueError):
        await adapter.exchange_code(
            code="bogus",
            state_extra={},
            config=_oidc_config(),
            request=None,
        )


async def test_oidc_signature_wrong_rejected(monkeypatch):
    """An id_token signed by a different key must be rejected."""
    _oidc_env(monkeypatch)
    fake = FakeOIDC()
    other = FakeOIDC()  # different RSA key

    token = other._id_token("nonce123")  # signed with `other`'s key
    adapter = OIDCAdapter(transport=fake.transport())  # serves JWKS for `fake`'s key
    with pytest.raises(ValueError):
        await adapter._verify_id_token(
            token,
            issuer=ISSUER,
            audience="test-client-id",
            nonce="nonce123",
            jwks_uri=fake.jwks_url,
        )


def test_oidc_available(monkeypatch):
    _oidc_env(monkeypatch)
    assert OIDCAdapter().available()


def test_oidc_unavailable(monkeypatch):
    monkeypatch.delenv("VALIDBRIDGE_OIDC_CLIENT_ID", raising=False)
    monkeypatch.delenv("VALIDBRIDGE_OIDC_CLIENT_SECRET", raising=False)
    assert not OIDCAdapter().available()


# ---------------------------------------------------------------------------
# OIDC BYOK — per-org credentials take precedence over platform config
# ---------------------------------------------------------------------------

def _byok_config(client_id: str = "test-client-id", client_secret: str = "test-client-secret"):
    return SSOConfig(
        org_id=1,
        provider="custom_oidc",
        domains=["example.com"],
        provider_config={
            "issuer_url": ISSUER,
            "client_id": client_id,
            "client_secret": client_secret,
            "scopes": "openid email",
        },
    )


def test_oidc_available_from_org_credentials(monkeypatch):
    """BYOK: availability comes from the org's own creds when the platform has none."""
    monkeypatch.delenv("VALIDBRIDGE_OIDC_CLIENT_ID", raising=False)
    monkeypatch.delenv("VALIDBRIDGE_OIDC_CLIENT_SECRET", raising=False)
    assert OIDCAdapter().available({}) is False
    assert OIDCAdapter().available(_byok_config().provider_config) is True


def test_oidc_provider_card_is_selectable():
    """The BYOK card must be selectable even with no platform OIDC client."""
    info = OIDCAdapter().provider_info().as_dict()
    assert info["available"] is True
    names = {field["name"] for field in info["config_fields"]}
    assert {"issuer_url", "client_id", "client_secret", "scopes"} <= names


async def test_oidc_exchange_uses_org_credentials(monkeypatch):
    """The token exchange uses the org's client id/secret (platform unset)."""
    monkeypatch.delenv("VALIDBRIDGE_OIDC_CLIENT_ID", raising=False)
    monkeypatch.delenv("VALIDBRIDGE_OIDC_CLIENT_SECRET", raising=False)
    fake = FakeOIDC()
    code = fake.issue_code(nonce="nonce-org")

    identity = await OIDCAdapter(transport=fake.transport()).exchange_code(
        code=code,
        state_extra={"nonce": "nonce-org"},
        config=_byok_config(),
        request=None,
    )
    assert identity.email == "sso.user@example.com"


async def test_oidc_exchange_accepts_encrypted_org_secret(monkeypatch):
    """A secret stored encrypted (as the router does) still resolves."""
    from src.security.secret_crypto import encrypt_secret

    monkeypatch.delenv("VALIDBRIDGE_OIDC_CLIENT_ID", raising=False)
    monkeypatch.delenv("VALIDBRIDGE_OIDC_CLIENT_SECRET", raising=False)
    fake = FakeOIDC()
    code = fake.issue_code(nonce="nonce-enc")

    config = _byok_config(client_secret=encrypt_secret("test-client-secret"))
    identity = await OIDCAdapter(transport=fake.transport()).exchange_code(
        code=code,
        state_extra={"nonce": "nonce-enc"},
        config=config,
        request=None,
    )
    assert identity.email == "sso.user@example.com"


async def test_oidc_build_authorization_uses_org_client_and_scopes(monkeypatch):
    monkeypatch.delenv("VALIDBRIDGE_OIDC_CLIENT_ID", raising=False)
    monkeypatch.delenv("VALIDBRIDGE_OIDC_CLIENT_SECRET", raising=False)
    fake = FakeOIDC()

    url, extra = await OIDCAdapter(transport=fake.transport()).build_authorization_url(
        redirect_uri="https://api.test/api/v1/auth/sso/callback",
        state="state123",
        config=_byok_config(),
        request=None,
    )
    assert "client_id=test-client-id" in url
    assert "scope=openid+email" in url or "scope=openid%20email" in url
    assert extra["redirect_uri"] == "https://api.test/api/v1/auth/sso/callback"
