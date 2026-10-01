import logging
from datetime import datetime, timedelta, timezone
from src.db.organization_config import OrganizationConfig
from src.db.billing_usage import UsageEvent
from src.db.user_organizations import UserOrganization
from src.db.courses.courses import Course
from src.db.roles import Role, RoleTypeEnum
from src.db.usergroups import UserGroup
from src.db.podcasts.podcasts import Podcast
from src.db.courses.assignments import Assignment
from sqlalchemy import or_
from src.core.deployment_mode import get_deployment_mode
from src.core.redis import get_redis_client as _get_redis_pool_client
from typing import Literal, Optional, TypeAlias
from fastapi import HTTPException
from sqlmodel import select, func
from sqlmodel.ext.asyncio.session import AsyncSession
from src.security.features_utils.plans import (
    DEFAULT_PLAN,
    PlanLevel,
    is_paying_plan,
    normalize_plan,
    get_plan_limit,
    get_ai_credit_limit,
    plan_meets_requirement,
    get_required_plan_for_feature,
)

logger = logging.getLogger(__name__)

FeatureSet: TypeAlias = Literal[
    "admin_seats",
    "ai",
    "analytics",
    "api",
    "assignments",
    "collaboration",
    "courses",
    "members",
    "payments",
    "podcasts",
    "usergroups",
]

# Features that use plan-based limits (tracked via events in PostgreSQL)
PLAN_BASED_FEATURES = {"courses", "members", "admin_seats"}

# Features that use Redis for usage tracking (non-billing, rate limiting)
REDIS_TRACKED_FEATURES = {"ai", "analytics", "api", "assignments", "collaboration",
                          "payments", "podcasts", "usergroups"}

# Count-limited features whose usage is enforced by counting ACTUAL DB rows
# rather than a mutable Redis counter. Counting rows makes enforcement
# self-healing: the Redis usage counter could drift or be lost (it is an
# ephemeral cache), which silently disabled these limits — e.g. a free org
# could exceed its 5-assignment cap once the counter was gone. usergroups,
# podcasts and assignments are all org-scoped DB entities, so their live count
# is authoritative. (usergroups/podcasts are also disabled on the free plan, so
# they are additionally gated by the enabled check.)
DB_COUNTED_FEATURES = PLAN_BASED_FEATURES | {"usergroups", "podcasts", "assignments"}


def _is_non_saas() -> bool:
    """Check if deployment is in a non-SaaS mode (EE or OSS) — disables plan-based limits."""
    return get_deployment_mode() != 'saas'


def _get_redis_client():
    """Get a Redis client from the shared pool. Raises HTTP 500 if unavailable."""
    r = _get_redis_pool_client()
    if r is None:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )
    return r


def _plan_from_config_dict(config: dict) -> PlanLevel:
    """Read the plan out of a raw org config dict (supports v1 and v2 layout)."""
    config = config or {}
    version = str(config.get("config_version", "1.0"))
    if version.startswith("2"):
        return normalize_plan(config.get("plan", DEFAULT_PLAN))  # type: ignore[return-value]
    return normalize_plan(config.get("cloud", {}).get("plan", DEFAULT_PLAN))  # type: ignore[return-value]


def _get_org_plan(org_config: OrganizationConfig) -> PlanLevel:
    """Get the organization's current plan (supports v1 and v2 config)."""
    return _plan_from_config_dict(org_config.config or {})


# ============================================================================
# Actual Usage Counts (from database)
# ============================================================================

async def _get_actual_member_count(org_id: int, db_session: AsyncSession) -> int:
    """Get actual member count from database."""
    statement = select(func.count()).where(UserOrganization.org_id == org_id)
    return (await db_session.execute(statement)).scalar_one()


async def _get_actual_course_count(org_id: int, db_session: AsyncSession) -> int:
    """Get actual course count from database."""
    statement = select(func.count()).where(Course.org_id == org_id)
    return (await db_session.execute(statement)).scalar_one()


async def _get_actual_admin_seat_count(org_id: int, db_session: AsyncSession) -> int:
    """
    Get count of users with dashboard access (admin seats).
    Admin seat = user with a role that has dashboard.action_access = true
    """
    # Get all roles that could apply: org-specific roles AND global default roles
    statement = select(Role).where(
        or_(
            Role.org_id == org_id,
            Role.role_type == RoleTypeEnum.TYPE_GLOBAL,
        )
    )
    roles = (await db_session.execute(statement)).scalars().all()

    # Find role IDs with dashboard access
    admin_role_ids = []
    for role in roles:
        rights = role.rights
        if isinstance(rights, dict):
            dashboard = rights.get("dashboard", {})
            if dashboard.get("action_access", False):
                admin_role_ids.append(role.id)

    if not admin_role_ids:
        return 0

    # Count users with these roles
    statement = select(func.count()).where(
        UserOrganization.org_id == org_id,
        UserOrganization.role_id.in_(admin_role_ids)
    )
    return (await db_session.execute(statement)).scalar_one()


async def _get_actual_usergroup_count(org_id: int, db_session: AsyncSession) -> int:
    """Get actual usergroup count from the database."""
    statement = select(func.count()).where(UserGroup.org_id == org_id)
    return (await db_session.execute(statement)).scalar_one()


async def _get_actual_podcast_count(org_id: int, db_session: AsyncSession) -> int:
    """Get actual podcast count from the database."""
    statement = select(func.count()).where(Podcast.org_id == org_id)
    return (await db_session.execute(statement)).scalar_one()


async def _get_actual_assignment_count(org_id: int, db_session: AsyncSession) -> int:
    """Get actual assignment count from the database."""
    statement = select(func.count()).where(Assignment.org_id == org_id)
    return (await db_session.execute(statement)).scalar_one()


async def _get_actual_usage(feature: str, org_id: int, db_session: AsyncSession) -> int:
    """Get actual usage count from the database for DB-counted features."""
    if feature == "members":
        return await _get_actual_member_count(org_id, db_session)
    elif feature == "courses":
        return await _get_actual_course_count(org_id, db_session)
    elif feature == "admin_seats":
        return await _get_actual_admin_seat_count(org_id, db_session)
    elif feature == "usergroups":
        return await _get_actual_usergroup_count(org_id, db_session)
    elif feature == "podcasts":
        return await _get_actual_podcast_count(org_id, db_session)
    elif feature == "assignments":
        return await _get_actual_assignment_count(org_id, db_session)
    return 0


# ============================================================================
# Event-Based Usage Tracking (PostgreSQL)
# ============================================================================

def _invalidate_usage_cache(org_id: int) -> None:
    """Invalidate the usage cache for an organization."""
    try:
        r = _get_redis_client()
        r.delete(f"org_usage:{org_id}")
    except Exception:
        pass


async def log_usage_event(
    org_id: int,
    feature: str,
    event_type: Literal["add", "remove"],
    db_session: AsyncSession,
):
    """
    Log a usage event for billing tracking.
    Called when a member/course is added or removed.
    """
    if feature not in PLAN_BASED_FEATURES:
        return

    # UsageEvent is the billing ledger that get_peak_usage and
    # calculate_billable_overage read. The demo generator never calls this, but
    # the demo creates and destroys members and courses on every refresh, so a
    # future caller wiring usage logging into a path the refresh touches would
    # quietly start billing against synthetic churn. Cheaper to make that
    # impossible here than to re-audit every call site later.
    from src.services.demo.guards import is_demo_org

    if await is_demo_org(org_id, db_session):
        return

    # Get current actual count
    usage_after = await _get_actual_usage(feature, org_id, db_session)

    event = UsageEvent(
        org_id=org_id,
        feature=feature,
        event_type=event_type,
        timestamp=datetime.now(),
        usage_after=usage_after,
    )
    db_session.add(event)
    await db_session.commit()

    # Invalidate usage cache
    _invalidate_usage_cache(org_id)


# ============================================================================
# Main Usage Check Functions
# ============================================================================

async def _get_org_config(org_id: int, db_session: AsyncSession) -> Optional[OrganizationConfig]:
    """Return OrganizationConfig with a Redis read-aside cache."""
    from src.services.orgs.cache import get_cached_org_config, set_cached_org_config

    raw = get_cached_org_config(org_id)
    if raw is not None:
        try:
            return OrganizationConfig(**raw)
        except Exception:
            pass

    stmt = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = (await db_session.execute(stmt)).scalar_one_or_none()

    if org_config is not None:
        try:
            set_cached_org_config(org_id, org_config.model_dump(mode="json"))
        except Exception:
            pass

    return org_config


async def check_feature_enabled(
    feature: FeatureSet,
    org_id: int,
    db_session: AsyncSession,
) -> bool:
    """
    Check if a feature is enabled for an organization.

    Uses resolve_feature() for v2 configs, falls back to plan-based check for v1.

    Returns:
        True if the feature is enabled

    Raises:
        HTTPException 403 if feature is disabled
    """
    from src.security.features_utils.resolve import resolve_feature

    org_config = await _get_org_config(org_id, db_session)

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization has no config",
        )

    resolved = resolve_feature(feature, org_config.config or {}, org_id)

    if not resolved["enabled"]:
        raise HTTPException(
            status_code=403,
            detail=f"{feature.capitalize()} is not enabled for this organization",
        )

    return True


async def check_limits_with_usage(
    feature: FeatureSet,
    org_id: int,
    db_session: AsyncSession,
):
    """Check if usage is within limits for a feature.
    Uses resolve_feature() for unified 4-layer resolution."""
    from src.security.features_utils.resolve import resolve_feature

    org_config = await _get_org_config(org_id, db_session)

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization has no config",
        )

    resolved = resolve_feature(feature, org_config.config or {}, org_id)

    # Check if the feature is enabled
    if not resolved["enabled"]:
        raise HTTPException(
            status_code=403,
            detail=f"{feature.capitalize()} is not enabled for this organization",
        )

    # A new member is a new learner: the active-learner allowance (with its
    # grace period) is the real membership limit on the current plans.
    if feature == "members":
        await enforce_learner_allowance(org_id, 1, db_session)

    # Unlimited (limit=0) — no usage check needed
    if resolved["limit"] == 0:
        return True

    org_plan = _get_org_plan(org_config)
    feature_limit = resolved["limit"]

    # DB-counted features — enforce against the live row count so the limit
    # cannot be bypassed by a drifted/lost Redis usage counter.
    if feature in DB_COUNTED_FEATURES:
        current_usage = await _get_actual_usage(feature, org_id, db_session)

        if current_usage >= feature_limit:
            # For paid plans, allow overage (tracked via events for billing)
            if is_paying_plan(org_plan):
                return True
            else:
                raise HTTPException(
                    status_code=403,
                    detail=f"Usage Limit has been reached for {feature.capitalize()}",
                )
        return True

    # Redis-tracked features
    if feature_limit > 0:
        r = _get_redis_client()
        feature_usage = r.get(f"{feature}_usage:{org_id}")

        if feature_usage is None:
            feature_usage_count = 0
        else:
            feature_usage_count = int(feature_usage)

        if feature_limit <= feature_usage_count:
            raise HTTPException(
                status_code=403,
                detail=f"Usage Limit has been reached for {feature.capitalize()}",
            )
    return True


async def check_members_limit_with_pending(
    org_id: int,
    pending_and_new: int,
    db_session: AsyncSession,
):
    """Enforce the members limit counting BOTH joined members and pending/new
    invites.

    ``check_limits_with_usage("members", ...)`` only counts users who have
    already joined, so a free org at (or near) its cap could still queue an
    unbounded number of pending invitations. This folds ``pending_and_new``
    (existing pending invites + the new ones about to be sent) into the count.

    No-op when the members feature is unlimited (limit 0) or the org is on a
    paid plan (paid plans allow tracked overage).
    """
    from src.security.features_utils.resolve import resolve_feature

    org_config = await _get_org_config(org_id, db_session)
    if org_config is None:
        raise HTTPException(status_code=404, detail="Organization has no config")

    resolved = resolve_feature("members", org_config.config or {}, org_id)
    if not resolved["enabled"]:
        raise HTTPException(
            status_code=403,
            detail="Members is not enabled for this organization",
        )

    # Invitations are refused only once new learners are actually refused;
    # pending invites that may never be accepted don't spend the allowance.
    await enforce_learner_allowance(org_id, 1, db_session)

    feature_limit = resolved["limit"]
    if feature_limit == 0:  # unlimited
        return True

    if is_paying_plan(_get_org_plan(org_config)):
        return True  # paid: allow overage, billing tracks it

    current = await _get_actual_member_count(org_id, db_session)
    if current + max(pending_and_new, 0) > feature_limit:
        raise HTTPException(
            status_code=403,
            detail="Usage Limit has been reached for Members",
        )
    return True


async def increase_feature_usage(
    feature: FeatureSet,
    org_id: int,
    db_session: AsyncSession,
):
    """Increase usage count for a feature."""
    # Plan-based features - log event
    if feature in PLAN_BASED_FEATURES:
        await log_usage_event(org_id, feature, "add", db_session)
        return True

    # Redis-tracked features
    r = _get_redis_client()
    feature_usage = r.get(f"{feature}_usage:{org_id}")

    if feature_usage is None:
        feature_usage_count = 0
    else:
        feature_usage_count = int(feature_usage)

    r.set(f"{feature}_usage:{org_id}", feature_usage_count + 1)
    return True


async def decrease_feature_usage(
    feature: FeatureSet,
    org_id: int,
    db_session: AsyncSession,
):
    """Decrease usage count for a feature."""
    # Plan-based features - log event
    if feature in PLAN_BASED_FEATURES:
        await log_usage_event(org_id, feature, "remove", db_session)
        return True

    # Redis-tracked features
    r = _get_redis_client()
    feature_usage = r.get(f"{feature}_usage:{org_id}")

    if feature_usage is None:
        feature_usage_count = 0
    else:
        feature_usage_count = int(feature_usage)

    r.set(f"{feature}_usage:{org_id}", max(0, feature_usage_count - 1))
    return True


# ============================================================================
# Feature Access Check (Plan-Based Features)
# ============================================================================

async def check_feature_access(
    feature: str,
    org_id: int,
    db_session: AsyncSession,
) -> bool:
    """
    Check if a feature is accessible based on plan level or OSS mode.

    For features that require a minimum plan level (e.g., api_tokens requires 'growth'),
    this function checks:
    1. If OSS mode is enabled → allow access
    2. If the organization's plan meets the required level → allow access
    3. Otherwise → deny access with 403

    Args:
        feature: The feature key (e.g., 'versioning', 'ai')
        org_id: The organization ID
        db_session: Database session

    Returns:
        True if access is allowed

    Raises:
        HTTPException 403 if access is denied
    """
    # OSS mode enables all features
    if _is_non_saas():
        return True

    # Get required plan for this feature
    required_plan = get_required_plan_for_feature(feature)

    # If no plan requirement, allow access
    if required_plan is None:
        return True

    org_config = await _get_org_config(org_id, db_session)

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization has no config",
        )

    org_plan = _get_org_plan(org_config)

    # Check if plan meets requirement
    if not plan_meets_requirement(org_plan, required_plan):
        raise HTTPException(
            status_code=403,
            detail=f"{feature.capitalize()} requires {required_plan} plan or higher. Current plan: {org_plan}",
        )

    return True


# ============================================================================
# Billing Calculation Functions (from events)
# ============================================================================

async def get_usage_at_timestamp(
    org_id: int,
    feature: str,
    timestamp: datetime,
    db_session: AsyncSession,
) -> int:
    """Get usage count at a specific point in time."""
    statement = (
        select(UsageEvent)
        .where(
            UsageEvent.org_id == org_id,
            UsageEvent.feature == feature,
            UsageEvent.timestamp <= timestamp,
        )
        .order_by(UsageEvent.timestamp.desc())
        .limit(1)
    )
    event = (await db_session.execute(statement)).scalars().first()
    return event.usage_after if event else 0


async def get_peak_usage(
    org_id: int,
    feature: str,
    start_date: datetime,
    end_date: datetime,
    db_session: AsyncSession,
) -> int:
    """Get peak (maximum) usage during a date range."""
    statement = (
        select(func.max(UsageEvent.usage_after))
        .where(
            UsageEvent.org_id == org_id,
            UsageEvent.feature == feature,
            UsageEvent.timestamp >= start_date,
            UsageEvent.timestamp <= end_date,
        )
    )
    peak = (await db_session.execute(statement)).scalars().first()

    if peak is None:
        # No events in range - get usage at start of range
        return await get_usage_at_timestamp(org_id, feature, start_date, db_session)

    return peak


async def get_usage_events(
    org_id: int,
    feature: str,
    start_date: datetime,
    end_date: datetime,
    db_session: AsyncSession,
) -> list[UsageEvent]:
    """Get all usage events in a date range."""
    statement = (
        select(UsageEvent)
        .where(
            UsageEvent.org_id == org_id,
            UsageEvent.feature == feature,
            UsageEvent.timestamp >= start_date,
            UsageEvent.timestamp <= end_date,
        )
        .order_by(UsageEvent.timestamp)
    )
    return list((await db_session.execute(statement)).scalars().all())


async def calculate_weighted_average_usage(
    org_id: int,
    feature: str,
    start_date: datetime,
    end_date: datetime,
    db_session: AsyncSession,
) -> float:
    """
    Calculate time-weighted average usage over a period.
    This is the fairest billing method for mid-period starts.
    """
    events = await get_usage_events(org_id, feature, start_date, end_date, db_session)

    # Get initial usage at start of period
    initial_usage = await get_usage_at_timestamp(org_id, feature, start_date, db_session)

    if not events:
        # No changes during period - usage was constant
        return float(initial_usage)

    total_seconds = (end_date - start_date).total_seconds()
    if total_seconds <= 0:
        return float(initial_usage)

    weighted_sum = 0.0
    current_usage = initial_usage
    current_time = start_date

    for event in events:
        # Add weighted contribution for time at current usage level
        duration = (event.timestamp - current_time).total_seconds()
        weighted_sum += current_usage * duration

        # Update to new usage level
        current_usage = event.usage_after
        current_time = event.timestamp

    # Add final segment from last event to end of period
    duration = (end_date - current_time).total_seconds()
    weighted_sum += current_usage * duration

    return weighted_sum / total_seconds


async def calculate_billable_overage(
    org_id: int,
    feature: str,
    start_date: datetime,
    end_date: datetime,
    plan_limit: int,
    db_session: AsyncSession,
    method: Literal["peak", "average"] = "peak",
) -> dict:
    """
    Calculate billable overage for a period.

    Args:
        org_id: Organization ID
        feature: Feature name (members, courses)
        start_date: Billing period start
        end_date: Billing period end
        plan_limit: Plan limit for the feature (0 = unlimited)
        method: "peak" for max usage, "average" for weighted average

    Returns:
        Dict with usage details and overage
    """
    if plan_limit == 0:  # Unlimited
        return {
            "feature": feature,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "limit": "unlimited",
            "usage": 0,
            "overage": 0,
            "method": method,
        }

    if method == "peak":
        usage = await get_peak_usage(org_id, feature, start_date, end_date, db_session)
    else:
        usage = await calculate_weighted_average_usage(
            org_id, feature, start_date, end_date, db_session
        )

    overage = max(0, usage - plan_limit) if plan_limit > 0 else 0

    return {
        "feature": feature,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "limit": plan_limit,
        "usage": round(usage, 2) if isinstance(usage, float) else usage,
        "overage": round(overage, 2) if isinstance(overage, float) else overage,
        "method": method,
    }


async def get_billing_summary(
    org_id: int,
    start_date: datetime,
    end_date: datetime,
    db_session: AsyncSession,
    method: Literal["peak", "average"] = "peak",
) -> dict:
    """
    Get complete billing summary for an organization for a period.
    """
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = (await db_session.execute(statement)).scalars().first()

    if org_config is None:
        return {"error": "Organization has no config"}

    org_plan = _get_org_plan(org_config)

    summary = {
        "org_id": org_id,
        "plan": org_plan,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "method": method,
        "features": {},
    }

    for feature in PLAN_BASED_FEATURES:
        plan_limit = get_plan_limit(org_plan, feature)
        feature_billing = await calculate_billable_overage(
            org_id, feature, start_date, end_date, plan_limit, db_session, method
        )
        summary["features"][feature] = feature_billing

    return summary


async def get_all_orgs_with_overage(
    start_date: datetime,
    end_date: datetime,
    db_session: AsyncSession,
    method: Literal["peak", "average"] = "peak",
) -> list[dict]:
    """
    Get all organizations with overage for batch billing.
    """
    # Get all orgs that have events in this period
    statement = (
        select(UsageEvent.org_id)
        .where(
            UsageEvent.timestamp >= start_date,
            UsageEvent.timestamp <= end_date,
        )
        .distinct()
    )
    org_ids = (await db_session.execute(statement)).scalars().all()

    results = []
    for org_id in org_ids:
        summary = await get_billing_summary(org_id, start_date, end_date, db_session, method)

        # Check if any feature has overage
        has_overage = any(
            f.get("overage", 0) > 0
            for f in summary.get("features", {}).values()
        )

        if has_overage:
            results.append(summary)

    return results


# ============================================================================
# Admin Seat Management
# ============================================================================

async def _auto_add_seats(org_id: int, seats: int) -> bool:
    """Buy ``seats`` extra-seat add-ons when the school opted into auto-add
    seats and has a saved card (pricechange.md §4). Runs in its own session so
    a charge never commits half of the caller's role change. True if bought."""
    from src.core.billing_flags import billing_enabled

    if seats <= 0 or not billing_enabled():
        return False
    try:
        from src.core.events.database import _async_session_factory
        from src.db.billing import BillingAccount
        from src.services.billing import engine

        async with _async_session_factory() as session:
            account = await session.get(BillingAccount, org_id)
            if account is None or not account.auto_add_seats:
                return False
            card = await engine.default_card(org_id, session)
            email = account.billing_email
            if card is None or not email:
                return False
            result = await engine.purchase_with_card(
                org_id,
                {"type": "addon", "addon": "extra_seat", "quantity": seats},
                payment_method_id=card.id,
                user_id=0,
                email=email,
                idempotency_key=None,
                db=session,
            )
            return result.get("status") == "paid"
    except HTTPException:
        return False  # e.g. spending limit reached: fall through to the 402
    except Exception:
        logger.warning("Auto-add seats failed for org %s", org_id, exc_info=True)
        return False


async def _enforce_instructor_seats(
    org_id: int,
    new_seats: int,
    db_session: AsyncSession,
) -> None:
    """Refuse ``new_seats`` more instructor seats beyond what the org holds.

    An instructor seat is any role with dashboard access (Admin, Maintainer,
    Instructor or a custom role that grants it). The allowance is the plan's
    included seats plus purchased extra seats (entitlements.py). Over it, the
    school is asked to pay: HTTP 402 ``seat_limit_reached`` offering an extra
    seat where the plan sells them, else an upgrade — unless auto-add seats
    buys them on the saved card.
    """
    if new_seats <= 0 or _is_non_saas():
        return
    from src.security.features_utils import limit_errors
    from src.security.features_utils.entitlements import (
        METRIC_INSTRUCTOR_SEATS,
        check,
        get_entitlements,
    )

    current = await _get_actual_admin_seat_count(org_id, db_session)
    decision = await check(
        org_id, METRIC_INSTRUCTOR_SEATS, new_seats, db_session, used=current
    )
    if decision.outcome != "blocked":
        return
    shortfall = current + new_seats - int(decision.limit or 0)
    if await _auto_add_seats(org_id, shortfall):
        return

    ent = await get_entitlements(org_id, db_session, use_cache=False)
    from src.services.billing.catalog_defaults import build_default_catalog
    from src.security.features_utils.entitlements import get_active_catalog

    try:
        _, catalog = await get_active_catalog(db_session)
    except Exception:
        catalog = build_default_catalog()
    sells_seats = bool(
        ((catalog.get("addons") or {}).get("extra_seat") or {})
        .get("price_cents_by_plan", {})
        .get(ent.plan)
    )
    options = ["add_seat", "upgrade"] if sells_seats else ["upgrade"]
    message = (
        f"All {decision.limit} instructor seat(s) on your plan are in use. "
        + ("Add a seat or upgrade to continue." if sells_seats else "Upgrade to add instructors.")
    )
    raise limit_errors.limit_error(
        limit_errors.SEAT_LIMIT_REACHED,
        metric=METRIC_INSTRUCTOR_SEATS,
        used=current,
        limit=decision.limit,
        options=options,
        message=message,
    )


LEARNER_GRACE = timedelta(days=7)


async def _learner_grace_started(org_id: int, db_session: AsyncSession, *, over: bool):
    """Start (or read) the org's learner grace clock; clear it when back under.

    Kept on the org's ``billing_subscription`` row (created on first need).
    Commits: callers run this before staging their own membership changes.
    """
    from src.db.billing import BillingSubscription
    from src.db.billing._common import utcnow

    sub = await db_session.get(BillingSubscription, org_id)
    if not over:
        if sub is not None and sub.learner_grace_started_at is not None:
            sub.learner_grace_started_at = None
            db_session.add(sub)
            await db_session.commit()
        return None
    if sub is None:
        org_config = await _get_org_config(org_id, db_session)
        plan = _get_org_plan(org_config) if org_config is not None else DEFAULT_PLAN
        sub = BillingSubscription(org_id=org_id, plan=plan)
    if sub.learner_grace_started_at is None:
        sub.learner_grace_started_at = utcnow()
        db_session.add(sub)
        await db_session.commit()
    started = sub.learner_grace_started_at
    return started if started.tzinfo else started.replace(tzinfo=timezone.utc)


async def enforce_learner_allowance(
    org_id: int,
    new_learners: int,
    db_session: AsyncSession,
) -> None:
    """Let ``new_learners`` join unless the active-learner allowance is spent.

    pricechange.md §4: an org over its allowance (200 active learners per
    instructor seat; Starter 50) keeps admitting new learners for a 7-day
    grace, then new learners are refused with a 402 until a seat is added
    (bought automatically when auto-add seats is on). People already in the
    org are never affected.
    """
    if new_learners <= 0 or _is_non_saas():
        return
    from src.security.features_utils import limit_errors
    from src.security.features_utils.entitlements import (
        METRIC_LEARNERS,
        check,
        get_entitlements,
    )

    decision = await check(org_id, METRIC_LEARNERS, new_learners, db_session)
    if not decision.over_limit:
        await _learner_grace_started(org_id, db_session, over=False)
        return
    if decision.outcome != "blocked":
        return  # shadow: logged by check()

    started = await _learner_grace_started(org_id, db_session, over=True)
    if started is not None and datetime.now(timezone.utc) - started < LEARNER_GRACE:
        return

    ent = await get_entitlements(org_id, db_session, use_cache=False)
    per_seat = 200
    shortfall = int(decision.used or 0) + new_learners - int(decision.limit or 0)
    if await _auto_add_seats(org_id, max(1, -(-shortfall // per_seat))):
        return
    from src.security.features_utils.entitlements import get_active_catalog

    _, catalog = await get_active_catalog(db_session)
    sells_seats = bool(
        ((catalog.get("addons") or {}).get("extra_seat") or {})
        .get("price_cents_by_plan", {})
        .get(ent.plan)
    )
    raise limit_errors.limit_error(
        limit_errors.LEARNER_ALLOWANCE_EXCEEDED,
        metric=METRIC_LEARNERS,
        used=decision.used,
        limit=decision.limit,
        options=["add_seat", "upgrade"] if sells_seats else ["upgrade"],
    )


async def check_admin_seat_limit(
    org_id: int,
    db_session: AsyncSession,
) -> bool:
    """Refuse one more instructor seat when the org has none free.

    Call before granting a role with dashboard access. Returns True when
    allowed; raises the §4.4 402 ``seat_limit_reached`` otherwise. No-op
    outside SaaS mode.
    """
    await _enforce_instructor_seats(org_id, 1, db_session)
    return True


def _role_grants_dashboard_access(role: Optional[Role]) -> bool:
    """True if a role occupies an admin seat (dashboard.action_access == true).

    Mirrors the seat-counting logic in ``_get_actual_admin_seat_count`` so the
    gate and the count agree on what an "admin seat" is. Tolerates ``rights``
    being either a plain dict or a Pydantic model.
    """
    if role is None:
        return False
    rights = role.rights
    if rights is None:
        return False
    if not isinstance(rights, dict):
        try:
            rights = rights.model_dump()
        except Exception:
            return False
    return bool(rights.get("dashboard", {}).get("action_access", False))


async def enforce_admin_seat_limit_for_role_rights_change(
    org_id: int,
    role_id: int,
    will_grant_dashboard: bool,
    currently_grants_dashboard: bool,
    db_session: AsyncSession,
) -> None:
    """Enforce the admin-seat cap when a role's ``dashboard.action_access`` is
    turned ON (false -> true).

    Because seats are derived from role rights, flipping a role that N members
    already hold instantly converts all N into admin seats — a bulk grant that
    the per-assignment gate cannot see. This validates the projected seat total
    (current seats + the holders about to be converted) against the plan limit.
    No-op for non-SaaS, unlimited seats, or a role held by nobody.
    """
    if _is_non_saas():
        return
    if not will_grant_dashboard or currently_grants_dashboard:
        return  # not a false->true transition: no new seats created

    holders = (await db_session.execute(
        select(func.count()).where(
            UserOrganization.org_id == org_id,
            UserOrganization.role_id == role_id,
        )
    )).scalar_one()
    if holders == 0:
        return  # nobody holds this role yet; assignment is gated separately

    # Holders of a non-dashboard role are not counted as seats yet, so every
    # one of them becomes a new seat when the role gains dashboard access.
    await _enforce_instructor_seats(org_id, int(holders), db_session)


async def enforce_admin_seat_limit_for_role_change(
    org_id: int,
    user_id: int,
    new_role: Optional[Role],
    db_session: AsyncSession,
) -> None:
    """Enforce the admin-seat limit when ``user_id`` is being assigned
    ``new_role`` in ``org_id``.

    Only a NET-NEW seat is checked:
    - Granting a non-dashboard role (a demotion, or a normal-member role) never
      raises — you can always remove admins or add regular members.
    - Moving a user who already occupies an admin seat between two
      dashboard-access roles consumes no new seat, so it is not blocked.
    - Granting a dashboard-access role to a user who does not already hold one
      (a promotion, or a brand-new admin membership) is gated by
      ``check_admin_seat_limit`` and raises 403 for a free org at its limit.
    """
    if not _role_grants_dashboard_access(new_role):
        return

    # If the org has no config we cannot resolve its plan/limit; don't block a
    # role change on that misconfiguration (enforcement degrades open, matching
    # the non-SaaS skip inside check_limits_with_usage).
    if await _get_org_config(org_id, db_session) is None:
        return

    # Does the user already occupy an admin seat in this org? If so, swapping
    # admin roles adds no seat.
    current = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.org_id == org_id,
            UserOrganization.user_id == user_id,
        )
    )).scalars().first()
    if current is not None and current.role_id is not None:
        current_role = (await db_session.execute(
            select(Role).where(Role.id == current.role_id)
        )).scalars().first()
        if _role_grants_dashboard_access(current_role):
            return

    await check_admin_seat_limit(org_id, db_session)


async def get_admin_seat_usage(
    org_id: int,
    db_session: AsyncSession,
) -> dict:
    """Get admin seat usage summary."""
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = (await db_session.execute(statement)).scalars().first()

    if org_config is None:
        return {"error": "Organization has no config"}

    org_plan = _get_org_plan(org_config)
    current_usage = await _get_actual_admin_seat_count(org_id, db_session)
    limit = get_plan_limit(org_plan, "admin_seats")

    return {
        "plan": org_plan,
        "current_usage": current_usage,
        "limit": limit if limit > 0 else "unlimited",
        "remaining": (limit - current_usage) if limit > 0 else "unlimited",
    }


def is_role_dashboard_enabled(role: Role) -> bool:
    """Check if a role has dashboard access."""
    rights = role.rights
    if isinstance(rights, dict):
        dashboard = rights.get("dashboard", {})
        return dashboard.get("action_access", False)
    return False


# ============================================================================
# AI Credit Management Functions (Redis)
# ============================================================================

async def check_ai_credits(
    org_id: int,
    db_session: AsyncSession,
) -> bool:
    """Check if the organization has AI credits available."""
    from src.security.features_utils.resolve import resolve_feature

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = (await db_session.execute(statement)).scalars().first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization has no config",
        )

    resolved = resolve_feature("ai", org_config.config or {}, org_id)

    if not resolved["enabled"]:
        raise HTTPException(
            status_code=403,
            detail="AI is not enabled for this organization",
        )

    if _is_non_saas():
        return True

    org_plan = _get_org_plan(org_config)
    r = _get_redis_client()

    base_credits = get_ai_credit_limit(org_plan)

    if base_credits == -1:
        return True

    if base_credits == 0:
        raise HTTPException(
            status_code=403,
            detail="AI credits are not available on this plan. Please upgrade to Growth or Business.",
        )

    # Include override extra_limit
    config = org_config.config or {}
    extra = 0
    if config.get("config_version", "1.0").startswith("2"):
        extra = config.get("overrides", {}).get("ai", {}).get("extra_limit", 0)

    # Batch-fetch both keys in a single round-trip
    purchased_raw, used_raw = r.mget(
        f"ai_credits_purchased:{org_id}",
        f"ai_credits_used:{org_id}",
    )
    used_credits_count, purchased_credits_count, drawn = _ai_month_view(
        r,
        org_id,
        int(used_raw) if used_raw else 0,
        int(purchased_raw) if purchased_raw else 0,
        base_credits,
        extra,
    )
    pack_left, _ = await _ai_billing_state(org_id, db_session)

    total_credits = base_credits + extra + purchased_credits_count + pack_left + drawn

    remaining_credits = total_credits - used_credits_count
    if remaining_credits <= 0:
        raise HTTPException(
            status_code=403,
            detail=f"AI credit limit reached. You have used all {total_credits} credits.",
        )

    return True


def deduct_ai_credit(
    org_id: int,
    db_session: AsyncSession,
    amount: int = 1,
) -> int:
    """Deduct AI credits from the organization.

    Kept for backwards compatibility with call sites that still invoke the
    legacy check+deduct pattern. New code must use :func:`reserve_ai_credit`
    which bundles the check and deduction into a single Redis round-trip so
    that concurrent requests cannot race past the configured limit.
    """
    r = _get_redis_client()
    return r.incrby(f"ai_credits_used:{org_id}", amount)


# Lua script lives at module level so redis-py can cache the SHA.
# KEYS[1] = ai_credits_used:<org>        credits used this month
# KEYS[2] = ai_credits_purchased:<org>   legacy purchased credits (never expire)
# KEYS[3] = ai_credits_period:<org>      the month KEYS[1] counts (YYYY-MM)
# KEYS[4] = ai_credits_pack_drawn:<org>  pack credits drawn this month
# ARGV[1] = base credits, ARGV[2] = extra credits, ARGV[3] = amount,
# ARGV[4] = "1" if unlimited plan (base == -1) else "0",
# ARGV[5] = pack credits left (Postgres pack_balance), ARGV[6] = current month.
#
# Credits are spent in order: the monthly allowance (base + extra), legacy
# purchased credits, then packs bought through billing. The allowance resets
# on the first reservation of a new month (pricechange.md: allowances reset on
# the 1st). At that point the legacy credits used last month are taken off
# the legacy balance, so they never refill.
#
# Returns {new_used, pack_overflow} on success, {-1, 0} when over quota.
# ``pack_overflow`` is how much of this reservation lands past allowance +
# legacy credits and must be drawn from the Postgres pack by the caller.
_ATOMIC_RESERVE_LUA = """
local unlimited = ARGV[4]
local amount = tonumber(ARGV[3])
local base = tonumber(ARGV[1])
local extra = tonumber(ARGV[2])
local period = ARGV[6]
if KEYS[3] and period and period ~= "" then
    local current = redis.call("GET", KEYS[3])
    if current ~= period then
        if current then
            local u = tonumber(redis.call("GET", KEYS[1]) or "0")
            local p = tonumber(redis.call("GET", KEYS[2]) or "0")
            local legacy_used = math.min(math.max(u - base - extra, 0), p)
            if legacy_used > 0 then
                redis.call("SET", KEYS[2], p - legacy_used)
            end
            redis.call("SET", KEYS[1], 0)
            redis.call("SET", KEYS[4], 0)
        end
        redis.call("SET", KEYS[3], period)
    end
end
if unlimited == "1" then
    return {redis.call("INCRBY", KEYS[1], amount), 0}
end
local purchased = tonumber(redis.call("GET", KEYS[2]) or "0")
local pack = tonumber(ARGV[5] or "0")
local drawn = tonumber(redis.call("GET", KEYS[4]) or "0")
local used = tonumber(redis.call("GET", KEYS[1]) or "0")
local cap = base + extra + purchased
if cap + drawn + pack - used < amount then
    return {-1, 0}
end
local new_used = redis.call("INCRBY", KEYS[1], amount)
local overflow = new_used - cap - drawn
if overflow < 0 then overflow = 0 end
if overflow > amount then overflow = amount end
if overflow > 0 then
    redis.call("INCRBY", KEYS[4], overflow)
end
return {new_used, overflow}
"""

# Undo a reservation whose pack draw failed.
_UNRESERVE_LUA = """
local used = tonumber(redis.call("GET", KEYS[1]) or "0") - tonumber(ARGV[1])
if used < 0 then used = 0 end
redis.call("SET", KEYS[1], used)
local drawn = tonumber(redis.call("GET", KEYS[2]) or "0") - tonumber(ARGV[2])
if drawn < 0 then drawn = 0 end
redis.call("SET", KEYS[2], drawn)
return used
"""


def _ai_period() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


def _ai_keys(org_id: int) -> list[str]:
    return [
        f"ai_credits_used:{org_id}",
        f"ai_credits_purchased:{org_id}",
        f"ai_credits_period:{org_id}",
        f"ai_credits_pack_drawn:{org_id}",
    ]


def _billing_session(db_session: AsyncSession):
    """A short session on the caller's engine, so credit bookkeeping commits on
    its own without committing whatever the caller has staged."""
    from sqlalchemy.ext.asyncio import AsyncEngine

    bind = getattr(db_session, "bind", None)
    if not isinstance(bind, AsyncEngine):
        raise TypeError("no async engine behind this session")
    return AsyncSession(bind, expire_on_commit=False)


async def _ai_billing_state(org_id: int, db_session: AsyncSession) -> tuple[int, bool]:
    """(premium-AI pack credits left, billing paused). Postgres is the source
    of truth for packs bought through billing. Unreadable → (0, False): the
    org keeps its allowance, just not the packs, until the store is back."""
    try:
        from src.db.billing import BillingAccount, PackBalance

        async with _billing_session(db_session) as session:
            pack = (
                await session.execute(
                    select(PackBalance.remaining).where(
                        PackBalance.org_id == org_id, PackBalance.kind == "ai_credits"
                    )
                )
            ).scalars().first()
            status = (
                await session.execute(
                    select(BillingAccount.status).where(BillingAccount.org_id == org_id)
                )
            ).scalars().first()
        return max(int(pack or 0), 0), status == "paused"
    except Exception:
        logger.debug("AI pack balance unavailable for org %s", org_id, exc_info=True)
        return 0, False


async def _settle_ai_reservation(
    org_id: int, amount: int, overflow: int, db_session: AsyncSession
) -> bool:
    """Draw ``overflow`` from the org's AI-credit pack and count the rest in the
    usage meter. False when the pack can't cover the overflow (it was spent
    concurrently, or the store is down) — the caller then undoes the
    reservation."""
    try:
        from src.security.features_utils.entitlements import (
            METRIC_PREMIUM_AI_CREDITS,
            record_usage,
        )
        from src.services.billing.metering import draw_pack

        async with _billing_session(db_session) as session:
            drawn = 0
            if overflow > 0:
                drawn = await draw_pack(org_id, "ai_credits", overflow, session)
                if drawn < overflow:
                    await session.rollback()
                    return False
            # Pack-paid credits are not recorded in the meter: entitlements
            # counts them through the pack balance (allowance + packs left).
            await record_usage(org_id, METRIC_PREMIUM_AI_CREDITS, amount - drawn, session, commit=False)
            await session.commit()
        return True
    except Exception:
        if overflow > 0:
            logger.warning("AI pack draw failed for org %s", org_id, exc_info=True)
            return False
        logger.debug("AI usage meter update failed for org %s", org_id, exc_info=True)
        return True


def _premium_exhausted(used: int | None, limit: int | None) -> HTTPException:
    from src.security.features_utils import limit_errors

    if limit == 0:
        message = (
            "Your school has no AI credits. Buy an AI credit pack on the billing page "
            "to use AI features. Genie, the help assistant, stays free."
        )
    elif limit is not None:
        message = f"AI credits used up. You have used all {limit} credits this month."
    else:
        message = "AI credits used up. Buy an AI credit pack or upgrade to continue."
    return limit_errors.limit_error(
        limit_errors.PREMIUM_AI_CREDITS_EXHAUSTED,
        metric="premium_ai_credits",
        used=used,
        limit=limit,
        message=message,
    )


def _redis_text(value) -> str | None:
    if isinstance(value, bytes):
        return value.decode()
    return value if isinstance(value, str) else None


def _ai_month_view(
    r, org_id: int, used: int, purchased: int, base: int, extra: int
) -> tuple[int, int, int]:
    """(used this month, legacy purchased left, pack drawn this month) as the
    reserve script would see them: a month not yet rolled over reads fresh."""
    _, _, period_key, drawn_key = _ai_keys(org_id)
    period = _redis_text(r.get(period_key))
    drawn_text = _redis_text(r.get(drawn_key))
    drawn = int(drawn_text) if drawn_text and drawn_text.lstrip("-").isdigit() else 0
    if period is not None and period != _ai_period():
        legacy_used = min(max(used - max(base, 0) - extra, 0), purchased)
        return 0, purchased - legacy_used, 0
    return used, purchased, drawn


async def _load_org_config_for_ai(org_id: int, db_session: AsyncSession):
    stmt = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    return (await db_session.execute(stmt)).scalars().first()


async def reserve_ai_credit(
    org_id: int,
    db_session: AsyncSession,
    amount: int = 1,
) -> int:
    """
    Atomically verify that the organization has ``amount`` AI credits available
    and decrement the used-counter in a single Redis round-trip. Raises
    ``HTTPException(403)`` matching the historical error shape of
    :func:`check_ai_credits` when the quota would be exceeded, so callers can
    drop the helper in without altering their response contract.

    Returns the new ``ai_credits_used`` count.
    """
    from src.security.features_utils.resolve import resolve_feature

    org_config = await _load_org_config_for_ai(org_id, db_session)
    if org_config is None:
        raise HTTPException(status_code=404, detail="Organization has no config")

    resolved = resolve_feature("ai", org_config.config or {}, org_id)
    if not resolved["enabled"]:
        raise HTTPException(
            status_code=403,
            detail="AI is not enabled for this organization",
        )

    # Non-SaaS deployments do not enforce limits but still track usage.
    if _is_non_saas():
        r = _get_redis_client()
        return int(r.incrby(f"ai_credits_used:{org_id}", amount))

    pack_left, paused = await _ai_billing_state(org_id, db_session)
    # An unpaid invoice past its grace pauses paid features: Starter's
    # allowance applies until the invoice is paid (packs stay usable).
    org_plan = DEFAULT_PLAN if paused else _get_org_plan(org_config)
    base_credits = get_ai_credit_limit(org_plan)

    config = org_config.config or {}
    extra = 0
    if config.get("config_version", "1.0").startswith("2"):
        extra = config.get("overrides", {}).get("ai", {}).get("extra_limit", 0) or 0

    r = _get_redis_client()

    if base_credits == 0:
        # The plan grants no base credits, but the org may still have bought
        # credits (or been granted an override extra_limit). Only reject when
        # there is genuinely no capacity — otherwise a paying customer would be
        # denied credits they already bought.
        purchased = int(r.get(f"ai_credits_purchased:{org_id}") or 0)
        if extra + purchased + pack_left <= 0:
            # Same structured error as running out, so the app offers the
            # AI credit packs instead of a dead end.
            raise _premium_exhausted(0, 0)

    unlimited = "1" if base_credits == -1 else "0"
    keys = _ai_keys(org_id)

    try:
        reserve = r.register_script(_ATOMIC_RESERVE_LUA)
        outcome = reserve(
            keys=keys,
            args=[
                str(max(0, base_credits)),
                str(int(extra)),
                str(int(amount)),
                unlimited,
                str(int(pack_left)),
                _ai_period(),
            ],
        )
    except Exception:
        # Fail closed — prefer quota denial over silent over-use.
        raise HTTPException(
            status_code=503,
            detail="AI credit store temporarily unavailable. Please retry.",
        )

    if isinstance(outcome, (list, tuple)):
        new_used, overflow = int(outcome[0]), int(outcome[1] if len(outcome) > 1 else 0)
    else:
        new_used, overflow = int(outcome), 0

    if new_used == -1:
        purchased = int(r.get(keys[1]) or 0)
        total = (0 if base_credits == -1 else base_credits) + extra + purchased + pack_left
        used_now = int(r.get(keys[0]) or 0)
        raise _premium_exhausted(used_now, total)

    if not await _settle_ai_reservation(org_id, int(amount), overflow, db_session):
        try:
            r.register_script(_UNRESERVE_LUA)(
                keys=[keys[0], keys[3]], args=[str(int(amount)), str(overflow)]
            )
        except Exception:
            logger.error("Could not undo AI reservation for org %s", org_id, exc_info=True)
        raise _premium_exhausted(new_used - int(amount), None)

    return new_used


_REFUND_LUA = """
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local decrement = tonumber(ARGV[1])
local new_val = current - decrement
if new_val < 0 then new_val = 0 end
redis.call("SET", KEYS[1], new_val)
return new_val
"""


def refund_ai_credit(org_id: int, amount: int = 1) -> int:
    """
    Refund ``amount`` previously-reserved AI credits. Callers that use
    :func:`reserve_ai_credit` before dispatching to the model should refund on
    downstream failure so a transient AI outage does not consume the org's
    quota. The decrement is clamped at zero so accidental double-refunds do
    not mint free credits.
    """
    if amount <= 0:
        return 0
    r = _get_redis_client()
    script = r.register_script(_REFUND_LUA)
    return int(script(keys=[f"ai_credits_used:{org_id}"], args=[str(int(amount))]))


def add_ai_credits(org_id: int, amount: int) -> int:
    """Add purchased AI credits to the organization."""
    r = _get_redis_client()
    return r.incrby(f"ai_credits_purchased:{org_id}", amount)


def set_ai_credits(org_id: int, amount: int) -> int:
    """Set purchased AI credits to an absolute value (superadmin-only operation)."""
    r = _get_redis_client()
    r.set(f"ai_credits_purchased:{org_id}", amount)
    return amount


def reset_ai_credits_usage(org_id: int) -> bool:
    """Reset AI credit usage for the organization (for new billing period)."""
    r = _get_redis_client()
    r.set(f"ai_credits_used:{org_id}", 0)
    return True


async def get_ai_credits_summary(org_id: int, db_session: AsyncSession) -> dict:
    """Get a summary of AI credits for an organization.

    Uses a single Redis connection and pipelines the key fetches to minimize
    round-trips (purchased + used credits fetched in one call).
    """
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = (await db_session.execute(statement)).scalars().first()

    if org_config is None:
        return {"error": "Organization has no config"}

    org_plan = _get_org_plan(org_config)

    r = _get_redis_client()

    if _is_non_saas():
        used_credits = r.get(f"ai_credits_used:{org_id}")
        used_credits_count = int(used_credits) if used_credits else 0
        return {
            "plan": org_plan,
            "mode": get_deployment_mode(),
            "base_credits": "unlimited",
            "purchased_credits": 0,
            "total_credits": "unlimited",
            "used_credits": used_credits_count,
            "remaining_credits": "unlimited",
        }

    base_credits = get_ai_credit_limit(org_plan)

    config = org_config.config or {}
    extra = 0
    if config.get("config_version", "1.0").startswith("2"):
        extra = config.get("overrides", {}).get("ai", {}).get("extra_limit", 0) or 0

    # Batch-fetch both keys in a single round-trip
    purchased_raw, used_raw = r.mget(
        f"ai_credits_purchased:{org_id}",
        f"ai_credits_used:{org_id}",
    )
    used_credits_count, purchased_credits_count, drawn = _ai_month_view(
        r,
        org_id,
        int(used_raw) if used_raw else 0,
        int(purchased_raw) if purchased_raw else 0,
        base_credits,
        extra,
    )
    # Packs bought through billing (Postgres) count as purchased credits:
    # what's left, plus what was drawn this month (already in "used").
    pack_left, _ = await _ai_billing_state(org_id, db_session)
    purchased_credits_count += pack_left + drawn

    if base_credits == -1:
        return {
            "plan": org_plan,
            "base_credits": "unlimited",
            "purchased_credits": purchased_credits_count,
            "total_credits": "unlimited",
            "used_credits": used_credits_count,
            "remaining_credits": "unlimited",
        }

    total_credits = base_credits + extra + purchased_credits_count
    remaining_credits = max(0, total_credits - used_credits_count)

    return {
        "plan": org_plan,
        "base_credits": base_credits,
        "purchased_credits": purchased_credits_count,
        "total_credits": total_credits,
        "used_credits": used_credits_count,
        "remaining_credits": remaining_credits,
    }
