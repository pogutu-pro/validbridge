"""Tests for src/core/billing_flags.py."""

import pytest

from src.core import billing_flags as bf


def test_billing_disabled_by_default(monkeypatch):
    monkeypatch.delenv(bf.BILLING_ENABLED_ENV, raising=False)
    assert bf.billing_enabled() is False


@pytest.mark.parametrize("value,expected", [
    ("1", True), ("true", True), ("YES", True), ("on", True),
    ("0", False), ("false", False), ("", False), ("maybe", False),
])
def test_billing_enabled_values(monkeypatch, value, expected):
    monkeypatch.setenv(bf.BILLING_ENABLED_ENV, value)
    assert bf.billing_enabled() is expected


def test_enforcement_default_is_shadow(monkeypatch):
    monkeypatch.delenv(bf.ENFORCEMENT_DEFAULT_ENV, raising=False)
    assert bf.enforcement_default() == "shadow"


@pytest.mark.parametrize("value,expected", [
    ("off", "off"), ("shadow", "shadow"), ("ENFORCE", "enforce"), ("bogus", "shadow"),
])
def test_enforcement_default_values(monkeypatch, value, expected):
    monkeypatch.setenv(bf.ENFORCEMENT_DEFAULT_ENV, value)
    assert bf.enforcement_default() == expected


def test_platform_keys(monkeypatch):
    for name in (bf.PLATFORM_PAYSTACK_SECRET_KEY_ENV, bf.PLATFORM_PAYSTACK_PUBLIC_KEY_ENV,
                 bf._FALLBACK_SECRET_ENV, bf._FALLBACK_PUBLIC_ENV):
        monkeypatch.delenv(name, raising=False)
    assert bf.platform_paystack_secret_key() is None
    assert bf.platform_paystack_public_key() is None
    assert bf.platform_paystack_configured() is False

    monkeypatch.setenv(bf.PLATFORM_PAYSTACK_SECRET_KEY_ENV, " sk_test_x ")
    monkeypatch.setenv(bf.PLATFORM_PAYSTACK_PUBLIC_KEY_ENV, "pk_test_y")
    assert bf.platform_paystack_secret_key() == "sk_test_x"
    assert bf.platform_paystack_public_key() == "pk_test_y"
    assert bf.platform_paystack_configured() is True


# ── Config consistency ───────────────────────────────────────────────────────

def _env(monkeypatch, *, mode=None, billing=None, keys=False):
    from src.core.deployment_mode import DEPLOYMENT_MODE_ENV

    monkeypatch.delenv(bf._FALLBACK_SECRET_ENV, raising=False)
    monkeypatch.delenv(bf._FALLBACK_PUBLIC_ENV, raising=False)
    for name, value in (
        (DEPLOYMENT_MODE_ENV, mode),
        (bf.BILLING_ENABLED_ENV, billing),
        (bf.PLATFORM_PAYSTACK_SECRET_KEY_ENV, "sk_test_x" if keys else None),
        (bf.PLATFORM_PAYSTACK_PUBLIC_KEY_ENV, "pk_test_y" if keys else None),
    ):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)


def test_saas_hosting_without_saas_mode_warns_limits_unenforced(monkeypatch):
    """The trap that let unlimited instructors through: VALIDBRIDGE_SAAS set,
    VALIDBRIDGE_DEPLOYMENT_MODE left at its 'ee' default."""
    _env(monkeypatch)
    warnings = bf.billing_config_warnings(saas_mode=True)
    assert any("NOT enforced" in w for w in warnings)


def test_consistent_launch_config_has_no_warnings(monkeypatch):
    _env(monkeypatch, mode="saas", billing="true", keys=True)
    assert bf.billing_config_warnings(saas_mode=True) == []


def test_self_hosted_default_has_no_warnings(monkeypatch):
    _env(monkeypatch)
    assert bf.billing_config_warnings(saas_mode=False) == []


def test_billing_without_platform_keys_warns(monkeypatch):
    _env(monkeypatch, mode="saas", billing="true", keys=False)
    assert any("checkout will fail" in w for w in bf.billing_config_warnings(saas_mode=True))


def test_saas_mode_without_billing_warns_no_way_to_pay(monkeypatch):
    _env(monkeypatch, mode="saas")
    assert any("no way to pay" in w for w in bf.billing_config_warnings(saas_mode=True))


def test_warnings_never_contain_secret_values(monkeypatch):
    _env(monkeypatch, mode="ee", billing="true", keys=True)
    joined = " ".join(bf.billing_config_warnings(saas_mode=True))
    assert "sk_test_x" not in joined and "pk_test_y" not in joined
