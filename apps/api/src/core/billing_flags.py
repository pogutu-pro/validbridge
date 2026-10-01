"""
Billing feature flags (environment driven).

* ``VALIDBRIDGE_BILLING_ENABLED``         — platform billing on/off (default off).
* ``VALIDBRIDGE_ENFORCEMENT_DEFAULT``     — ``off | shadow | enforce`` for every
  metric without an explicit ``enforcement_flag`` row (default ``shadow``).
* ``VALIDBRIDGE_PLATFORM_PAYSTACK_SECRET_KEY`` / ``_PUBLIC_KEY`` — ValidBridge's
  own Paystack account, separate from each school's course-sales keys.

Secrets returned here must never be logged, echoed in responses or put in
exception messages. Only the public key may be exposed to the browser.
"""

import os
from typing import Literal, cast

EnforcementMode = Literal["off", "shadow", "enforce"]

ENFORCEMENT_MODES: frozenset[str] = frozenset({"off", "shadow", "enforce"})
DEFAULT_ENFORCEMENT_MODE: EnforcementMode = "shadow"

BILLING_ENABLED_ENV = "VALIDBRIDGE_BILLING_ENABLED"
ENFORCEMENT_DEFAULT_ENV = "VALIDBRIDGE_ENFORCEMENT_DEFAULT"
PLATFORM_PAYSTACK_SECRET_KEY_ENV = "VALIDBRIDGE_PLATFORM_PAYSTACK_SECRET_KEY"
PLATFORM_PAYSTACK_PUBLIC_KEY_ENV = "VALIDBRIDGE_PLATFORM_PAYSTACK_PUBLIC_KEY"

_TRUTHY = {"1", "true", "yes", "on"}


def billing_enabled() -> bool:
    """True only when ``VALIDBRIDGE_BILLING_ENABLED`` is explicitly truthy."""
    return (os.environ.get(BILLING_ENABLED_ENV) or "").strip().lower() in _TRUTHY


def normalize_enforcement_mode(value: str | None) -> EnforcementMode | None:
    """Return a valid mode for ``value`` or None when it is not one."""
    raw = (value or "").strip().lower()
    if raw in ENFORCEMENT_MODES:
        return cast(EnforcementMode, raw)
    return None


def enforcement_default() -> EnforcementMode:
    """Global default enforcement mode (``shadow`` unless configured)."""
    return (
        normalize_enforcement_mode(os.environ.get(ENFORCEMENT_DEFAULT_ENV))
        or DEFAULT_ENFORCEMENT_MODE
    )


# ValidBridge's own Paystack account is also configured under these names (the
# platform fallback for course sales); billing uses them when the dedicated
# platform variables are not set.
_FALLBACK_SECRET_ENV = "VALIDBRIDGE_PAYSTACK_SECRET_KEY"
_FALLBACK_PUBLIC_ENV = "VALIDBRIDGE_PAYSTACK_PUBLIC_KEY"


def platform_paystack_secret_key() -> str | None:
    """ValidBridge platform Paystack secret key, or None. Never log this."""
    value = (
        os.environ.get(PLATFORM_PAYSTACK_SECRET_KEY_ENV)
        or os.environ.get(_FALLBACK_SECRET_ENV)
        or ""
    ).strip()
    return value or None


def platform_paystack_public_key() -> str | None:
    """ValidBridge platform Paystack public key, or None (safe for browsers)."""
    value = (
        os.environ.get(PLATFORM_PAYSTACK_PUBLIC_KEY_ENV)
        or os.environ.get(_FALLBACK_PUBLIC_ENV)
        or ""
    ).strip()
    return value or None


def platform_paystack_configured() -> bool:
    """Whether both platform keys are present (does not reveal them)."""
    return bool(platform_paystack_secret_key() and platform_paystack_public_key())


def billing_config_warnings(saas_mode: bool) -> list[str]:
    """Settings that disagree with each other in a way that silently switches
    plan limits or payments off.

    ``VALIDBRIDGE_SAAS`` (multi-tenant hosting) and
    ``VALIDBRIDGE_DEPLOYMENT_MODE`` (plan gating) are separate switches. Setting
    only the first leaves every plan limit unenforced, which is easy to miss
    because nothing else looks wrong.
    """
    from src.core.deployment_mode import DEPLOYMENT_MODE_ENV, get_deployment_mode

    mode = get_deployment_mode()
    warnings: list[str] = []
    if saas_mode and mode != "saas":
        warnings.append(
            f"VALIDBRIDGE_SAAS is on but {DEPLOYMENT_MODE_ENV} is '{mode}', so plan "
            f"limits (instructor seats, members, courses) are NOT enforced. Set "
            f"{DEPLOYMENT_MODE_ENV}=saas to enforce them."
        )
    if billing_enabled():
        if mode != "saas":
            warnings.append(
                f"{BILLING_ENABLED_ENV} is on but {DEPLOYMENT_MODE_ENV} is '{mode}': "
                f"schools can pay, but plan limits are not enforced."
            )
        if not platform_paystack_configured():
            warnings.append(
                f"{BILLING_ENABLED_ENV} is on but {PLATFORM_PAYSTACK_SECRET_KEY_ENV} / "
                f"{PLATFORM_PAYSTACK_PUBLIC_KEY_ENV} are not both set: checkout will fail."
            )
    elif mode == "saas":
        warnings.append(
            f"{DEPLOYMENT_MODE_ENV}=saas but {BILLING_ENABLED_ENV} is off: limits apply, "
            f"but schools have no way to pay to raise them."
        )
    return warnings
