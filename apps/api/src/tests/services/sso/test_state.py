"""Tests for the single-use SSO state token."""

import pytest

from src.services.sso.state import (
    SSO_STATE_PURPOSE,
    consume_state_token,
    issue_state_token,
)


@pytest.fixture
def burn_once(monkeypatch):
    """Simulate Redis-backed single-use burn without a Redis server."""
    seen = set()

    def fake_burn(jti):
        if jti in seen:
            return False
        seen.add(jti)
        return True

    monkeypatch.setattr("src.services.sso.state._burn_jti", fake_burn)


def test_issue_and_consume(burn_once):
    token = issue_state_token(
        org_slug="acme", provider="workos", return_url="/dashboard"
    )
    payload = consume_state_token(token)
    assert payload["sub"] == "acme"
    assert payload["provider"] == "workos"
    assert payload["purpose"] == SSO_STATE_PURPOSE
    assert payload["return_url"] == "/dashboard"


def test_single_use_replay(burn_once):
    token = issue_state_token(org_slug="acme", provider="workos", return_url=None)
    consume_state_token(token)
    with pytest.raises(ValueError) as exc:
        consume_state_token(token)
    assert str(exc.value) == "state_invalid_or_expired"


def test_wrong_purpose_rejected(burn_once):
    from src.security.auth import create_access_token

    token = create_access_token(data={"sub": "acme", "purpose": "other"})
    with pytest.raises(ValueError) as exc:
        consume_state_token(token)
    assert str(exc.value) == "invalid_state"


def test_garbage_token_rejected(burn_once):
    with pytest.raises(ValueError):
        consume_state_token("not-a-real-token")


def test_state_extra_roundtrip(burn_once):
    token = issue_state_token(
        org_slug="acme",
        provider="custom_oidc",
        return_url="/",
        state_extra={"nonce": "abc123"},
    )
    payload = consume_state_token(token)
    assert payload["extra"]["nonce"] == "abc123"
