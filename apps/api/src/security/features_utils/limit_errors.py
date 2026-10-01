"""
Limit error contract (pricing-implementation.md §4.4).

Every limit/entitlement refusal is an HTTPException whose ``detail`` is a dict
the web client reads by ``error_code``::

    {"error_code": "storage_quota_exceeded",
     "metric": "storage", "used": 2147483648, "limit": 2147483648,
     "options": ["buy_storage", "upgrade"], "message": "..."}

HTTP 402 when paying unlocks it (packs, seats, add-ons, unpaid bills);
HTTP 403 when the plan does not include it.
"""

from collections.abc import Iterable

from fastapi import HTTPException

# ---------------------------------------------------------------------------
# Codes
# ---------------------------------------------------------------------------

SEAT_LIMIT_REACHED = "seat_limit_reached"
LEARNER_ALLOWANCE_GRACE = "learner_allowance_grace"
LEARNER_ALLOWANCE_EXCEEDED = "learner_allowance_exceeded"
STORAGE_QUOTA_EXCEEDED = "storage_quota_exceeded"
LIVE_HOURS_EXHAUSTED = "live_hours_exhausted"
LIVE_CONCURRENCY_LIMIT = "live_concurrency_limit"
PREMIUM_AI_CREDITS_EXHAUSTED = "premium_ai_credits_exhausted"
CODE_RUNS_EXHAUSTED = "code_runs_exhausted"
EMAIL_NOT_ENABLED = "email_not_enabled"
FEATURE_NOT_IN_PLAN = "feature_not_in_plan"
BILLING_PAUSED = "billing_paused"
SPENDING_LIMIT_REACHED = "spending_limit_reached"

ERROR_CODES: frozenset[str] = frozenset({
    SEAT_LIMIT_REACHED,
    LEARNER_ALLOWANCE_GRACE,
    LEARNER_ALLOWANCE_EXCEEDED,
    STORAGE_QUOTA_EXCEEDED,
    LIVE_HOURS_EXHAUSTED,
    LIVE_CONCURRENCY_LIMIT,
    PREMIUM_AI_CREDITS_EXHAUSTED,
    CODE_RUNS_EXHAUSTED,
    EMAIL_NOT_ENABLED,
    FEATURE_NOT_IN_PLAN,
    BILLING_PAUSED,
    SPENDING_LIMIT_REACHED,
})

# 402 = payment unlocks it; 403 = the plan does not include it.
ERROR_STATUS: dict[str, int] = {
    SEAT_LIMIT_REACHED: 402,
    LEARNER_ALLOWANCE_GRACE: 402,
    LEARNER_ALLOWANCE_EXCEEDED: 402,
    STORAGE_QUOTA_EXCEEDED: 402,
    LIVE_HOURS_EXHAUSTED: 402,
    LIVE_CONCURRENCY_LIMIT: 403,
    PREMIUM_AI_CREDITS_EXHAUSTED: 402,
    CODE_RUNS_EXHAUSTED: 402,
    EMAIL_NOT_ENABLED: 402,
    FEATURE_NOT_IN_PLAN: 403,
    BILLING_PAUSED: 402,
    SPENDING_LIMIT_REACHED: 402,
}

# Default actions the UI offers for each code.
DEFAULT_OPTIONS: dict[str, tuple[str, ...]] = {
    SEAT_LIMIT_REACHED: ("add_seat", "upgrade"),
    LEARNER_ALLOWANCE_GRACE: ("add_seat", "upgrade"),
    LEARNER_ALLOWANCE_EXCEEDED: ("add_seat", "upgrade"),
    STORAGE_QUOTA_EXCEEDED: ("buy_storage", "upgrade"),
    LIVE_HOURS_EXHAUSTED: ("buy_live_hours", "live_unlimited", "upgrade"),
    LIVE_CONCURRENCY_LIMIT: ("upgrade",),
    PREMIUM_AI_CREDITS_EXHAUSTED: ("buy_ai_credits", "upgrade"),
    CODE_RUNS_EXHAUSTED: ("buy_code_runs", "upgrade"),
    EMAIL_NOT_ENABLED: ("byo_email", "managed_email"),
    FEATURE_NOT_IN_PLAN: ("upgrade",),
    BILLING_PAUSED: ("pay_invoice",),
    SPENDING_LIMIT_REACHED: ("raise_spending_limit",),
}

DEFAULT_MESSAGES: dict[str, str] = {
    SEAT_LIMIT_REACHED: "All instructor seats are in use. Add a seat to continue.",
    LEARNER_ALLOWANCE_GRACE: (
        "You are over your active learner allowance. New learners can still "
        "join during the grace period; add an instructor seat to stay covered."
    ),
    LEARNER_ALLOWANCE_EXCEEDED: (
        "Your active learner allowance is used up. Add an instructor seat to "
        "let new learners join."
    ),
    STORAGE_QUOTA_EXCEEDED: "Your storage is full. Add storage or upgrade to upload more.",
    LIVE_HOURS_EXHAUSTED: "This month's live class hours are used up.",
    LIVE_CONCURRENCY_LIMIT: "Your plan's limit of simultaneous live classes is reached.",
    PREMIUM_AI_CREDITS_EXHAUSTED: "Your premium AI credits are used up.",
    CODE_RUNS_EXHAUSTED: "This month's code runs are used up.",
    EMAIL_NOT_ENABLED: (
        "Sending this email needs managed email or your own email provider key."
    ),
    FEATURE_NOT_IN_PLAN: "This feature is not included in your plan.",
    BILLING_PAUSED: "Paid features are paused until the outstanding invoice is paid.",
    SPENDING_LIMIT_REACHED: "This would go over your monthly spending limit.",
}


def limit_error_body(
    error_code: str,
    *,
    metric: str | None = None,
    used: int | None = None,
    limit: int | None = None,
    options: Iterable[str] | None = None,
    message: str | None = None,
) -> dict:
    """Build the §4.4 JSON body. Unknown codes raise ValueError."""
    if error_code not in ERROR_CODES:
        raise ValueError(f"Unknown limit error code: {error_code}")
    return {
        "error_code": error_code,
        "metric": metric,
        "used": used,
        "limit": limit,
        "options": list(options) if options is not None else list(DEFAULT_OPTIONS[error_code]),
        "message": message or DEFAULT_MESSAGES[error_code],
    }


def limit_error(
    error_code: str,
    *,
    metric: str | None = None,
    used: int | None = None,
    limit: int | None = None,
    options: Iterable[str] | None = None,
    message: str | None = None,
    status_code: int | None = None,
) -> HTTPException:
    """Return (not raise) an HTTPException carrying the §4.4 body."""
    body = limit_error_body(
        error_code, metric=metric, used=used, limit=limit, options=options, message=message
    )
    return HTTPException(
        status_code=status_code or ERROR_STATUS[error_code],
        detail=body,
    )


def raise_limit_error(error_code: str, **kwargs) -> None:
    """Raise ``limit_error(error_code, **kwargs)``."""
    raise limit_error(error_code, **kwargs)
