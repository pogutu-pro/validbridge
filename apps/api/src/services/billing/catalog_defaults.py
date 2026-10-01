"""
Default price catalogue (version 1), from pricechange.md §3–4.

This module is the single source for the seeded ``price_catalog`` row: the
Alembic migration that creates the billing tables inserts
``build_default_catalog()`` as version 1, and ``get_entitlements`` falls back
to it when the table is empty (fresh test databases, local dev).

Conventions
-----------
* Money is **integer KES cents** (KES × 100). Never floats.
* ``None`` for an allowance means *unlimited* (or, on Enterprise, *agreed per
  contract*: set through per-org overrides).
* Storage is in bytes (binary GB = 1024³). Live time is in seconds.
* Superadmins publish new versions later (W11); this file never changes the
  meaning of an existing version once it is live.
"""

from copy import deepcopy
from typing import Any

CATALOG_VERSION = 4  # v2: SSO add-on; v3: Enterprise base price; v4: no free AI credits on free plans
CURRENCY = "KES"

GB = 1024 ** 3
HOUR = 3600


def kes(amount: int) -> int:
    """Whole KES → integer cents."""
    return int(amount) * 100


# Plan order for display; entry tiers first.
PLAN_IDS: tuple[str, ...] = (
    "public-education",
    "starter",
    "growth",
    "business",
    "enterprise",
)

LEARNERS_PER_SEAT = 200
LEARNER_GRACE_DAYS = 7
YEARLY_DISCOUNT_PERCENT = 15

# Badge policy: "required" (always shown), "addon" (removable with the
# remove_badge add-on), "removed" (never shown).
_PLANS: dict[str, dict[str, Any]] = {
    "public-education": {
        "label": "Public Education",
        "price_cents": 0,
        "self_serve": False,
        "requires_verification": True,
        "included_seats": None,  # unlimited instructor seats
        "extra_seat_price_cents": None,
        "learners_per_seat": LEARNERS_PER_SEAT,
        "learner_allowance": None,  # 200 × instructors
        "storage_bytes": 2 * GB,
        "live_seconds": 10 * HOUR,
        "live_concurrency": 2,
        "premium_ai_credits": 0,  # AI credits are bought upfront; Genie is free
        "code_runs": 2000,
        "recording_retention_days": 90,
        "features": {
            "api": False,
            "webhooks": False,
            "zapier": False,
            "custom_domain": False,
            "sso": False,
            "managed_email": False,
            "byo_email": True,
            "remove_badge": False,
        },
        "badge": "required",
        "support": "community",
    },
    "starter": {
        "label": "Starter",
        "price_cents": 0,
        "self_serve": True,
        "requires_verification": False,
        "included_seats": 1,
        "extra_seat_price_cents": None,
        "learners_per_seat": LEARNERS_PER_SEAT,
        "learner_allowance": 50,  # fixed on Starter
        "storage_bytes": 1 * GB,
        "live_seconds": 2 * HOUR,
        "live_concurrency": 1,
        "premium_ai_credits": 0,  # AI credits are bought upfront; Genie is free
        "code_runs": 200,
        "recording_retention_days": 90,
        "features": {
            "api": False,
            "webhooks": False,
            "zapier": False,
            "custom_domain": False,
            "sso": False,
            "managed_email": False,
            "byo_email": True,
            "remove_badge": False,
        },
        "badge": "required",
        "support": "community",
    },
    "growth": {
        "label": "Growth",
        "price_cents": kes(3500),
        "self_serve": True,
        "requires_verification": False,
        "included_seats": 3,
        "extra_seat_price_cents": kes(500),
        "learners_per_seat": LEARNERS_PER_SEAT,
        "learner_allowance": None,
        "storage_bytes": 10 * GB,
        "live_seconds": 30 * HOUR,
        "live_concurrency": 3,
        "premium_ai_credits": 300,
        "code_runs": 5000,
        "recording_retention_days": None,  # kept
        "features": {
            "api": True,
            "webhooks": True,
            "zapier": True,
            "custom_domain": True,
            "sso": False,
            "managed_email": False,
            "byo_email": True,
            "remove_badge": False,
        },
        "badge": "addon",
        "support": "standard",
    },
    "business": {
        "label": "Business",
        "price_cents": kes(9500),
        "self_serve": True,
        "requires_verification": False,
        "included_seats": 10,
        "extra_seat_price_cents": kes(400),
        "learners_per_seat": LEARNERS_PER_SEAT,
        "learner_allowance": None,
        "storage_bytes": 50 * GB,
        "live_seconds": 100 * HOUR,
        "live_concurrency": 10,
        "premium_ai_credits": 1500,
        "code_runs": 20000,
        "recording_retention_days": None,
        "features": {
            "api": True,
            "webhooks": True,
            "zapier": True,
            "custom_domain": True,
            "sso": False,
            "managed_email": True,
            "byo_email": True,
            "remove_badge": True,
        },
        "badge": "removed",
        "support": "priority",
    },
    "enterprise": {
        "label": "Enterprise",
        # Base price; a superadmin custom deal (overrides.billing) replaces it
        # and overrides.entitlements raise any allowance per school.
        "price_cents": kes(17547),
        "self_serve": True,
        "requires_verification": False,
        "included_seats": 25,
        "extra_seat_price_cents": kes(350),
        "learners_per_seat": LEARNERS_PER_SEAT,
        "learner_allowance": None,
        "storage_bytes": 250 * GB,
        "live_seconds": 300 * HOUR,
        "live_concurrency": 10,
        "premium_ai_credits": 5000,
        "code_runs": 50000,
        "recording_retention_days": None,
        "features": {
            "api": True,
            "webhooks": True,
            "zapier": True,
            "custom_domain": True,
            "sso": False,  # SSO is the "sso" add-on on every paid plan
            "managed_email": True,
            "byo_email": True,
            "remove_badge": True,
        },
        "badge": "removed",
        "support": "dedicated",
    },
}

# One-time packs; never expire. ``kind`` matches pack_balance.kind.
_PACKS: dict[str, list[dict[str, Any]]] = {
    "ai_credits": [
        {"id": "ai_100", "quantity": 100, "price_cents": kes(150)},
        {"id": "ai_500", "quantity": 500, "price_cents": kes(650)},
        {"id": "ai_1000", "quantity": 1000, "price_cents": kes(1200)},
    ],
    "live_seconds": [
        {"id": "live_10h", "quantity": 10 * HOUR, "price_cents": kes(300)},
        {"id": "live_50h", "quantity": 50 * HOUR, "price_cents": kes(1200)},
        {"id": "live_100h", "quantity": 100 * HOUR, "price_cents": kes(2000)},
    ],
    "code_runs": [
        {"id": "code_5000", "quantity": 5000, "price_cents": kes(200)},
    ],
}

# Monthly add-ons. ``id`` matches org_addon.addon.
_ADDONS: dict[str, dict[str, Any]] = {
    "live_unlimited": {
        "price_cents": kes(350),
        "per": "instructor",
        "fair_use_seconds": 60 * HOUR,
    },
    "managed_email": {
        "price_cents": kes(900),
        "per": "org",
        "included_emails": 5000,
        "extra_block_emails": 5000,
        "extra_block_price_cents": kes(300),
        "included_in_plans": ["business", "enterprise"],
    },
    "remove_badge": {
        "price_cents": kes(500),
        "per": "org",
        "available_on_plans": ["growth"],
    },
    # Single sign-on (WorkOS or OIDC). Optional on any paid plan: priced to
    # cover the WorkOS connection (~$125/month) plus margin.
    "sso": {
        "price_cents": kes(20000),
        "per": "org",
        "available_on_plans": ["growth", "business", "enterprise"],
    },
    "extra_seat": {
        "per": "seat",
        "price_cents_by_plan": {
            "growth": kes(500),
            "business": kes(400),
            "enterprise": kes(350),
        },
    },
}

_STORAGE_OVERAGE: dict[str, Any] = {
    "price_cents_per_gb_month": kes(15),
    "gb_bytes": GB,
}

# Premium AI credit costs per task (pricechange.md §4).
_PREMIUM_AI_COSTS: dict[str, int] = {
    "image": 5,
    "narrated_audio": 3,
    "pro_model": 3,
}


def build_default_catalog() -> dict[str, Any]:
    """Return a fresh, JSON-serialisable copy of the v1 catalogue items."""
    return deepcopy(
        {
            "version": CATALOG_VERSION,
            "currency": CURRENCY,
            "plan_order": list(PLAN_IDS),
            "default_plan": "starter",
            "plans": _PLANS,
            "packs": _PACKS,
            "addons": _ADDONS,
            "storage_overage": _STORAGE_OVERAGE,
            "premium_ai_costs": _PREMIUM_AI_COSTS,
            "yearly_discount_percent": YEARLY_DISCOUNT_PERCENT,
            "learners_per_seat": LEARNERS_PER_SEAT,
            "learner_grace_days": LEARNER_GRACE_DAYS,
        }
    )


DEFAULT_CATALOG: dict[str, Any] = build_default_catalog()
