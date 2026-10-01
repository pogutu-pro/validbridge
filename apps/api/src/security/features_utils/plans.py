"""
Plan-based feature restriction utilities.

Single source of truth for plan hierarchy, feature configs, and limits.
Org config only stores the plan name (cloud.plan) — all feature settings
are derived from these definitions at runtime.
"""

from typing import Literal


# Plan IDs (pricechange.md §3). "public-education" and "starter" are the free
# entry tiers; growth, business and enterprise are paid.
PlanLevel = Literal["public-education", "starter", "growth", "business", "enterprise"]

# Display / upgrade order (lowest first).
PLAN_HIERARCHY: list[str] = ["public-education", "starter", "growth", "business", "enterprise"]

# Rank used for requirement checks. Public Education and Starter are both entry
# tiers and share a rank, so a feature required at "starter" is available to
# Public Education and vice versa.
PLAN_RANK: dict[str, int] = {
    "public-education": 0,
    "starter": 0,
    "growth": 1,
    "business": 2,
    "enterprise": 3,
}

# Plan given to new organizations and used for unknown/legacy plan values.
DEFAULT_PLAN: PlanLevel = "starter"

# Plans with no base price.
FREE_PLANS: frozenset[str] = frozenset({"public-education", "starter"})

PLAN_LABELS: dict[str, str] = {
    "public-education": "Public Education",
    "starter": "Starter",
    "growth": "Growth",
    "business": "Business",
    "enterprise": "Enterprise",
}

# Features that cost ValidBridge real money per org (e.g. WorkOS for SSO).
# They are resolved by PLAN in every deployment mode, including "ee", so they
# stay locked unless the plan includes them or a per-org override
# (overrides.<feature>.force_enabled) grants them for a deal.
COST_GATED_FEATURES: frozenset[str] = frozenset({"sso"})

# Feature to required plan mapping. Everything in pricechange.md §2 is free on
# every plan, so it requires only the entry tier ("starter", which Public
# Education also meets).
FEATURE_PLAN_REQUIREMENTS: dict[str, PlanLevel] = {
    "ai": "starter",
    "analytics": "starter",
    "analytics_advanced": "starter",
    "audit_logs": "starter",
    "boards": "starter",
    "certifications": "starter",
    "collaboration": "starter",
    "communities": "starter",
    "payments": "starter",
    "playgrounds": "starter",
    "podcasts": "starter",
    "roles": "starter",
    "seo": "starter",
    "usergroups": "starter",
    "versioning": "starter",
    "api_tokens": "growth",
    "webhooks": "growth",
    "custom_domains": "growth",
    "scorm": "growth",
    "sso": "growth",  # bought as the "sso" add-on on any paid plan
}

# ============================================================================
# Comprehensive plan feature configs (single source of truth)
# ============================================================================
# Each plan defines: features (enabled + limits), general settings, cloud flags.
# limit=0 means unlimited for that feature.
#
# Metered allowances (instructor seats, learners, storage, live hours, premium
# AI, code runs) come from the price catalogue through entitlements.py, not
# from here. "members.limit" is therefore unlimited on every plan (the learner
# allowance is 200 active learners per instructor seat, enforced with a grace
# period by entitlements), and "members.admin_limit" mirrors the included
# instructor seats (0 = unlimited).


def _plan_features(*, paid_integrations: bool, sso: bool, scorm: bool) -> dict:
    return {
        "ai": {"enabled": True, "limit": 0},
        "analytics": {"enabled": True, "limit": 0},
        "api": {"enabled": paid_integrations, "limit": 0},
        "assignments": {"enabled": True, "limit": 0},
        "collaboration": {"enabled": True, "limit": 0},
        "courses": {"enabled": True, "limit": 0},
        "members": {"admin_limit": 0, "enabled": True, "limit": 0},
        "payments": {"enabled": True},
        "usergroups": {"enabled": True, "limit": 0},
        "podcasts": {"enabled": True, "limit": 0},
        "boards": {"enabled": True, "limit": 0},
        "folders": {"enabled": True},
        "communities": {"enabled": True},
        "playgrounds": {"enabled": True, "limit": 0},
        "roles": {"enabled": True},
        "scorm": {"enabled": scorm},
        "sso": {"enabled": sso},
        "versioning": {"enabled": True},
        "webhooks": {"enabled": paid_integrations, "limit": 0},
        "audit_logs": {"enabled": True},
    }


def _plan_config(
    plan: str,
    *,
    admin_limit: int,
    paid_integrations: bool,
    sso: bool = False,
    scorm: bool = False,
    watermark: bool,
) -> dict:
    features = _plan_features(paid_integrations=paid_integrations, sso=sso, scorm=scorm)
    features["members"]["admin_limit"] = admin_limit
    return {
        "features": features,
        "general": {"watermark": watermark},
        "cloud": {"plan": plan, "custom_domain": paid_integrations},
    }


PLAN_FEATURE_CONFIGS: dict[str, dict] = {
    "public-education": _plan_config(
        "public-education", admin_limit=0, paid_integrations=False, watermark=True
    ),
    "starter": _plan_config(
        "starter", admin_limit=1, paid_integrations=False, watermark=True
    ),
    "growth": _plan_config(
        "growth", admin_limit=3, paid_integrations=True, scorm=True, watermark=True
    ),
    "business": _plan_config(
        "business", admin_limit=10, paid_integrations=True, scorm=True, watermark=False
    ),
    "enterprise": _plan_config(
        "enterprise", admin_limit=25, paid_integrations=True, sso=False, scorm=True,
        watermark=False,
    ),
}

# Plan-based resource limits (for plan-based features checked against DB counts)
# 0 = unlimited
PLAN_LIMITS: dict[str, dict[str, int]] = {
    plan: {
        "courses": cfg["features"]["courses"]["limit"],
        "members": cfg["features"]["members"]["limit"],
        "admin_seats": cfg["features"]["members"]["admin_limit"],
    }
    for plan, cfg in PLAN_FEATURE_CONFIGS.items()
}

# Premium AI credit allocation per plan per month (pricechange.md §3).
# 0 = no access, -1 = unlimited. Enterprise deals raise this per org.
# Own-model AI never uses credits.
AI_CREDIT_LIMITS: dict[str, int] = {
    "public-education": 0,
    "starter": 0,
    "growth": 300,
    "business": 1500,
    "enterprise": 5000,
}


# ============================================================================
# Lookup helpers
# ============================================================================

# Pre-2026-09 plan IDs → new IDs. The Alembic data migration rewrites stored
# values; this map is only a read-time safety net (e.g. a config restored from
# an old backup) and must match that migration.
LEGACY_PLAN_ALIASES: dict[str, str] = {
    "free": "starter",
    "personal": "starter",
    "personal-family": "starter",
    "standard": "growth",
    "pro": "business",
}


def normalize_plan(plan: str | None) -> str:
    """Return a known plan ID for ``plan``.

    Legacy IDs map through ``LEGACY_PLAN_ALIASES``; anything else unknown
    (including the old "oss" pseudo-plan) → ``DEFAULT_PLAN``.
    """
    if plan in PLAN_RANK:
        return plan  # type: ignore[return-value]
    if plan in LEGACY_PLAN_ALIASES:
        return LEGACY_PLAN_ALIASES[plan]  # type: ignore[index]
    return DEFAULT_PLAN


def plan_label(plan: str | None) -> str:
    """Human-readable plan name for messages."""
    return PLAN_LABELS.get(normalize_plan(plan), PLAN_LABELS[DEFAULT_PLAN])


def plan_rank(plan: str | None) -> int:
    return PLAN_RANK.get(normalize_plan(plan), 0)


def next_plan_for(plan: str | None) -> str | None:
    """The cheapest plan strictly above ``plan``, or None at the top."""
    current = plan_rank(plan)
    for candidate in PLAN_HIERARCHY:
        if PLAN_RANK[candidate] > current:
            return candidate
    return None


def get_plan_feature_config(plan: str, feature: str) -> dict:
    """
    Get the full feature config for a plan.

    Returns:
        Dict with at least {enabled, limit} keys. Returns disabled/0 for unknown features.
    """
    cfg = PLAN_FEATURE_CONFIGS.get(normalize_plan(plan), PLAN_FEATURE_CONFIGS[DEFAULT_PLAN])
    return cfg["features"].get(feature, {"enabled": False, "limit": 0})


def is_paying_plan(plan: str) -> bool:
    """
    Whether `plan` is a paid plan (anything but the free entry tiers).

    Features INCLUDED in a paid plan are guaranteed to the organization: an
    admin/superadmin per-org toggle can never disable them (paying users always
    keep the features their plan makes available). The toggle still governs free
    orgs and comp-granted extras. See resolve_feature().
    """
    return normalize_plan(plan) not in FREE_PLANS


def is_feature_enabled_for_plan(plan: str, feature: str) -> bool:
    """Check if a feature is enabled for a given plan."""
    if feature in COST_GATED_FEATURES:
        # Resolved by plan in every mode (e.g. SSO stays Enterprise-only in EE).
        return get_plan_feature_config(plan, feature).get("enabled", False)
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode == 'ee':
        return True
    if mode == 'oss':
        # OSS enables all non-EE features
        return feature not in ('analytics', 'api', 'sso', 'audit_logs', 'scorm')
    return get_plan_feature_config(plan, feature).get("enabled", False)


def get_feature_limit_for_plan(plan: str, feature: str) -> int:
    """
    Get the limit for a specific feature from the plan config.

    Returns:
        The limit (0 = unlimited).
    """
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode != 'saas':
        return 0  # Unlimited in EE and OSS modes
    return get_plan_feature_config(plan, feature).get("limit", 0)


def get_plan_config(plan: str) -> dict:
    """Get the full plan config. Returns the default plan's config for unknown plans."""
    return PLAN_FEATURE_CONFIGS.get(normalize_plan(plan), PLAN_FEATURE_CONFIGS[DEFAULT_PLAN])


def get_ai_credit_limit(plan: str) -> int:
    """
    Get the AI credit limit for a specific plan.

    Returns:
        The AI credit limit (0 = no access, -1 = unlimited)
    """
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode != 'saas':
        return -1  # Unlimited in EE and OSS modes
    return AI_CREDIT_LIMITS.get(normalize_plan(plan), 0)


def get_plan_limit(plan: str, feature: str) -> int:
    """
    Get the limit for a plan-based feature (courses, members, admin_seats).

    Returns:
        The limit for the feature (0 means unlimited)
    """
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode != 'saas':
        return 0  # Unlimited in EE and OSS modes
    plan_limits = PLAN_LIMITS.get(normalize_plan(plan), PLAN_LIMITS[DEFAULT_PLAN])
    return plan_limits.get(feature, 0)


def plan_rank_meets(current_plan: str | None, required_plan: str | None) -> bool:
    """Pure rank comparison (no deployment-mode shortcut)."""
    return plan_rank(current_plan) >= plan_rank(required_plan)


def plan_meets_requirement(current_plan: str, required_plan: str) -> bool:
    """
    Check if the current plan meets or exceeds the required plan level.
    """
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode == 'ee':
        return True
    if mode == 'oss':
        return required_plan != 'enterprise'
    # SaaS: normal rank check (Public Education and Starter share a rank)
    return plan_rank_meets(current_plan, required_plan)


def get_required_plan_for_feature(feature_key: str) -> PlanLevel | None:
    """
    Get the required plan level for a specific feature.
    """
    return FEATURE_PLAN_REQUIREMENTS.get(feature_key)
