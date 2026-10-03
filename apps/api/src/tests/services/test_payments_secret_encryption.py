"""BYOK Paystack secret is encrypted at rest and resolved transparently."""

from unittest.mock import AsyncMock

import pytest
from sqlmodel import select

from src.db.payments.payments import PaymentsConfig
from src.security.secret_crypto import resolve_secret
from src.services.payments.paystack import resolve_paystack_credentials
from src.services.payments.service import initialize_config


@pytest.fixture(autouse=True)
def _accept_keys(monkeypatch):
    # Saving keys asks Paystack whether they work; no network in tests.
    monkeypatch.setattr(
        "src.services.payments.service.paystack.check_secret_key", AsyncMock()
    )


async def test_secret_key_encrypted_at_rest(db, org):
    await initialize_config(
        org.id,
        "paystack",
        {"secret_key": "sk_test_abc", "public_key": "pk_test_x", "active": True},
        db,
    )
    row = (
        await db.execute(select(PaymentsConfig).where(PaymentsConfig.org_id == org.id))
    ).scalars().first()

    assert row is not None
    assert row.provider_config["secret_key"] != "sk_test_abc"  # never plaintext
    assert resolve_secret(row.provider_config["secret_key"]) == "sk_test_abc"
    assert row.provider_config["public_key"] == "pk_test_x"  # public key is not secret


async def test_resolve_paystack_credentials_decrypts(db, org):
    await initialize_config(
        org.id,
        "paystack",
        {"secret_key": "sk_test_abc", "public_key": "pk_test_x"},
        db,
    )
    creds = await resolve_paystack_credentials(org.id, db)
    assert creds.secret_key == "sk_test_abc"
    assert creds.public_key == "pk_test_x"


async def test_legacy_plaintext_row_still_resolves(db, org):
    """Rows written before encryption existed keep working (re-encrypted on save)."""
    db.add(
        PaymentsConfig(
            org_id=org.id,
            enabled=True,
            active=True,
            provider="paystack",
            provider_config={"secret_key": "sk_legacy", "public_key": "pk_legacy"},
        )
    )
    await db.commit()

    creds = await resolve_paystack_credentials(org.id, db)
    assert creds.secret_key == "sk_legacy"
