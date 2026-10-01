"""Tests for src/security/features_utils/plans.py."""

from unittest.mock import patch

import pytest

from src.security.features_utils.plans import (
    AI_CREDIT_LIMITS,
    DEFAULT_PLAN,
    FEATURE_PLAN_REQUIREMENTS,
    FREE_PLANS,
    LEGACY_PLAN_ALIASES,
    PLAN_FEATURE_CONFIGS,
    PLAN_HIERARCHY,
    PLAN_LIMITS,
    get_ai_credit_limit,
    get_feature_limit_for_plan,
    get_plan_config,
    get_plan_feature_config,
    get_plan_limit,
    get_required_plan_for_feature,
    is_feature_enabled_for_plan,
    is_paying_plan,
    next_plan_for,
    normalize_plan,
    plan_label,
    plan_meets_requirement,
)

OLD_IDS = ("free", "personal", "personal-family", "standard", "pro")


def _patch_mode(mode: str):
    return patch("src.core.deployment_mode.get_deployment_mode", return_value=mode)


class TestFeaturePlans:
    def test_constants_are_populated(self):
        assert PLAN_HIERARCHY == [
            "public-education",
            "starter",
            "growth",
            "business",
            "enterprise",
        ]
        assert DEFAULT_PLAN == "starter"
        assert FREE_PLANS == {"public-education", "starter"}
        assert set(PLAN_FEATURE_CONFIGS) == set(PLAN_HIERARCHY)
        assert set(AI_CREDIT_LIMITS) == set(PLAN_HIERARCHY)
        assert set(PLAN_LIMITS) == set(PLAN_HIERARCHY)
        for old in OLD_IDS:
            assert old not in PLAN_FEATURE_CONFIGS
            assert old not in FEATURE_PLAN_REQUIREMENTS.values()
        assert AI_CREDIT_LIMITS == {
            "public-education": 0,
            "starter": 0,
            "growth": 300,
            "business": 1500,
            "enterprise": 5000,
        }
        assert PLAN_FEATURE_CONFIGS["starter"]["cloud"]["plan"] == "starter"

    def test_requirements(self):
        assert FEATURE_PLAN_REQUIREMENTS["sso"] == "growth"  # bought as an add-on
        for feature in ("api_tokens", "webhooks", "custom_domains"):
            assert FEATURE_PLAN_REQUIREMENTS[feature] == "growth"
        for feature in (
            "analytics", "analytics_advanced", "versioning", "audit_logs", "roles",
            "communities", "boards", "podcasts", "playgrounds", "collaboration",
            "usergroups", "payments", "certifications", "ai", "seo",
        ):
            assert FEATURE_PLAN_REQUIREMENTS[feature] == "starter", feature

    def test_limits_are_coherent(self):
        for plan in PLAN_HIERARCHY:
            assert PLAN_LIMITS[plan]["courses"] == 0  # unlimited everywhere
            assert PLAN_LIMITS[plan]["members"] == 0  # learners via entitlements
        assert [PLAN_LIMITS[p]["admin_seats"] for p in PLAN_HIERARCHY] == [0, 1, 3, 10, 25]

    def test_normalize_and_labels(self):
        assert LEGACY_PLAN_ALIASES == {
            "free": "starter",
            "personal": "starter",
            "personal-family": "starter",
            "standard": "growth",
            "pro": "business",
        }
        assert normalize_plan("pro") == "business"
        assert normalize_plan("oss") == "starter"
        assert normalize_plan(None) == "starter"
        assert normalize_plan("growth") == "growth"
        assert plan_label("public-education") == "Public Education"
        assert plan_label("missing") == "Starter"

    def test_paying_and_next_plan(self):
        assert is_paying_plan("starter") is False
        assert is_paying_plan("public-education") is False
        assert is_paying_plan("growth") is True
        assert is_paying_plan("enterprise") is True
        assert next_plan_for("starter") == "growth"
        assert next_plan_for("public-education") == "growth"
        assert next_plan_for("business") == "enterprise"
        assert next_plan_for("enterprise") is None

    def test_get_plan_feature_config_known_and_unknown(self):
        assert get_plan_feature_config("starter", "courses") == {"enabled": True, "limit": 0}
        assert get_plan_feature_config("missing", "api") == {"enabled": False, "limit": 0}
        assert get_plan_feature_config("starter", "missing") == {"enabled": False, "limit": 0}

    def test_get_plan_config_known_and_unknown(self):
        assert get_plan_config("business")["cloud"]["plan"] == "business"
        assert get_plan_config("missing")["cloud"]["plan"] == "starter"

    @pytest.mark.parametrize(
        ("mode", "plan", "feature", "expected"),
        [
            ("saas", "starter", "analytics", True),
            ("saas", "starter", "api", False),
            ("saas", "growth", "api", True),
            ("saas", "business", "sso", False),
            ("saas", "enterprise", "sso", False),
            ("saas", "starter", "scorm", False),
            ("saas", "growth", "scorm", True),
            ("saas", "business", "scorm", True),
            ("saas", "enterprise", "scorm", True),
            ("ee", "starter", "analytics", True),
            ("ee", "starter", "api", True),
            # Cost-gated: plan decides even in ee/oss.
            ("ee", "growth", "sso", False),
            ("ee", "enterprise", "sso", False),
            ("oss", "starter", "boards", True),
            ("oss", "starter", "analytics", False),
            ("oss", "starter", "api", False),
            ("oss", "starter", "sso", False),
            ("oss", "starter", "audit_logs", False),
            ("oss", "starter", "scorm", False),
        ],
    )
    def test_is_feature_enabled_for_plan(self, mode, plan, feature, expected):
        with _patch_mode(mode):
            assert is_feature_enabled_for_plan(plan, feature) is expected

    @pytest.mark.parametrize(
        ("mode", "plan", "feature", "expected"),
        [
            ("saas", "growth", "members", 0),
            ("saas", "business", "ai", 0),
            ("saas", "starter", "missing", 0),
            ("ee", "growth", "members", 0),
            ("oss", "growth", "members", 0),
        ],
    )
    def test_get_feature_limit_for_plan(self, mode, plan, feature, expected):
        with _patch_mode(mode):
            assert get_feature_limit_for_plan(plan, feature) == expected

    @pytest.mark.parametrize(
        ("mode", "plan", "expected"),
        [
            ("saas", "starter", 0),
            ("saas", "public-education", 0),
            ("saas", "growth", 300),
            ("saas", "business", 1500),
            ("saas", "enterprise", 5000),
            ("saas", "missing", 0),  # unknown → starter
            ("ee", "starter", -1),
            ("oss", "starter", -1),
        ],
    )
    def test_get_ai_credit_limit(self, mode, plan, expected):
        with _patch_mode(mode):
            assert get_ai_credit_limit(plan) == expected

    @pytest.mark.parametrize(
        ("mode", "plan", "feature", "expected"),
        [
            ("saas", "growth", "admin_seats", 3),
            ("saas", "business", "admin_seats", 10),
            ("saas", "missing", "admin_seats", 1),
            ("saas", "starter", "members", 0),
            ("saas", "starter", "missing", 0),
            ("ee", "starter", "admin_seats", 0),
            ("oss", "starter", "admin_seats", 0),
        ],
    )
    def test_get_plan_limit(self, mode, plan, feature, expected):
        with _patch_mode(mode):
            assert get_plan_limit(plan, feature) == expected

    def test_plan_meets_requirement_saas(self):
        with _patch_mode("saas"):
            assert plan_meets_requirement("business", "growth") is True
            assert plan_meets_requirement("growth", "business") is False
            # Entry tiers share a rank.
            assert plan_meets_requirement("public-education", "starter") is True
            assert plan_meets_requirement("starter", "public-education") is True
            assert plan_meets_requirement("public-education", "growth") is False
            assert plan_meets_requirement("missing", "missing") is True

    def test_plan_meets_requirement_mode_bypass(self):
        with _patch_mode("ee"):
            assert plan_meets_requirement("starter", "enterprise") is True

        with _patch_mode("oss"):
            assert plan_meets_requirement("starter", "enterprise") is False
            assert plan_meets_requirement("starter", "business") is True

    def test_get_required_plan_for_feature(self):
        assert get_required_plan_for_feature("boards") == "starter"
        assert get_required_plan_for_feature("webhooks") == "growth"
        assert get_required_plan_for_feature("unknown") is None
