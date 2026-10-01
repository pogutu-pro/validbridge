"""
Read-only tools for the context-aware assistant (Phase 4).

These are the first tools in the codebase. Every rule from AIguide.md §8.2 is
enforced here:

1. **Re-authorize inside the tool.** Never inherit the caller's implied
   permission. Each tool runs its own ``is_org_member`` / role check.
2. **Take identifiers as arguments, derive ``org_id`` from the resource, then
   verify membership** -- the ``rag.py:173-211`` pattern (S1).
3. **Return field names, not raw rows.** No ``SELECT *`` into a prompt.
4. **Cap the result set** and truncate every string.
5. **Pass through ``reserve_ai_credit``.** Tool calls are model calls (S3).
6. **Read-only.** No write capability in Phase 4.

The tools are registered on an ``Agent`` built with ``deps_type=AssistantDeps``
so each tool receives the authenticated user's session and re-verifies against
the database. No tool accepts an ``org_id`` from the model or the client as
authority.
"""

import json
import logging
from dataclasses import dataclass
from typing import Any

from pydantic_ai import RunContext
from sqlalchemy import desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.security.org_auth import is_org_member

from src.services.ai.assistant.help_knowledge import _tokenize

logger = logging.getLogger(__name__)

# Cap on rows returned per tool. The assistant is a side panel; a wall of data
# makes it worse, not better.
MAX_ROWS = 25
MAX_STRING_CHARS = 200


@dataclass
class AssistantDeps:
    """
    Dependencies injected into every tool call.

    Carries the authenticated user's identity and database session so each tool
    can re-authorize independently. ``org_id`` is the already-resolved,
    membership-verified organization from the request handler -- tools use it to
    scope their queries but never trust it as authority.
    """

    db_session: AsyncSession
    user_id: int
    org_id: int


def _truncate(value: Any) -> Any:
    """Truncate every string in a result to keep prompts small."""
    if isinstance(value, str):
        return value[:MAX_STRING_CHARS]
    if isinstance(value, list):
        return [_truncate(v) for v in value]
    if isinstance(value, dict):
        return {k: _truncate(v) for k, v in value.items()}
    return value


def _to_json(data: Any) -> str:
    """Serialize tool output as JSON, truncated and safe for a prompt."""
    return json.dumps(_truncate(data), default=str)


async def _verify_membership(ctx: RunContext[AssistantDeps]) -> None:
    """
    Re-verify that the user is still a member of the org.

    Called at the top of every tool. The handler already checked membership
    before reserving credits, but a tool must never inherit that implied
    permission -- the org membership could have changed between the request and
    the tool call, and the tool runs with its own database session.
    """
    if not await is_org_member(ctx.deps.user_id, ctx.deps.org_id, ctx.deps.db_session):
        raise PermissionError(
            "You are not a member of this organization"
        )


async def list_my_courses(ctx: RunContext[AssistantDeps]) -> str:
    """
    List courses the user can manage in this organization.

    Returns a JSON array of ``{id, name, published, public}`` objects, best
    first. Capped at ``MAX_ROWS``.
    """
    await _verify_membership(ctx)

    result = await ctx.deps.db_session.execute(
        select(Course.id, Course.name, Course.published, Course.public)
        .where(Course.org_id == ctx.deps.org_id)
        .order_by(desc(Course.creation_date))
        .limit(MAX_ROWS)
    )
    # Defence in depth: cap again in Python. The SQL limit is the primary
    # control, but a tool must never return more than MAX_ROWS even if the
    # query is changed.
    courses = [
        {"id": row[0], "name": row[1], "published": row[2], "public": row[3]}
        for row in result.all()[:MAX_ROWS]
    ]
    return _to_json(courses)


async def get_org_branding_config(ctx: RunContext[AssistantDeps]) -> str:
    """
    Get the organization's branding configuration.

    Returns a JSON object with ``{name, slug, logo_image, label}``. Only
    non-sensitive fields are returned.
    """
    await _verify_membership(ctx)

    result = await ctx.deps.db_session.execute(
        select(Organization.name, Organization.slug, Organization.logo_image, Organization.label)
        .where(Organization.id == ctx.deps.org_id)
    )
    row = result.first()
    if not row:
        return _to_json({"error": "Organization not found"})

    return _to_json({
        "name": row[0],
        "slug": row[1],
        "logo_image": row[2],
        "label": row[3],
    })


async def get_my_assessments(ctx: RunContext[AssistantDeps]) -> str:
    """
    List assessments the user can see in this organization.

    Returns a JSON array of ``{id, name, type}`` objects. Capped at ``MAX_ROWS``.
    """
    await _verify_membership(ctx)

    from src.db.courses.activities import Activity

    result = await ctx.deps.db_session.execute(
        select(Activity.id, Activity.name, Activity.activity_type)
        .where(Activity.org_id == ctx.deps.org_id)
        .order_by(desc(Activity.creation_date))
        .limit(MAX_ROWS)
    )
    assessments = [
        {"id": row[0], "name": row[1], "type": row[2]}
        for row in result.all()[:MAX_ROWS]
    ]
    return _to_json(assessments)


# Curated navigation targets for the suggest_navigation tool.
#
# Mirrors the main entries in apps/web/lib/dashboard-search/registry.ts. The
# model calls this to discover valid hrefs, then proposes one in its response.
# The client re-validates every proposed href against the registry before
# rendering a link, so a hallucinated href is never shown.
#
# This is a hand-maintained subset, not a generated mirror: a page missing
# here just means the assistant can't point to it directly (it falls back to
# a parent page), never a broken or hallucinated link. Keep it in sync with
# apps/web/app/orgs/[orgslug]/dash/org/page.search.ts and friends when adding
# a page managers would plausibly ask to be taken to.
NAVIGATION_TARGETS = [
    {"href": "/dash", "label": "Dashboard home"},
    {"href": "/dash/courses", "label": "Courses"},
    {"href": "/dash/courses/migrate", "label": "Course migration"},
    {"href": "/dash/assignments", "label": "Assignments"},
    {"href": "/dash/connect", "label": "Communities"},
    {"href": "/dash/podcasts", "label": "Podcasts"},
    {"href": "/dash/boards", "label": "Boards"},
    {"href": "/dash/labs", "label": "Playgrounds"},
    {"href": "/dash/analytics", "label": "Analytics"},
    {"href": "/dash/users", "label": "Users"},
    {"href": "/dash/users/settings/roles", "label": "Roles & permissions"},
    {"href": "/dash/org", "label": "Organization settings"},
    {"href": "/dash/org/settings/general", "label": "Organization general"},
    {"href": "/dash/org/settings/branding", "label": "Branding"},
    {"href": "/dash/org/settings/landing", "label": "Landing page"},
    {"href": "/dash/org/settings/seo", "label": "SEO"},
    {"href": "/dash/org/settings/ai", "label": "AI settings"},
    {"href": "/dash/org/settings/domains", "label": "Domains"},
    {"href": "/dash/org/settings/automations", "label": "Automations"},
    {"href": "/dash/org/settings/api", "label": "API access"},
    {"href": "/dash/org/settings/sso", "label": "Single sign-on"},
    {"href": "/dash/org/settings/usage", "label": "Usage & billing"},
    {"href": "/dash/org/settings/other", "label": "Other organization settings"},
    {"href": "/dash/payments", "label": "Payments"},
    {"href": "/dash/payments/configuration", "label": "Payment configuration"},
    {"href": "/dash/payments/offers", "label": "Offers & products"},
]


async def suggest_navigation(ctx: RunContext[AssistantDeps], description: str) -> str:
    """
    Suggest navigation targets matching a description.

    The model calls this when the user asks to be taken somewhere. Returns a
    JSON array of ``{href, label}`` objects. The model then proposes one in
    its response; the client validates it against the registry before rendering.
    """
    await _verify_membership(ctx)

    query = description.lower()
    words = set(_tokenize(query))
    if not words:
        return _to_json(NAVIGATION_TARGETS[:5])

    scored = []
    for target in NAVIGATION_TARGETS:
        label_words = set(_tokenize(target["label"]))
        href_words = set(_tokenize(target["href"]))
        score = len(words & label_words) * 3 + len(words & href_words)
        if score > 0:
            scored.append((score, target))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return _to_json([t for _, t in scored[:5]])


# The tools registered on the assistant's Agent. Each is a narrow, read-only
# query with its own authorization decision.
ASSISTANT_TOOLS = [
    list_my_courses,
    get_org_branding_config,
    get_my_assessments,
    suggest_navigation,
]
