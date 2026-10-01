"""
Deployment mode.

The mode is read from the ``VALIDBRIDGE_DEPLOYMENT_MODE`` environment variable:

* ``ee``   (default) — every feature enabled and unlimited. This is what the
  production build has always run, so leaving the variable unset keeps
  behaviour identical.
* ``saas`` — plan-based feature access and limits apply (the hosted service
  once billing is switched on).
* ``oss``  — self-hosted without plan gating.

Cost-gated features (``COST_GATED_FEATURES`` in plans.py, e.g. SSO) are
resolved by plan in every mode, including ``ee``.

The value is read on every call (it is a cheap ``os.environ`` lookup) so tests
and operators can switch it without re-importing modules that hold a
reference to this function.
"""

import os
from typing import Literal, cast

DeploymentMode = Literal['saas', 'oss', 'ee']

DEPLOYMENT_MODE_ENV = "VALIDBRIDGE_DEPLOYMENT_MODE"
DEFAULT_DEPLOYMENT_MODE: DeploymentMode = 'ee'
_VALID_MODES: frozenset[str] = frozenset({'saas', 'oss', 'ee'})

# No features are gated by edition in this build.
EE_ONLY_FEATURES: frozenset[str] = frozenset()


def get_deployment_mode() -> DeploymentMode:
    """Return the deployment mode from the environment (default ``ee``).

    Unknown or empty values fall back to ``ee`` so a typo can never lock
    features that production relies on.
    """
    raw = (os.environ.get(DEPLOYMENT_MODE_ENV) or "").strip().lower()
    if raw in _VALID_MODES:
        return cast(DeploymentMode, raw)
    return DEFAULT_DEPLOYMENT_MODE
