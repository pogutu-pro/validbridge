"""Tests for the deployment-mode contract (src/core/deployment_mode.py).

This build is ungated: the separate Enterprise package, its licence checks and
the feature gates have been removed. ``get_deployment_mode()`` therefore always
resolves to the single fully-enabled mode — these tests pin that contract so a
future change cannot silently reintroduce gating.
"""

from src.core.deployment_mode import (
    EE_ONLY_FEATURES,
    DeploymentMode,
    get_deployment_mode,
)


def test_get_deployment_mode_always_returns_ee():
    """The ungated build resolves to 'ee' regardless of config or env."""
    assert get_deployment_mode() == "ee"


def test_deployment_mode_is_a_valid_literal():
    """The return type stays one of the documented modes."""
    assert get_deployment_mode() in DeploymentMode.__args__


def test_no_features_are_gated():
    """Nothing is restricted in this build."""
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