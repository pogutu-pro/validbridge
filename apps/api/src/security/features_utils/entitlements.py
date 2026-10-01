"""
Entitlements: the single source every limit check uses
(pricing-implementation.md §4.3).

    ent = await get_entitlements(org_id, db)
    decision = await check(org_id, METRIC_STORAGE, upload_bytes, db)
    decision.raise_if_blocked()          # 402/403 with the §4.4 error body
    await record_usage(org_id, METRIC_CODE_RUNS, 1, db)

Inputs, in order:
1. the org's plan (org config, v1 ``cloud.plan`` or v2 ``plan``),
2. the active price catalogue (``price_catalog``; falls back to
   ``catalog_defaults`` when the table is empty),
3. active ``org_addon`` rows (extra seats, LiveBridge Unlimited, managed
   email, badge removal),
4. ``pack_balance`` rows (purchased, non-expiring),
5. per-org overrides in the v2 org config:
   * ``overrides.entitlements.<field>`` — absolute value for any numeric
     field below (``null`` = unlimited), e.g. an Enterprise contract,
   * ``overrides.<feature>.force_enabled`` — grant a feature (SSO for a deal),
6. ``billing_account.exempt`` and the demo org (always exempt).

Enforcement mode per metric: per-org ``billing_account.enforcement_overrides``
→ global ``enforcement_flag`` row → ``VALIDBRIDGE_ENFORCEMENT_DEFAULT``
(default ``shadow``). ``off`` always allows; ``shadow`` logs and allows;
``enforce`` blocks.

Numeric allowances use ``None`` for unlimited.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.billing_flags import (
    EnforcementMode,
    enforcement_default,
    normalize_enforcement_mode,
)
from src.db.billing import (
    BillingAccount,
    EnforcementFlag,
    OrgAddon,
    PackBalance,
    PriceCatalog,
    StorageSnapshot,
    UsageCounter,
)
from src.db.billing._common import current_period, utcnow
from src.security.features_utils import limit_errors
from src.security.features_utils.plans import DEFAULT_PLAN, normalize_plan
from src.services.billing.catalog_defaults import (
    CATALOG_VERSION as DEFAULT_CATALOG_VERSION,
)
from src.services.billing.catalog_defaults import (
    build_default_catalog,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

METRIC_INSTRUCTOR_SEATS = "instructor_seats"
METRIC_LEARNERS = "learners"
METRIC_STORAGE = "storage"
METRIC_LIVE_SECONDS = "live_seconds"
METRIC_LIVE_CONCURRENCY = "live_concurrency"
METRIC_PREMIUM_AI_CREDITS = "premium_ai_credits"
METRIC_CODE_RUNS = "code_runs"
METRIC_MANAGED_EMAILS = "managed_emails"

# Monthly metrics are counted in usage_counter (period YYYY-MM) and topped up
# by the matching pack kind.
MONTHLY_METRICS: dict[str, str | None] = {
    METRIC_LIVE_SECONDS: "live_seconds",
    METRIC_PREMIUM_AI_CREDITS: "ai_credits",
    METRIC_CODE_RUNS: "code_runs",
    METRIC_MANAGED_EMAILS: None,
}

# Point-in-time metrics: the caller passes the current value (``used=``) or a
# default source is queried.
GAUGE_METRICS: frozenset[str] = frozenset({
    METRIC_INSTRUCTOR_SEATS,
    METRIC_LEARNERS,
    METRIC_STORAGE,
    METRIC_LIVE_CONCURRENCY,
})

# Boolean features in Entitlements.features. check(org, "sso", 1, db) etc.
FEATURE_METRICS: frozenset[str] = frozenset({
    "api",
    "webhooks",
    "zapier",
    "custom_domain",
    "sso",
    "managed_email",
    "byo_email",
    "remove_badge",
})

# Entitlement feature → org-config override key (``overrides.<key>``).
_FEATURE_OVERRIDE_KEYS: dict[str, str] = {
    "custom_domain": "custom_domains",
}

METRIC_ERROR_CODES: dict[str, str] = {
    METRIC_INSTRUCTOR_SEATS: limit_errors.SEAT_LIMIT_REACHED,
    METRIC_LEARNERS: limit_errors.LEARNER_ALLOWANCE_EXCEEDED,
    METRIC_STORAGE: limit_errors.STORAGE_QUOTA_EXCEEDED,
    METRIC_LIVE_SECONDS: limit_errors.LIVE_HOURS_EXHAUSTED,
    METRIC_LIVE_CONCURRENCY: limit_errors.LIVE_CONCURRENCY_LIMIT,
    METRIC_PREMIUM_AI_CREDITS: limit_errors.PREMIUM_AI_CREDITS_EXHAUSTED,
    METRIC_CODE_RUNS: limit_errors.CODE_RUNS_EXHAUSTED,
    METRIC_MANAGED_EMAILS: limit_errors.EMAIL_NOT_ENABLED,
}

ALL_METRICS: frozenset[str] = frozenset(METRIC_ERROR_CODES) | FEATURE_METRICS

# Numeric fields that ``overrides.entitlements`` may set.
_OVERRIDABLE_FIELDS: frozenset[str] = frozenset({
    "instructor_seats",
    "learner_allowance",
    "storage_bytes",
    "live_seconds_month",
    "live_concurrency",
    "premium_ai_credits_month",
    "code_runs_month",
    "managed_emails_month",
})

CACHE_TTL_SECONDS = 60
_CACHE_KEY = "entitlements:v1:{org_id}"


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Entitlements:
    org_id: int
    plan: str
    catalog_version: int
    instructor_seats: int | None          # included + extra-seat add-ons (+ overrides); None = unlimited
    learner_allowance: int | None         # 200 × seats (Starter: fixed 50); None = unlimited
    storage_bytes: int | None
    live_seconds_month: int | None        # plan allowance; packs in ``packs``
    live_unlimited_instructors: int          # instructors covered by LiveBridge Unlimited
    live_concurrency: int | None
    premium_ai_credits_month: int | None
    code_runs_month: int | None
    managed_email: bool
    managed_emails_month: int | None      # emails included per month (0 when not managed)
    byo_email: bool
    features: dict[str, bool] = field(default_factory=dict)
    packs: dict[str, int] = field(default_factory=dict)  # pack kind → remaining
    exempt: bool = False                     # demo / comped: never billed or limited

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str | bytes) -> Entitlements:
        return cls(**json.loads(raw))


Outcome = Literal["allowed", "shadow_blocked", "blocked"]


@dataclass(frozen=True)
class Decision:
    outcome: Outcome
    metric: str
    amount: int
    used: int | None
    limit: int | None
    mode: EnforcementMode
    error_code: str | None = None
    reason: str | None = None  # "exempt", "off", "unlimited", "within_limit", "over_limit", "not_in_plan"

    @property
    def allowed(self) -> bool:
        """True unless the action must be refused (shadow still allows)."""
        return self.outcome != "blocked"

    @property
    def over_limit(self) -> bool:
        """True when the limit would be passed, whatever the mode."""
        return self.outcome in ("shadow_blocked", "blocked")

    def to_http_exception(self) -> HTTPException | None:
        if self.error_code is None:
            return None
        return limit_errors.limit_error(
            self.error_code, metric=self.metric, used=self.used, limit=self.limit
        )

    def raise_if_blocked(self) -> None:
        if self.outcome == "blocked":
            exc = self.to_http_exception()
            if exc is not None:
                raise exc


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

def _redis():
    try:
        from src.core.redis import get_redis_client

        return get_redis_client()
    except Exception:
        return None


def _cache_get(org_id: int) -> Entitlements | None:
    r = _redis()
    if r is None:
        return None
    try:
        raw = r.get(_CACHE_KEY.format(org_id=org_id))
        if raw:
            return Entitlements.from_json(raw)
    except Exception:
        logger.debug("entitlements cache read failed", exc_info=True)
    return None


def _cache_set(ent: Entitlements) -> None:
    r = _redis()
    if r is None:
        return
    try:
        r.setex(_CACHE_KEY.format(org_id=ent.org_id), CACHE_TTL_SECONDS, ent.to_json())
    except Exception:
        logger.debug("entitlements cache write failed", exc_info=True)


def invalidate_entitlements(org_id: int) -> None:
    """Drop the cached entitlements for an org (call after any plan, add-on,
    pack, override or billing-account change)."""
    r = _redis()
    if r is None:
        return
    try:
        r.delete(_CACHE_KEY.format(org_id=org_id))
    except Exception:
        logger.debug("entitlements cache invalidation failed", exc_info=True)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


async def get_active_catalog(db: AsyncSession) -> tuple[int, dict[str, Any]]:
    """(version, items) of the newest catalogue already in effect."""
    now = utcnow()
    try:
        rows = (
            await db.execute(select(PriceCatalog).order_by(PriceCatalog.version.desc()))
        ).scalars().all()
    except Exception:
        logger.warning("price_catalog unavailable; using built-in defaults", exc_info=True)
        rows = []
    for row in rows:
        effective = _aware(row.effective_from)
        if effective is None or effective <= now:
            return int(row.version), dict(row.items or {})
    return DEFAULT_CATALOG_VERSION, build_default_catalog()


def _plan_from_config(config: dict) -> str:
    config = config or {}
    if str(config.get("config_version", "1.0")).startswith("2"):
        return normalize_plan(config.get("plan", DEFAULT_PLAN))
    return normalize_plan((config.get("cloud") or {}).get("plan", DEFAULT_PLAN))


def _overrides(config: dict) -> dict:
    """Per-org overrides. Read for every config version: a superadmin
    allowance must apply whatever layout the org's config uses."""
    overrides = (config or {}).get("overrides")
    return overrides if isinstance(overrides, dict) else {}


async def _load_org_config(org_id: int, db: AsyncSession) -> dict:
    from src.db.organization_config import OrganizationConfig

    row = (
        await db.execute(
            select(OrganizationConfig.config).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()
    return row or {}


async def _count_instructor_seats(org_id: int, db: AsyncSession) -> int:
    try:
        from src.security.features_utils.usage import _get_actual_admin_seat_count

        return int(await _get_actual_admin_seat_count(org_id, db))
    except Exception:
        logger.debug("instructor seat count failed", exc_info=True)
        return 0


async def _compute_entitlements(org_id: int, db: AsyncSession) -> Entitlements:
    from src.services.demo.guards import is_demo_org

    config = await _load_org_config(org_id, db)
    plan = _plan_from_config(config)
    catalog_version, catalog = await get_active_catalog(db)
    plans = catalog.get("plans") or {}

    account = await db.get(BillingAccount, org_id)
    # An unpaid invoice past its grace pauses paid features: the org runs on
    # Starter limits until it pays. Paid-for packs stay usable and nothing is
    # deleted; paying restores the plan at once.
    paused = (
        account is not None
        and account.status == "paused"
        and override_until(account) is None
    )
    if paused:
        plan = DEFAULT_PLAN

    plan_cfg: dict = plans.get(plan) or plans.get(DEFAULT_PLAN) or {}
    plan_features: dict = dict(plan_cfg.get("features") or {})

    # Active add-ons
    now = utcnow()
    addons: dict[str, int] = {}
    for addon in (
        await db.execute(select(OrgAddon).where(OrgAddon.org_id == org_id))
    ).scalars().all() if not paused else ():
        started = _aware(addon.started_at)
        ends = _aware(addon.ends_at)
        if started is not None and started > now:
            continue
        if ends is not None and ends <= now:
            continue
        addons[addon.addon] = addons.get(addon.addon, 0) + max(int(addon.quantity or 0), 0)

    # Pack balances
    packs: dict[str, int] = {}
    for pack in (
        await db.execute(select(PackBalance).where(PackBalance.org_id == org_id))
    ).scalars().all():
        packs[pack.kind] = packs.get(pack.kind, 0) + max(int(pack.remaining or 0), 0)

    exempt = bool(account.exempt) if account is not None else False
    if not exempt and await is_demo_org(org_id, db):
        exempt = True

    # Seats
    included = plan_cfg.get("included_seats")
    extra_seats = addons.get("extra_seat", 0)
    seats: int | None = None if included is None else int(included) + extra_seats

    # Learners
    per_seat = int(plan_cfg.get("learners_per_seat") or catalog.get("learners_per_seat") or 200)
    fixed_learners = plan_cfg.get("learner_allowance")
    learner_allowance: int | None
    if fixed_learners is not None:
        learner_allowance = int(fixed_learners) + extra_seats * per_seat
    elif seats is not None:
        learner_allowance = seats * per_seat
    elif plan_cfg.get("price_cents", 0) is None:
        # Enterprise: agreed per contract (override), otherwise unlimited.
        learner_allowance = None
    else:
        # Unlimited seats (Public Education): 200 per instructor actually held.
        learner_allowance = max(await _count_instructor_seats(org_id, db), 1) * per_seat

    # Features (+ add-ons + force_enabled overrides)
    features = {k: bool(v) for k, v in plan_features.items()}
    if addons.get("remove_badge", 0) > 0:
        features["remove_badge"] = True
    if addons.get("managed_email", 0) > 0:
        features["managed_email"] = True
    if addons.get("sso", 0) > 0:
        features["sso"] = True
    overrides = _overrides(config)
    for feat in FEATURE_METRICS:
        key = _FEATURE_OVERRIDE_KEYS.get(feat, feat)
        ov = overrides.get(key)
        if isinstance(ov, dict) and ov.get("force_enabled"):
            features[feat] = True
        features.setdefault(feat, False)

    managed_email = features.get("managed_email", False)
    email_addon = (catalog.get("addons") or {}).get("managed_email") or {}
    included_emails = int(email_addon.get("included_emails") or 5000)
    managed_emails_month: int | None = 0
    if managed_email:
        managed_emails_month = included_emails * max(addons.get("managed_email", 0), 1)

    values: dict[str, Any] = {
        "instructor_seats": seats,
        "learner_allowance": learner_allowance,
        "storage_bytes": plan_cfg.get("storage_bytes"),
        "live_seconds_month": plan_cfg.get("live_seconds"),
        "live_concurrency": plan_cfg.get("live_concurrency"),
        "premium_ai_credits_month": plan_cfg.get("premium_ai_credits"),
        "code_runs_month": plan_cfg.get("code_runs"),
        "managed_emails_month": managed_emails_month,
    }
    ent_overrides = overrides.get("entitlements")
    if isinstance(ent_overrides, dict):
        for key, value in ent_overrides.items():
            if key in _OVERRIDABLE_FIELDS:
                values[key] = None if value is None else int(value)
        # Seats overridden without an explicit learner allowance → follow seats.
        if "instructor_seats" in ent_overrides and "learner_allowance" not in ent_overrides:
            s = values["instructor_seats"]
            values["learner_allowance"] = None if s is None else s * per_seat

    return Entitlements(
        org_id=int(org_id),
        plan=plan,
        catalog_version=int(catalog_version),
        live_unlimited_instructors=addons.get("live_unlimited", 0),
        managed_email=managed_email,
        byo_email=bool(features.get("byo_email", True)),
        features=features,
        packs=packs,
        exempt=exempt,
        **values,
    )


async def get_entitlements(
    org_id: int, db: AsyncSession, *, use_cache: bool = True
) -> Entitlements:
    """Resolve the org's entitlements (cached in Redis for 60 s when available)."""
    if use_cache:
        cached = _cache_get(org_id)
        if cached is not None:
            return cached
    ent = await _compute_entitlements(org_id, db)
    if use_cache:
        _cache_set(ent)
    return ent


# ---------------------------------------------------------------------------
# Enforcement mode
# ---------------------------------------------------------------------------

# Metrics enforced unless a flag says otherwise. Instructor seats are counted
# from exact membership rows (no metering drift to shake out in shadow), and a
# seat over the limit is exactly what must prompt the school to pay.
METRIC_DEFAULT_MODES: dict[str, EnforcementMode] = {
    METRIC_INSTRUCTOR_SEATS: "enforce",
}


OVERRIDE_UNTIL_KEY = "_override_until"


def override_until(account: BillingAccount | None) -> datetime | None:
    """End of a superadmin's temporary limits override, if one is active.

    Set when a school has paid but the money hasn't reached us yet: until it
    ends no limit blocks and a paused account keeps its plan. Stored in the
    account's per-org overrides JSON, so it needs no schema change.
    """
    if account is None or not isinstance(account.enforcement_overrides, dict):
        return None
    raw = account.enforcement_overrides.get(OVERRIDE_UNTIL_KEY)
    try:
        until = _aware(datetime.fromisoformat(raw)) if raw else None
    except (TypeError, ValueError):
        return None
    return until if until is not None and until > utcnow() else None


async def get_enforcement_mode(
    metric: str, db: AsyncSession, org_id: int | None = None
) -> EnforcementMode:
    """Per-org override → global flag → per-metric default → env default
    (``shadow``)."""
    if org_id:
        try:
            account = await db.get(BillingAccount, org_id)
        except Exception:
            account = None
        if override_until(account) is not None:
            return "off"
        if account is not None and isinstance(account.enforcement_overrides, dict):
            mode = normalize_enforcement_mode(account.enforcement_overrides.get(metric))
            if mode:
                return mode
    try:
        flag = await db.get(EnforcementFlag, metric)
    except Exception:
        flag = None
    if flag is not None:
        mode = normalize_enforcement_mode(flag.mode)
        if mode:
            return mode
    return METRIC_DEFAULT_MODES.get(metric) or enforcement_default()


# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

async def get_usage(
    org_id: int, metric: str, db: AsyncSession, period: str | None = None
) -> int:
    """Counter value for ``metric`` in ``period`` (default: current month)."""
    period = period or current_period()
    row = (
        await db.execute(
            select(UsageCounter.used).where(
                UsageCounter.org_id == org_id,
                UsageCounter.metric == metric,
                UsageCounter.period == period,
            )
        )
    ).scalars().first()
    return int(row or 0)


async def record_usage(
    org_id: int,
    metric: str,
    amount: int,
    db: AsyncSession,
    *,
    period: str | None = None,
    commit: bool = True,
) -> None:
    """Add ``amount`` to the org's ``usage_counter`` for ``period`` (YYYY-MM,
    default current UTC month). Atomic upsert on Postgres and SQLite."""
    amount = int(amount)
    if amount == 0:
        return
    period = period or current_period()
    now = utcnow()
    table = UsageCounter.__table__
    dialect = db.bind.dialect.name if db.bind is not None else ""
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as dialect_insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert as dialect_insert
    else:  # pragma: no cover - only Postgres and SQLite are used
        dialect_insert = None

    if dialect_insert is not None:
        stmt = dialect_insert(table).values(
            org_id=org_id, metric=metric, period=period, used=amount, updated_at=now
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["org_id", "metric", "period"],
            set_={"used": table.c.used + amount, "updated_at": now},
        )
        await db.execute(stmt)
    else:  # pragma: no cover
        existing = (
            await db.execute(
                select(UsageCounter).where(
                    UsageCounter.org_id == org_id,
                    UsageCounter.metric == metric,
                    UsageCounter.period == period,
                )
            )
        ).scalars().first()
        if existing is None:
            db.add(UsageCounter(org_id=org_id, metric=metric, period=period, used=amount))
        else:
            existing.used = int(existing.used) + amount
            existing.updated_at = now
            db.add(existing)
    if commit:
        await db.commit()


async def _default_gauge_value(org_id: int, metric: str, db: AsyncSession) -> int:
    if metric == METRIC_STORAGE:
        row = (
            await db.execute(
                select(StorageSnapshot.bytes)
                .where(StorageSnapshot.org_id == org_id)
                .order_by(StorageSnapshot.measured_at.desc())
                .limit(1)
            )
        ).scalars().first()
        return int(row or 0)
    if metric == METRIC_INSTRUCTOR_SEATS:
        return await _count_instructor_seats(org_id, db)
    if metric == METRIC_LEARNERS:
        try:
            from src.security.features_utils.active_users import count_active_users

            now = utcnow()
            return int(await count_active_users(org_id, now.year, now.month, db))
        except Exception:
            logger.debug("active learner count failed", exc_info=True)
            return 0
    return 0


def _limit_for(ent: Entitlements, metric: str) -> int | None:
    """Effective limit (None = unlimited). Monthly metrics include packs."""
    if metric == METRIC_INSTRUCTOR_SEATS:
        return ent.instructor_seats
    if metric == METRIC_LEARNERS:
        return ent.learner_allowance
    if metric == METRIC_STORAGE:
        return ent.storage_bytes
    if metric == METRIC_LIVE_CONCURRENCY:
        return ent.live_concurrency
    if metric == METRIC_MANAGED_EMAILS:
        return ent.managed_emails_month
    allowance = {
        METRIC_LIVE_SECONDS: ent.live_seconds_month,
        METRIC_PREMIUM_AI_CREDITS: ent.premium_ai_credits_month,
        METRIC_CODE_RUNS: ent.code_runs_month,
    }[metric]
    if allowance is None:
        return None
    pack_kind = MONTHLY_METRICS.get(metric)
    return int(allowance) + (ent.packs.get(pack_kind, 0) if pack_kind else 0)


async def check(
    org_id: int,
    metric: str,
    amount: int,
    db: AsyncSession,
    *,
    used: int | None = None,
) -> Decision:
    """Would using ``amount`` more of ``metric`` stay within the entitlement?

    * ``allowed``        — within the limit, unlimited, exempt, or mode ``off``.
    * ``shadow_blocked`` — over the limit but mode is ``shadow``: logged, allowed.
    * ``blocked``        — over the limit and mode is ``enforce``: refuse with
      ``decision.raise_if_blocked()``.

    Monthly metrics read ``usage_counter``; gauge metrics (seats, learners,
    storage, live concurrency) use ``used`` when given, else a default source.
    Feature metrics (``sso``, ``api``, …) ignore ``amount``.
    """
    if metric not in ALL_METRICS:
        raise ValueError(f"Unknown entitlement metric: {metric}")
    amount = int(amount)

    # Plan limits are a hosted-service concept: a self-hosted (ee/oss) install
    # is unlimited, except the cost-gated features that stay plan-bound in
    # every mode (SSO is Enterprise-only everywhere).
    from src.core.deployment_mode import get_deployment_mode
    from src.security.features_utils.plans import COST_GATED_FEATURES

    if get_deployment_mode() != "saas" and metric not in COST_GATED_FEATURES:
        return Decision("allowed", metric, amount, used, None, "off", reason="not_saas")

    mode = await get_enforcement_mode(metric, db, org_id)
    if mode == "off":
        return Decision("allowed", metric, amount, used, None, mode, reason="off")

    ent = await get_entitlements(org_id, db)
    if ent.exempt:
        return Decision("allowed", metric, amount, used, None, mode, reason="exempt")

    if metric in FEATURE_METRICS:
        enabled = bool(ent.features.get(metric, False))
        if enabled:
            return Decision("allowed", metric, amount, None, 1, mode, reason="within_limit")
        code = (
            limit_errors.EMAIL_NOT_ENABLED
            if metric == "managed_email"
            else limit_errors.FEATURE_NOT_IN_PLAN
        )
        return _over(org_id, metric, amount, None, 0, mode, code, reason="not_in_plan")

    limit = _limit_for(ent, metric)
    if limit is None:
        return Decision("allowed", metric, amount, used, None, mode, reason="unlimited")

    if used is None:
        if metric in MONTHLY_METRICS:
            used = await get_usage(org_id, metric, db)
        else:
            used = await _default_gauge_value(org_id, metric, db)

    if used + amount <= limit:
        return Decision("allowed", metric, amount, used, limit, mode, reason="within_limit")
    return _over(org_id, metric, amount, used, limit, mode, METRIC_ERROR_CODES[metric])


def _over(
    org_id: int,
    metric: str,
    amount: int,
    used: int | None,
    limit: int | None,
    mode: EnforcementMode,
    error_code: str,
    reason: str = "over_limit",
) -> Decision:
    outcome: Outcome = "blocked" if mode == "enforce" else "shadow_blocked"
    log = logger.warning if outcome == "blocked" else logger.info
    log(
        "entitlement %s org=%s metric=%s used=%s amount=%s limit=%s code=%s",
        outcome, org_id, metric, used, amount, limit, error_code,
    )
    return Decision(outcome, metric, amount, used, limit, mode, error_code, reason)


__all__ = [
    "ALL_METRICS",
    "FEATURE_METRICS",
    "GAUGE_METRICS",
    "METRIC_CODE_RUNS",
    "METRIC_ERROR_CODES",
    "METRIC_INSTRUCTOR_SEATS",
    "METRIC_LEARNERS",
    "METRIC_LIVE_CONCURRENCY",
    "METRIC_LIVE_SECONDS",
    "METRIC_MANAGED_EMAILS",
    "METRIC_PREMIUM_AI_CREDITS",
    "METRIC_STORAGE",
    "MONTHLY_METRICS",
    "Decision",
    "Entitlements",
    "check",
    "get_active_catalog",
    "get_enforcement_mode",
    "get_entitlements",
    "get_usage",
    "invalidate_entitlements",
    "record_usage",
]
