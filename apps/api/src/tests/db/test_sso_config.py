"""Database-layer tests for the SSOConfig model."""

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from src.db.sso import SSO_PROVIDER_IDS, SSOConfig


def test_provider_ids_cover_frontend_contract():
    assert set(SSO_PROVIDER_IDS) == {
        "workos",
        "keycloak",
        "okta",
        "auth0",
        "custom_saml",
        "custom_oidc",
    }


async def test_create_and_read_config(db, org):
    config = SSOConfig(
        org_id=org.id,
        provider="workos",
        enabled=True,
        domains=["example.com"],
        auto_provision_users=True,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)

    assert config.id is not None
    row = (
        await db.execute(select(SSOConfig).where(SSOConfig.id == config.id))
    ).scalars().first()
    assert row is not None
    assert row.org_id == org.id
    assert row.provider == "workos"
    assert row.enabled is True
    assert row.domains == ["example.com"]


async def test_defaults(db, org):
    config = SSOConfig(org_id=org.id, provider="custom_oidc")
    db.add(config)
    await db.commit()
    await db.refresh(config)

    assert config.enabled is False
    assert config.auto_provision_users is False
    assert config.domains == []
    assert config.provider_config == {}
    assert config.default_role_id is None


async def test_unique_org_provider(db, org):
    db.add(SSOConfig(org_id=org.id, provider="workos"))
    await db.commit()
    db.add(SSOConfig(org_id=org.id, provider="workos"))
    with pytest.raises(IntegrityError):
        await db.commit()


async def test_distinct_providers_allowed(db, org):
    db.add(SSOConfig(org_id=org.id, provider="workos"))
    db.add(SSOConfig(org_id=org.id, provider="custom_oidc"))
    await db.commit()


def test_fk_ondelete_metadata():
    """The model's FK metadata must match the demo-teardown allowlist:
    org_id CASCADE, default_role_id SET NULL (verified at runtime by
    test_demo_teardown.py; SQLite in tests does not enforce FK actions)."""
    from src.db.sso import SSOConfig

    fks = {col.name: col for col in SSOConfig.__table__.columns if col.foreign_keys}
    assert "org_id" in fks
    assert "default_role_id" in fks

    org_fk = next(iter(fks["org_id"].foreign_keys))
    role_fk = next(iter(fks["default_role_id"].foreign_keys))
    assert org_fk.ondelete == "CASCADE"
    assert role_fk.ondelete == "SET NULL"
