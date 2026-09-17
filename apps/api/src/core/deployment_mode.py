"""
Deployment mode.

This build is ungated: the separate Enterprise package, its licence checks, and
the feature gates have been removed. Every feature is enabled and unlimited.
The module keeps the ``DeploymentMode`` name for backward compatibility with
existing call sites, but always resolves to a single fully-enabled mode.
"""

from typing import Literal

DeploymentMode = Literal['saas', 'oss', 'ee']

# No features are gated in this build.
EE_ONLY_FEATURES: frozenset[str] = frozenset()


def get_deployment_mode() -> DeploymentMode:
    """Return the single ungated mode. No licence or feature gating applies."""
    return 'ee'
