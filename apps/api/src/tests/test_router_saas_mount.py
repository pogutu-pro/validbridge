"""The internal cloud plan-state router is mounted unconditionally.

This build is ungated: `src/router.py` mounts the internal cloud plan endpoint
for every deployment mode (the old SaaS-only branch via
`_mount_saas_only_routers` was removed). FastAPI 0.121+ materializes included
routers lazily as `_IncludedRouter` entries, so we assert on the live wiring
rather than expanded route paths.
"""

from src.router import v1_router
from src.routers.orgs import org_plan


def test_cloud_internal_router_is_mounted():
    matched = [
        route
        for route in v1_router.routes
        if getattr(route, "original_router", None) is org_plan.internal_router
    ]
    assert len(matched) == 1, "internal cloud plan router must be mounted"
    assert "cloud_internal" in matched[0].include_context.prefix