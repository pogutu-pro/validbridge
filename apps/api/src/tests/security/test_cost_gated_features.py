"""SSO is cost-gated: resolved by plan in every deployment mode (incl. ee)."""

import pytest

from src.security.features_utils.plans import (
    COST_GATED_FEATURES,
    is_feature_enabled_for_plan,
)
from src.security.features_utils.resolve import resolve_all_features, resolve_feature


def _cfg(plan, overrides=None, toggles=None):
    return {
        "config_version": "2.0",
        "plan": plan,
        "overrides": overrides or {},
        "admin_toggles": toggles or {},
    }


def test_sso_is_cost_gated():
    assert "sso" in COST_GATED_FEATURES


@pytest.mark.parametrize("mode", ["ee", "saas", "oss"])
def test_sso_disabled_for_growth_in_every_mode(monkeypatch, mode):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", mode)
    r = resolve_feature("sso", _cfg("growth"))
    assert r["enabled"] is False
    assert r["available"] is False
    assert r["required_plan"] == "growth"  # bought as an add-on from Growth
    assert is_feature_enabled_for_plan("growth", "sso") is False


@pytest.mark.parametrize("mode", ["ee", "saas", "oss"])
def test_sso_not_included_in_enterprise(monkeypatch, mode):
    """SSO is a paid add-on: no plan includes it, Enterprise included."""
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", mode)
    r = resolve_feature("sso", _cfg("enterprise"))
    assert r["enabled"] is False
    assert is_feature_enabled_for_plan("enterprise", "sso") is False


def test_sso_addon_override_enables_enterprise(monkeypatch):
    monkeypatch.delenv("VALIDBRIDGE_DEPLOYMENT_MODE", raising=False)
    cfg = _cfg("enterprise", overrides={"sso": {"force_enabled": True, "source": "addon"}})
    assert resolve_feature("sso", cfg)["enabled"] is True


def test_sso_force_enabled_override_in_ee(monkeypatch):
    monkeypatch.delenv("VALIDBRIDGE_DEPLOYMENT_MODE", raising=False)  # ee
    r = resolve_feature("sso", _cfg("growth", overrides={"sso": {"force_enabled": True}}))
    assert r["enabled"] is True and r["available"] is True


def test_starter_and_public_education_have_no_sso_in_ee(monkeypatch):
    monkeypatch.delenv("VALIDBRIDGE_DEPLOYMENT_MODE", raising=False)
    for plan in ("starter", "public-education", "business"):
        assert resolve_feature("sso", _cfg(plan))["enabled"] is False


def test_other_features_stay_unlocked_in_ee(monkeypatch):
    """Only cost-gated features change in ee; everything else is as before."""
    monkeypatch.delenv("VALIDBRIDGE_DEPLOYMENT_MODE", raising=False)
    features = resolve_all_features(_cfg("starter"))
    for name, r in features.items():
        if name in COST_GATED_FEATURES:
            continue
        assert r["enabled"] is True, name
        assert r["limit"] == 0, name


def test_v1_config_enterprise_sso(monkeypatch):
    monkeypatch.delenv("VALIDBRIDGE_DEPLOYMENT_MODE", raising=False)
    cfg = {"config_version": "1.4", "cloud": {"plan": "enterprise"}, "features": {}}
    assert resolve_feature("sso", cfg)["enabled"] is False
    cfg["cloud"]["plan"] = "growth"
    assert resolve_feature("sso", cfg)["enabled"] is False
