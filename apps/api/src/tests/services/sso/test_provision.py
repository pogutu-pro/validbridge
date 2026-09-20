"""Tests for SSO reconciliation + provisioning helpers."""


from src.db.sso import SSOConfig
from src.services.sso.provision import (
    email_domain_allowed,
    find_user_in_org,
    normalize_domain,
    resolve_default_role_id,
    resolve_org_by_slug,
)


def test_normalize_domain():
    assert normalize_domain("Example.COM") == "example.com"
    assert normalize_domain("@Example.com") == "example.com"
    assert normalize_domain("www.example.com") == "example.com"
    assert normalize_domain("  @WWW.Example.COM  ") == "example.com"
    assert normalize_domain("") == ""


def test_email_domain_allowed_exact_match():
    assert email_domain_allowed("user@example.com", ["example.com"])
    assert email_domain_allowed("user@Example.com", ["example.com"])
    assert not email_domain_allowed("user@evil.com", ["example.com"])
    assert not email_domain_allowed("user@example.com", [])
    assert not email_domain_allowed("no-at-sign", ["example.com"])
    # www/@ prefixes in the configured domains are ignored.
    assert email_domain_allowed("user@example.com", ["@www.example.com"])


async def test_resolve_org_by_slug_none(db):
    assert await resolve_org_by_slug(db, None) is None
    assert await resolve_org_by_slug(db, "missing-org") is None


async def test_resolve_org_by_slug(db, org):
    resolved = await resolve_org_by_slug(db, "test-org")
    assert resolved is not None
    assert resolved.id == org.id


async def test_find_user_in_org_absent(db, org):
    assert await find_user_in_org(db, "nobody@example.com", org.id) is None


async def test_find_user_in_org_present(db, org, admin_user):
    # admin_user fixture creates a User with email admin@test.com linked to org.
    user = await find_user_in_org(db, "admin@test.com", org.id)
    assert user is not None


async def test_resolve_default_role_id_missing(db, org):
    config = SSOConfig(org_id=org.id, provider="workos", default_role_id=None)
    assert await resolve_default_role_id(db, org.id, config) is None


async def test_resolve_default_role_id_bad_role(db, org):
    config = SSOConfig(org_id=org.id, provider="workos", default_role_id=999)
    assert await resolve_default_role_id(db, org.id, config) is None


async def test_resolve_default_role_id_valid(db, org, admin_role):
    config = SSOConfig(org_id=org.id, provider="workos", default_role_id=admin_role.id)
    assert await resolve_default_role_id(db, org.id, config) == admin_role.id


def test_resolve_default_role_importable():
    from src.services.sso.provision import resolve_default_role_id

    assert resolve_default_role_id is not None
