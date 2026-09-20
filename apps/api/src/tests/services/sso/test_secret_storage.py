"""BYOK secret handling: encrypted at rest, never echoed, preserved on empty."""

from src.db.sso import SSOConfig
from src.routers.sso import (
    _mask_provider_config,
    _merge_provider_config,
    _seal_provider_config,
    _serialize_config,
)
from src.security.secret_crypto import resolve_secret


def test_seal_encrypts_client_secret():
    sealed = _seal_provider_config({"client_id": "c", "client_secret": "supersecret"})
    assert sealed["client_id"] == "c"
    assert sealed["client_secret"] != "supersecret"
    assert resolve_secret(sealed["client_secret"]) == "supersecret"


def test_seal_leaves_absent_secret_absent():
    assert "client_secret" not in _seal_provider_config({"client_id": "c"})


def test_mask_removes_secret_but_keeps_rest():
    masked = _mask_provider_config(
        {"client_id": "c", "client_secret": "cipher", "issuer_url": "https://idp"}
    )
    assert "client_secret" not in masked
    assert masked["client_id"] == "c"
    assert masked["issuer_url"] == "https://idp"


def test_merge_preserves_stored_secret_on_empty():
    existing = {"client_id": "old", "client_secret": "cipher-old"}
    merged = _merge_provider_config(existing, {"client_id": "new", "client_secret": ""})
    assert merged["client_id"] == "new"
    assert merged["client_secret"] == "cipher-old"  # untouched


def test_merge_encrypts_new_secret():
    merged = _merge_provider_config({"client_id": "old"}, {"client_secret": "fresh"})
    assert merged["client_secret"] != "fresh"
    assert resolve_secret(merged["client_secret"]) == "fresh"


def test_serialize_config_never_returns_secret():
    config = SSOConfig(
        id=1,
        org_id=1,
        provider="custom_oidc",
        enabled=True,
        domains=["example.com"],
        auto_provision_users=False,
        provider_config={"client_id": "c", "client_secret": "cipher"},
    )
    serialized = _serialize_config(config)
    assert "client_secret" not in serialized["provider_config"]
    assert serialized["provider_config"]["client_id"] == "c"
