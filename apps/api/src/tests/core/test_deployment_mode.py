"""Tests for the deployment-mode contract (src/core/deployment_mode.py).

The mode comes from VALIDBRIDGE_DEPLOYMENT_MODE (saas | ee | oss) and defaults
to 'ee' — everything unlocked, exactly what production ran before the switch
became env-driven.
"""

import pytest

from src.core.deployment_mode import (
    EE_ONLY_FEATURES,
    DeploymentMode,
    get_deployment_mode,
)


def test_defaults_to_ee_when_unset(monkeypatch):
    monkeypatch.delenv("VALIDBRIDGE_DEPLOYMENT_MODE", raising=False)
    assert get_deployment_mode() == "ee"


@pytest.mark.parametrize("value", ["saas", "ee", "oss", " SaaS ", "OSS"])
def test_reads_env(monkeypatch, value):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", value)
    assert get_deployment_mode() == value.strip().lower()


@pytest.mark.parametrize("value", ["", "enterprise", "cloud", "1"])
def test_unknown_values_fall_back_to_ee(monkeypatch, value):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", value)
    assert get_deployment_mode() == "ee"


def test_deployment_mode_is_a_valid_literal():
    """The return type stays one of the documented modes."""
    assert get_deployment_mode() in DeploymentMode.__args__


def test_no_features_are_edition_gated():
    assert EE_ONLY_FEATURES == frozenset()


def test_empty_ee_dir_does_not_count_as_ee_available(tmp_path, monkeypatch):
    """A directory named "ee" with no hooks.py is not an EE install.

    is_ee_available() lives in ee_hooks (not deployment_mode) and is consulted
    on its own for hook wiring, so it should not claim EE is present either.
    """
    from src.core.ee_hooks import is_ee_available

    monkeypatch.delenv("VALIDBRIDGE_DISABLE_EE", raising=False)
    monkeypatch.chdir(tmp_path)
    (tmp_path / "ee").mkdir()
    assert is_ee_available() is False

    (tmp_path / "ee" / "hooks.py").write_text("")
    assert is_ee_available() is True
