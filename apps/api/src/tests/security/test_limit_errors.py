"""Tests for the §4.4 limit error contract."""

import pytest
from fastapi import HTTPException

from src.security.features_utils import limit_errors as le

EXPECTED_CODES = {
    "seat_limit_reached",
    "learner_allowance_grace",
    "learner_allowance_exceeded",
    "storage_quota_exceeded",
    "live_hours_exhausted",
    "live_concurrency_limit",
    "premium_ai_credits_exhausted",
    "code_runs_exhausted",
    "email_not_enabled",
    "feature_not_in_plan",
    "billing_paused",
    "spending_limit_reached",
}


def test_all_codes_present_with_status_options_message():
    assert le.ERROR_CODES == EXPECTED_CODES
    for code in EXPECTED_CODES:
        assert le.ERROR_STATUS[code] in (402, 403)
        assert le.DEFAULT_OPTIONS[code]
        assert le.DEFAULT_MESSAGES[code]


def test_plan_codes_are_403_and_payment_codes_402():
    assert le.ERROR_STATUS["feature_not_in_plan"] == 403
    assert le.ERROR_STATUS["live_concurrency_limit"] == 403
    assert le.ERROR_STATUS["storage_quota_exceeded"] == 402
    assert le.ERROR_STATUS["billing_paused"] == 402


def test_body_shape():
    exc = le.limit_error(
        le.STORAGE_QUOTA_EXCEEDED, metric="storage", used=2147483648, limit=2147483648
    )
    assert isinstance(exc, HTTPException)
    assert exc.status_code == 402
    assert exc.detail == {
        "error_code": "storage_quota_exceeded",
        "metric": "storage",
        "used": 2147483648,
        "limit": 2147483648,
        "options": ["buy_storage", "upgrade"],
        "message": le.DEFAULT_MESSAGES["storage_quota_exceeded"],
    }


def test_overrides():
    exc = le.limit_error(
        le.FEATURE_NOT_IN_PLAN, metric="sso", options=["contact_sales"],
        message="Enterprise feature", status_code=403,
    )
    assert exc.detail["options"] == ["contact_sales"]
    assert exc.detail["message"] == "Enterprise feature"


def test_raise_and_unknown_code():
    with pytest.raises(HTTPException) as exc:
        le.raise_limit_error(le.BILLING_PAUSED)
    assert exc.value.detail["error_code"] == "billing_paused"
    with pytest.raises(ValueError):
        le.limit_error("nope")
