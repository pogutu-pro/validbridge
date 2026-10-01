"""Tests for the assistant's read-only tools (Phase 4).

The critical property is that every tool re-authorizes independently: a tool
must never inherit the caller's implied permission. These tests prove that a
non-member is refused inside the tool, and that results are capped and
truncated.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai import RunContext

from src.services.ai.assistant.tools import (
    MAX_ROWS,
    NAVIGATION_TARGETS,
    AssistantDeps,
    get_my_assessments,
    get_org_branding_config,
    list_my_courses,
    suggest_navigation,
)


def _result(rows):
    res = MagicMock()
    res.all.return_value = rows
    res.first.return_value = rows[0] if rows else None
    return res


def _ctx(user_id=1, org_id=10, member=True):
    """Build a RunContext with mocked deps and membership."""
    db = AsyncMock()
    deps = AssistantDeps(db_session=db, user_id=user_id, org_id=org_id)
    ctx = MagicMock(spec=RunContext)
    ctx.deps = deps
    return ctx, db, member


class TestListMyCourses:
    async def test_returns_courses_for_member(self):
        ctx, db, _ = _ctx(member=True)
        db.execute.return_value = _result([
            (1, "Intro to Python", True, True),
            (2, "Advanced Math", False, True),
        ])

        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=True
        ):
            result = json.loads(await list_my_courses(ctx))

        assert len(result) == 2
        assert result[0]["name"] == "Intro to Python"
        assert result[0]["published"] is True
        # Field names, not raw rows.
        assert set(result[0].keys()) == {"id", "name", "published", "public"}

    async def test_refuses_non_member(self):
        ctx, db, _ = _ctx(member=False)
        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=False
        ):
            with pytest.raises(PermissionError):
                await list_my_courses(ctx)

    async def test_caps_rows(self):
        ctx, db, _ = _ctx(member=True)
        rows = [(i, f"Course {i}", True, True) for i in range(MAX_ROWS + 10)]
        db.execute.return_value = _result(rows)

        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=True
        ):
            result = json.loads(await list_my_courses(ctx))

        assert len(result) == MAX_ROWS

    async def test_scopes_to_org(self):
        ctx, db, _ = _ctx(org_id=42)
        db.execute.return_value = _result([])

        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=True
        ):
            await list_my_courses(ctx)

        # The query must filter by the verified org_id.
        query_str = str(db.execute.call_args.args[0])
        assert "org_id" in query_str


class TestGetOrgBrandingConfig:
    async def test_returns_branding_for_member(self):
        ctx, db, _ = _ctx(member=True)
        db.execute.return_value = _result([("Acme", "acme", "logo.png", "Acme Inc")])

        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=True
        ):
            result = json.loads(await get_org_branding_config(ctx))

        assert result["name"] == "Acme"
        assert result["slug"] == "acme"
        # Only non-sensitive fields.
        assert set(result.keys()) == {"name", "slug", "logo_image", "label"}

    async def test_refuses_non_member(self):
        ctx, _, _ = _ctx(member=False)
        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=False
        ):
            with pytest.raises(PermissionError):
                await get_org_branding_config(ctx)

    async def test_missing_org_returns_error(self):
        ctx, db, _ = _ctx(member=True)
        db.execute.return_value = _result([])

        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=True
        ):
            result = json.loads(await get_org_branding_config(ctx))

        assert "error" in result


class TestGetMyAssessments:
    async def test_returns_assessments_for_member(self):
        ctx, db, _ = _ctx(member=True)
        db.execute.return_value = _result([
            (1, "Quiz 1", "quiz"),
            (2, "Assignment 1", "assignment"),
        ])

        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=True
        ):
            result = json.loads(await get_my_assessments(ctx))

        assert len(result) == 2
        assert result[0]["name"] == "Quiz 1"
        assert set(result[0].keys()) == {"id", "name", "type"}

    async def test_refuses_non_member(self):
        ctx, _, _ = _ctx(member=False)
        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=False
        ):
            with pytest.raises(PermissionError):
                await get_my_assessments(ctx)


class TestTruncation:
    async def test_long_strings_truncated(self):
        ctx, db, _ = _ctx(member=True)
        long_name = "x" * 500
        db.execute.return_value = _result([(1, long_name, True, True)])

        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=True
        ):
            result = json.loads(await list_my_courses(ctx))

        assert len(result[0]["name"]) <= 200


class TestSuggestNavigation:
    async def test_returns_matching_targets(self):
        ctx, _, _ = _ctx(member=True)
        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=True
        ):
            result = json.loads(await suggest_navigation(ctx, "take me to payment configuration"))

        assert len(result) > 0
        # Payment-related targets should be in the results.
        hrefs = [t["href"] for t in result]
        assert any("payment" in h for h in hrefs)

    async def test_refuses_non_member(self):
        ctx, _, _ = _ctx(member=False)
        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=False
        ):
            with pytest.raises(PermissionError):
                await suggest_navigation(ctx, "branding")

    async def test_empty_description_returns_defaults(self):
        ctx, _, _ = _ctx(member=True)
        with patch(
            "src.services.ai.assistant.tools.is_org_member", new_callable=AsyncMock, return_value=True
        ):
            result = json.loads(await suggest_navigation(ctx, ""))

        assert len(result) > 0
        assert all("href" in t and "label" in t for t in result)

    async def test_all_targets_have_href_and_label(self):
        for target in NAVIGATION_TARGETS:
            assert target["href"].startswith("/")
            assert target["label"]
