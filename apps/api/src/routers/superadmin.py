"""
Platform superadmin API (first-party).

Reimplements the `/api/v1/ee/superadmin/*` surface the web admin client already
targets, using only AGPL-core models and services. Every endpoint is gated by
``require_superadmin`` (session superadmins and `vb_sa_` tokens), mirroring the
existing ``ai_credits`` posture.

Paths intentionally keep the ``/ee/superadmin`` prefix so the existing frontend
(and its API catalog/playground) works unchanged.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization, OrganizationCreate, OrganizationUpdate
from src.db.roles import Role
from src.db.superadmin_api_tokens import (
    SuperadminAPITokenCreate,
    SuperadminAPITokenRead,
    SuperadminAPITokenUpdate,
)
from src.db.user_organizations import UserOrganization
from src.db.users import (
    APITokenUser,
    PublicUser,
    SuperadminAPITokenUser,
    User,
)
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.security.superadmin import require_superadmin
from src.security.features_utils.resolve import (
    _get_plan_from_config,
    resolve_all_features,
)
from src.services.orgs.cache import invalidate_org_cache, invalidate_org_config_cache
from src.services.orgs.custom_domains import list_all_verified_domains
from src.services.orgs.usage import get_org_usage_and_limits, invalidate_usage_cache

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_PLANS = {"free", "personal", "personal-family", "standard", "pro", "enterprise"}

# Analytics queries surfaced to the platform admin UI. Kept in sync with the
# frontend's key map; unknown names are skipped at runtime.
_SUPERADMIN_ANALYTICS_QUERIES = [
    "live_users",
    "enrollment_funnel",
    "event_counts",
    "daily_active_users",
    "top_courses",
    "visitors_by_country",
    "visitors_by_device",
    "visitors_by_referrer",
    "daily_visitor_breakdown",
    "activity_engagement",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _acting_user_id(current_user: Any) -> int:
    """Resolve the real user behind a principal.

    ``SuperadminAPITokenUser.id`` is the *token* id, so the minting user must be
    used instead — mirroring ``require_superadmin``.
    """
    if isinstance(current_user, SuperadminAPITokenUser):
        return int(current_user.created_by_user_id)
    return int(getattr(current_user, "id", 0) or 0)


async def _resolve_acting_user(current_user: Any, db_session: AsyncSession) -> PublicUser:
    """Return a real ``PublicUser`` for service calls.

    Session superadmins already are one; a ``vb_sa_`` token principal must be
    mapped back to the user who minted it, since downstream services use
    ``current_user.id`` (token ids are not user ids).
    """
    if isinstance(current_user, (SuperadminAPITokenUser, APITokenUser)):
        uid = _acting_user_id(current_user)
        user = (
            await db_session.execute(select(User).where(User.id == uid))
        ).scalars().first()
        if not user:
            raise HTTPException(status_code=403, detail="Acting superadmin no longer exists")
        return PublicUser.model_validate(user)
    return current_user


async def require_session_superadmin(
    current_user: Any = Depends(require_superadmin),
) -> Any:
    """Superadmin *session* only — API tokens cannot mint/revoke other tokens."""
    if isinstance(current_user, (SuperadminAPITokenUser, APITokenUser)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires a signed-in superadmin session, not an API token",
        )
    return current_user


def _like_pattern(search: str) -> str:
    escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _clamp_page(page: int, limit: int) -> tuple[int, int]:
    return max(int(page or 1), 1), min(max(int(limit or 20), 1), 100)


async def _get_org_or_404(org_id: int, db_session: AsyncSession) -> Organization:
    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def _get_org_config(org_id: int, db_session: AsyncSession) -> Optional[OrganizationConfig]:
    return (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()


def _invalidate_org_caches(org: Organization) -> None:
    try:
        invalidate_org_config_cache(int(org.id or 0))
        invalidate_usage_cache(int(org.id or 0))
        if org.slug:
            invalidate_org_cache(org.slug)
    except Exception:  # pragma: no cover - cache best-effort
        logger.debug("Superadmin cache invalidation failed", exc_info=True)


async def _org_counts(db_session: AsyncSession) -> tuple[dict[int, int], dict[int, int], dict[int, list[dict]]]:
    """Aggregate user counts, course counts and admin users per org (no N+1)."""
    user_rows = (
        await db_session.execute(
            select(UserOrganization.org_id, func.count()).group_by(UserOrganization.org_id)
        )
    ).all()
    user_counts = {int(org_id): int(count) for org_id, count in user_rows}

    course_rows = (
        await db_session.execute(
            select(Course.org_id, func.count()).group_by(Course.org_id)
        )
    ).all()
    course_counts = {int(org_id): int(count) for org_id, count in course_rows}

    admin_rows = (
        await db_session.execute(
            select(UserOrganization.org_id, User)
            .join(User, User.id == UserOrganization.user_id)
            .where(UserOrganization.role_id == ADMIN_ROLE_ID)
        )
    ).all()
    admin_users: dict[int, list[dict]] = defaultdict(list)
    for org_id, user in admin_rows:
        admin_users[int(org_id)].append(
            {
                "username": user.username,
                "email": user.email,
                "avatar_image": user.avatar_image,
                "user_uuid": user.user_uuid,
            }
        )
    return user_counts, course_counts, admin_users


async def _domains_by_org(db_session: AsyncSession) -> dict[int, list[str]]:
    domains: dict[int, list[str]] = defaultdict(list)
    try:
        for row in await list_all_verified_domains(db_session):
            domains[int(row["org_id"])].append(row["domain"])
    except Exception:  # pragma: no cover - table may be absent on minimal installs
        logger.debug("Verified-domain lookup failed", exc_info=True)
    return domains


def _serialize_org_summary(
    org: Organization,
    plan: str,
    user_count: int,
    course_count: int,
    domains: list[str],
    admins: list[dict],
) -> dict:
    return {
        "id": org.id,
        "org_uuid": org.org_uuid,
        "name": org.name,
        "slug": org.slug,
        "description": org.description,
        "email": org.email,
        "logo_image": org.logo_image,
        "thumbnail_image": org.thumbnail_image,
        "creation_date": org.creation_date,
        "update_date": org.update_date,
        "user_count": user_count,
        "course_count": course_count,
        "plan": plan,
        "custom_domains": domains,
        "admin_users": admins,
    }


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

@router.get("/status")
async def superadmin_status(current_user: Any = Depends(require_superadmin)):
    """Confirms the caller is a superadmin (the router gate already enforces it)."""
    return {"is_superadmin": True}


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------

@router.get("/organizations/visits")
async def organization_visits(
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Per-org visitor series. Empty unless analytics is configured."""
    try:
        from src.routers.analytics import _get_read_client

        if _get_read_client() is None:
            return {"data": []}
    except Exception:
        return {"data": []}
    # Analytics is configured: the platform-level per-org visit series is not a
    # predefined query, so return an empty (but valid) series rather than 500.
    return {"data": []}


@router.get("/organizations")
async def list_organizations(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    sort: str = Query("id"),
    search: Optional[str] = Query(None),
    plan: Optional[str] = Query(None),
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    page, limit = _clamp_page(page, limit)

    statement = select(Organization)
    if search:
        pattern = _like_pattern(search)
        statement = statement.where(
            (Organization.name.ilike(pattern, escape="\\"))
            | (Organization.slug.ilike(pattern, escape="\\"))
            | (Organization.email.ilike(pattern, escape="\\"))
        )
    organizations = (await db_session.execute(statement.order_by(Organization.id))).scalars().all()

    user_counts, course_counts, admin_users = await _org_counts(db_session)
    domains = await _domains_by_org(db_session)

    config_rows = (await db_session.execute(select(OrganizationConfig))).scalars().all()
    plan_by_org = {int(c.org_id): _get_plan_from_config(c.config or {}) for c in config_rows}

    items = [
        _serialize_org_summary(
            org,
            plan_by_org.get(int(org.id or 0), "free"),
            user_counts.get(int(org.id or 0), 0),
            course_counts.get(int(org.id or 0), 0),
            domains.get(int(org.id or 0), []),
            admin_users.get(int(org.id or 0), []),
        )
        for org in organizations
    ]

    # Plan filter
    if plan:
        if plan == "paid":
            items = [i for i in items if i["plan"] != "free"]
        else:
            items = [i for i in items if i["plan"] == plan]

    # Sorting (count-based sorts are resolved in memory; no analytics-backed sorts)
    reverse = sort.endswith("_desc")
    key_map = {
        "id": lambda i: i["id"] or 0,
        "newest": lambda i: i["creation_date"] or "",
        "oldest": lambda i: i["creation_date"] or "",
        "recently_updated": lambda i: i["update_date"] or "",
        "users_asc": lambda i: i["user_count"],
        "users_desc": lambda i: i["user_count"],
        "courses_asc": lambda i: i["course_count"],
        "courses_desc": lambda i: i["course_count"],
        "most_admins": lambda i: len(i["admin_users"]),
    }
    if sort == "oldest":
        items.sort(key=key_map["oldest"])
    elif sort in key_map:
        items.sort(key=key_map[sort], reverse=reverse or sort == "newest")
    else:
        items.sort(key=lambda i: i["id"] or 0, reverse=True)

    total = len(items)
    start = (page - 1) * limit
    return {"items": items[start:start + limit], "total": total, "page": page, "limit": limit}


@router.post("/organizations", status_code=status.HTTP_200_OK)
async def create_organization(
    request: Request,
    body: dict,
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.orgs.orgs import create_org

    name = (body.get("name") or "").strip()
    slug = (body.get("slug") or "").strip()
    email = (body.get("email") or "").strip()
    if not name or not slug or not email:
        raise HTTPException(status_code=400, detail="name, slug and email are required")

    org_object = OrganizationCreate(
        name=name,
        slug=slug,
        email=email,
        description=body.get("description") or "",
    )
    # create_org provisions a free plan; elevation goes through the plan endpoint.
    acting_user = await _resolve_acting_user(current_user, db_session)
    org_read = await create_org(request, org_object, acting_user, db_session)
    return org_read


@router.get("/organizations/{org_id}")
async def get_organization(
    org_id: int,
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    org = await _get_org_or_404(org_id, db_session)
    config_row = await _get_org_config(org_id, db_session)
    raw_config = dict(config_row.config or {}) if config_row else {}
    if config_row is not None:
        try:
            raw_config["resolved_features"] = resolve_all_features(config_row.config or {}, org_id)
        except Exception:
            logger.debug("Feature resolution failed for org %s", org_id, exc_info=True)

    user_counts, course_counts, admin_users = await _org_counts(db_session)
    domains = await _domains_by_org(db_session)

    summary = _serialize_org_summary(
        org,
        _get_plan_from_config(raw_config),
        user_counts.get(org_id, 0),
        course_counts.get(org_id, 0),
        domains.get(org_id, []),
        admin_users.get(org_id, []),
    )
    summary["config"] = raw_config
    return summary


@router.put("/organizations/{org_id}/settings")
async def update_organization_settings(
    org_id: int,
    request: Request,
    body: dict,
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.orgs.orgs import update_org

    org = await _get_org_or_404(org_id, db_session)
    update = OrganizationUpdate(
        name=body.get("name") or org.name,
        slug=body.get("slug") or org.slug,
        email=body.get("email") or org.email,
        description=body.get("description", org.description),
    )
    acting_user = await _resolve_acting_user(current_user, db_session)
    await update_org(request, update, org_id, acting_user, db_session)
    _invalidate_org_caches(org)
    return {"detail": "Organization settings updated"}


@router.put("/organizations/{org_id}/config")
async def update_organization_config(
    org_id: int,
    request: Request,
    body: dict,
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.orgs.orgs import update_org_with_config_no_auth

    config = body.get("config")
    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="config object is required")

    org = await _get_org_or_404(org_id, db_session)
    await update_org_with_config_no_auth(request, config, org_id, db_session)
    _invalidate_org_caches(org)
    return {"detail": "Organization config updated"}


@router.get("/organizations/{org_id}/usage")
async def organization_usage(
    org_id: int,
    request: Request,
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _get_org_or_404(org_id, db_session)
    acting_user = await _resolve_acting_user(current_user, db_session)
    return await get_org_usage_and_limits(request, org_id, acting_user, db_session)


@router.get("/organizations/{org_id}/courses")
async def organization_courses(
    org_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    page, limit = _clamp_page(page, limit)
    await _get_org_or_404(org_id, db_session)

    total = (
        await db_session.execute(
            select(func.count()).select_from(Course).where(Course.org_id == org_id)
        )
    ).scalar_one()

    rows = (
        await db_session.execute(
            select(Course)
            .where(Course.org_id == org_id)
            .order_by(Course.creation_date.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
    ).scalars().all()

    items = [
        {
            "id": c.id,
            "course_uuid": c.course_uuid,
            "name": c.name,
            "description": c.description,
            "published": c.published,
            "public": c.public,
            "thumbnail_image": c.thumbnail_image,
            "creation_date": c.creation_date,
        }
        for c in rows
    ]
    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.get("/organizations/{org_id}/users")
async def organization_users(
    org_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str = Query(""),
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    page, limit = _clamp_page(page, limit)
    await _get_org_or_404(org_id, db_session)

    base = (
        select(User, Role)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Role, Role.id == UserOrganization.role_id)
        .where(UserOrganization.org_id == org_id)
    )
    if search:
        pattern = _like_pattern(search)
        base = base.where(
            (User.username.ilike(pattern, escape="\\"))
            | (User.email.ilike(pattern, escape="\\"))
            | (User.first_name.ilike(pattern, escape="\\"))
            | (User.last_name.ilike(pattern, escape="\\"))
        )

    total = (
        await db_session.execute(
            select(func.count()).select_from(base.subquery())
        )
    ).scalar_one()

    rows = (
        await db_session.execute(
            base.order_by(UserOrganization.id.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
    ).all()

    items = [
        {
            "id": user.id,
            "user_uuid": user.user_uuid,
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "avatar_image": user.avatar_image,
            "role_name": role.name,
            "creation_date": user.creation_date,
        }
        for user, role in rows
    ]
    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.put("/organizations/{org_id}/plan")
async def update_organization_plan(
    org_id: int,
    request: Request,
    body: dict,
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.orgs.orgs import update_org_with_config_no_auth

    plan = body.get("plan")
    if plan not in VALID_PLANS:
        raise HTTPException(status_code=400, detail=f"Invalid plan. Must be one of: {sorted(VALID_PLANS)}")

    org = await _get_org_or_404(org_id, db_session)
    if org.is_demo:
        raise HTTPException(status_code=400, detail="The demo organization's plan cannot be changed")

    config_row = await _get_org_config(org_id, db_session)
    if not config_row:
        raise HTTPException(status_code=404, detail="Organization config not found")

    config = dict(config_row.config or {})
    if str(config.get("config_version", "1.0")).startswith("2"):
        config["plan"] = plan
    else:
        cloud = dict(config.get("cloud") or {})
        cloud["plan"] = plan
        config["cloud"] = cloud

    await update_org_with_config_no_auth(request, config, org_id, db_session)
    _invalidate_org_caches(org)
    return {"detail": "Organization plan updated", "org_id": org_id, "plan": plan}


@router.put("/organizations/{org_id}/admin_toggles")
async def update_organization_admin_toggles(
    org_id: int,
    request: Request,
    body: dict,
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.orgs.orgs import update_org_with_config_no_auth

    toggles = body.get("toggles")
    if not isinstance(toggles, dict):
        raise HTTPException(status_code=400, detail="toggles object is required")

    org = await _get_org_or_404(org_id, db_session)
    config_row = await _get_org_config(org_id, db_session)
    if not config_row:
        raise HTTPException(status_code=404, detail="Organization config not found")

    config = dict(config_row.config or {})
    if not str(config.get("config_version", "1.0")).startswith("2"):
        raise HTTPException(status_code=400, detail="Admin toggles require a v2 organization config")

    existing = dict(config.get("admin_toggles") or {})
    # Merge rather than replace so keys the UI does not manage (e.g. `security`)
    # and sub-fields it omits are preserved.
    for key, value in toggles.items():
        if isinstance(value, dict) and isinstance(existing.get(key), dict):
            merged = dict(existing[key])
            merged.update(value)
            existing[key] = merged
        else:
            existing[key] = value
    config["admin_toggles"] = existing

    await update_org_with_config_no_auth(request, config, org_id, db_session)
    _invalidate_org_caches(org)
    return {"detail": "Admin toggles updated"}


# ---------------------------------------------------------------------------
# Platform analytics
# ---------------------------------------------------------------------------

async def _run_analytics_queries(org_id: int, days: int, db_session: AsyncSession) -> dict:
    try:
        from src.routers.analytics import (
            _build_sql,
            _execute_tinybird_query,
            _get_read_client,
        )
        from src.services.analytics.queries import ALL_QUERIES
    except Exception:
        return {}

    if _get_read_client() is None:
        return {}

    days = max(1, min(days or 30, 365))
    result: dict[str, Any] = {}
    for name in _SUPERADMIN_ANALYTICS_QUERIES:
        if name not in ALL_QUERIES:
            continue
        template, default_days = ALL_QUERIES[name]
        safe_days = days or default_days or 30
        try:
            sql = _build_sql(template, org_id, safe_days)
            result[name] = await _execute_tinybird_query(name, sql, org_id, safe_days)
        except HTTPException:
            # A single failing/absent pipe must not blank the whole dashboard.
            logger.warning("Superadmin analytics query '%s' failed", name, exc_info=True)
            result[name] = {"data": [], "rows": 0, "meta": []}
    return result


@router.get("/analytics/global")
async def global_analytics(
    days: int = Query(30, ge=1, le=365),
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await _run_analytics_queries(0, days, db_session)


@router.get("/organizations/{org_id}/analytics")
async def organization_analytics(
    org_id: int,
    days: int = Query(30, ge=1, le=365),
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _get_org_or_404(org_id, db_session)
    return await _run_analytics_queries(org_id, days, db_session)


# ---------------------------------------------------------------------------
# Platform users
# ---------------------------------------------------------------------------

@router.get("/users")
async def list_platform_users(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    sort: str = Query("id"),
    search: Optional[str] = Query(None),
    superadmin: str = Query("all"),
    min_orgs: Optional[int] = Query(None, ge=1),
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    page, limit = _clamp_page(page, limit)

    statement = select(User)
    if search:
        pattern = _like_pattern(search)
        statement = statement.where(
            (User.username.ilike(pattern, escape="\\"))
            | (User.email.ilike(pattern, escape="\\"))
            | (User.first_name.ilike(pattern, escape="\\"))
            | (User.last_name.ilike(pattern, escape="\\"))
        )
    if superadmin == "yes":
        statement = statement.where(User.is_superadmin == True)  # noqa: E712
    elif superadmin == "no":
        statement = statement.where(User.is_superadmin == False)  # noqa: E712

    users = (await db_session.execute(statement)).scalars().all()

    membership_rows = (
        await db_session.execute(
            select(
                UserOrganization.user_id,
                Organization.id,
                Organization.name,
                Organization.slug,
                Role.name,
            )
            .join(Organization, Organization.id == UserOrganization.org_id)
            .join(Role, Role.id == UserOrganization.role_id)
        )
    ).all()
    memberships: dict[int, list[dict]] = defaultdict(list)
    for user_id, org_id, org_name, org_slug, role_name in membership_rows:
        memberships[int(user_id)].append(
            {"id": org_id, "name": org_name, "slug": org_slug, "role_name": role_name}
        )

    items = []
    for user in users:
        orgs = memberships.get(int(user.id or 0), [])
        if min_orgs and len(orgs) < min_orgs:
            continue
        items.append(
            {
                "id": user.id,
                "user_uuid": user.user_uuid,
                "username": user.username,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "avatar_image": user.avatar_image,
                "is_superadmin": bool(user.is_superadmin),
                "org_count": len(orgs),
                "orgs": orgs,
                "creation_date": user.creation_date,
                "update_date": user.update_date,
            }
        )

    if sort in ("orgs_desc", "orgs_asc"):
        items.sort(key=lambda i: i["org_count"], reverse=sort == "orgs_desc")
    elif sort == "username":
        items.sort(key=lambda i: (i["username"] or "").lower())
    elif sort == "newest":
        items.sort(key=lambda i: i["creation_date"] or "", reverse=True)
    elif sort == "oldest":
        items.sort(key=lambda i: i["creation_date"] or "")
    elif sort == "recently_updated":
        items.sort(key=lambda i: i["update_date"] or "", reverse=True)
    else:
        items.sort(key=lambda i: i["id"] or 0, reverse=True)

    total = len(items)
    start = (page - 1) * limit
    return {"items": items[start:start + limit], "total": total, "page": page, "limit": limit}


# ---------------------------------------------------------------------------
# Superadmin API tokens
# ---------------------------------------------------------------------------

@router.get("/tokens/", response_model=list[SuperadminAPITokenRead])
async def list_superadmin_tokens(
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.api_tokens.superadmin_api_tokens import list_superadmin_tokens as _list

    return await _list(db_session)


@router.post("/tokens/")
async def create_superadmin_token_endpoint(
    body: SuperadminAPITokenCreate,
    current_user: Any = Depends(require_session_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.api_tokens.superadmin_api_tokens import create_superadmin_token as _create

    return await _create(db_session, body, _acting_user_id(current_user))


@router.get("/tokens/{token_uuid}", response_model=SuperadminAPITokenRead)
async def get_superadmin_token_endpoint(
    token_uuid: str,
    current_user: Any = Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.api_tokens.superadmin_api_tokens import get_superadmin_token as _get

    return await _get(db_session, token_uuid)


@router.patch("/tokens/{token_uuid}", response_model=SuperadminAPITokenRead)
async def update_superadmin_token_endpoint(
    token_uuid: str,
    body: SuperadminAPITokenUpdate,
    current_user: Any = Depends(require_session_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.api_tokens.superadmin_api_tokens import update_superadmin_token as _update

    return await _update(db_session, token_uuid, body)


@router.delete("/tokens/{token_uuid}")
async def revoke_superadmin_token_endpoint(
    token_uuid: str,
    current_user: Any = Depends(require_session_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.api_tokens.superadmin_api_tokens import revoke_superadmin_token as _revoke

    return await _revoke(db_session, token_uuid)
