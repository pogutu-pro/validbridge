"""
W4d/W4e metering: code runs, premium AI credits, engagement email.

Pack rule (mirrors live hours): entitlements measures a monthly limit as
allowance + packs left against usage_counter, so usage past the allowance is
drawn from the pack and only the rest is recorded in the counter.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.billing import EnforcementFlag, OrgAddon, PackBalance
from src.db.billing.accounts import OrgEmailConfig
from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.security.features_utils import entitlements as ent_mod
from src.security.features_utils.entitlements import (
    METRIC_CODE_RUNS,
    METRIC_MANAGED_EMAILS,
    METRIC_PREMIUM_AI_CREDITS,
    get_usage,
)
from src.services.billing import metering

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def saas(monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "saas")
    monkeypatch.setattr(ent_mod, "_redis", lambda: None)


async def _plan(db, org, plan="starter", *, enforce=()):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": plan}))
    for metric in enforce:
        db.add(EnforcementFlag(metric=metric, mode="enforce"))
    await db.commit()


async def _pack(db, org, kind, remaining):
    db.add(PackBalance(org_id=org.id, kind=kind, remaining=remaining))
    await db.commit()


async def _remaining(db, org, kind):
    row = (
        await db.execute(
            select(PackBalance).where(PackBalance.org_id == org.id, PackBalance.kind == kind)
        )
    ).scalars().first()
    await db.refresh(row)
    return row.remaining


# ── Code runs ────────────────────────────────────────────────────────────────

async def test_code_runs_shadow_allows_past_allowance(db, org):
    await _plan(db, org)  # Starter: 200 runs, shadow by default
    await metering.record_monthly(org.id, METRIC_CODE_RUNS, "code_runs", 200, db)
    await metering.check_monthly(org.id, METRIC_CODE_RUNS, 50, db)  # logged, allowed


async def test_code_runs_enforce_blocks_with_error_code(db, org):
    await _plan(db, org, enforce=[METRIC_CODE_RUNS])
    await metering.record_monthly(org.id, METRIC_CODE_RUNS, "code_runs", 200, db)
    with pytest.raises(HTTPException) as exc:
        await metering.check_monthly(org.id, METRIC_CODE_RUNS, 1, db)
    assert exc.value.status_code == 402
    assert exc.value.detail["error_code"] == "code_runs_exhausted"
    assert "buy_code_runs" in exc.value.detail["options"]


async def test_code_runs_pack_drawdown_after_allowance(db, org):
    await _plan(db, org, enforce=[METRIC_CODE_RUNS])
    await _pack(db, org, "code_runs", 5000)

    await metering.record_monthly(org.id, METRIC_CODE_RUNS, "code_runs", 150, db)
    assert await _remaining(db, org, "code_runs") == 5000  # within the 200 allowance

    recorded = await metering.record_monthly(org.id, METRIC_CODE_RUNS, "code_runs", 100, db)
    # 50 fit the allowance; 50 came from the pack and are NOT in the counter.
    assert recorded == 50
    assert await get_usage(org.id, METRIC_CODE_RUNS, db) == 200
    assert await _remaining(db, org, "code_runs") == 4950

    # Headroom is exactly the pack left: 4950 more allowed, 4951 refused.
    await metering.check_monthly(org.id, METRIC_CODE_RUNS, 4950, db)
    with pytest.raises(HTTPException):
        await metering.check_monthly(org.id, METRIC_CODE_RUNS, 4951, db)


async def test_pack_never_goes_negative(db, org):
    await _plan(db, org)
    await _pack(db, org, "code_runs", 10)
    await metering.record_monthly(org.id, METRIC_CODE_RUNS, "code_runs", 250, db)
    assert await _remaining(db, org, "code_runs") == 0


async def test_code_runs_not_metered_when_self_hosted(db, org, monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "ee")
    await _plan(db, org, enforce=[METRIC_CODE_RUNS])
    assert await metering.record_monthly(org.id, METRIC_CODE_RUNS, "code_runs", 10**6, db) == 0
    await metering.check_monthly(org.id, METRIC_CODE_RUNS, 10**6, db)


# ── Code-run org attribution ─────────────────────────────────────────────────

async def test_named_org_requires_membership(db, org, other_org, admin_user):
    from src.routers.code_execution import _metering_org_id

    user = SimpleNamespace(id=admin_user.id)
    assert await _metering_org_id(org.id, None, user, db) == org.id
    with patch("src.security.org_auth.is_user_superadmin", AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await _metering_org_id(other_org.id, None, user, db)
    assert exc.value.status_code == 403


async def test_single_org_fallback_and_ambiguous_multi_org(db, org, other_org, admin_user):
    from src.routers.code_execution import _metering_org_id

    user = SimpleNamespace(id=admin_user.id)
    assert await _metering_org_id(None, None, user, db) == org.id
    db.add(UserOrganization(user_id=admin_user.id, org_id=other_org.id, role_id=4,
                            creation_date="x", update_date="x"))
    await db.commit()
    assert await _metering_org_id(None, None, user, db) is None


async def test_sqlite_playground_counts_against_the_course_org(db, org, admin_user):
    from src.routers.code_execution import _metering_org_id

    path = f"orgs/{org.org_uuid}/courses/course_x/activities/a/db.sqlite3"
    assert await _metering_org_id(999, path, SimpleNamespace(id=admin_user.id), db) == org.id


async def test_api_token_counts_against_its_org(db, org):
    from src.db.users import APITokenUser
    from src.routers.code_execution import _metering_org_id

    token = APITokenUser(org_id=org.id)
    assert await _metering_org_id(None, None, token, db) == org.id


# ── Premium AI (real Redis Lua) ──────────────────────────────────────────────

AI_ORG = 987_654


@pytest.fixture
def real_redis(monkeypatch):
    redis = pytest.importorskip("redis")
    client = redis.Redis.from_url("redis://localhost:6379/15")
    try:
        client.ping()
    except Exception:
        pytest.skip("local Redis not available")
    from src.security.features_utils import usage

    keys = usage._ai_keys(AI_ORG)
    client.delete(*keys)
    monkeypatch.setattr(usage, "_get_redis_client", lambda: client)
    yield client
    client.delete(*keys)


@pytest.fixture
async def ai_org(db):
    from datetime import datetime

    from src.db.organizations import Organization

    o = Organization(id=AI_ORG, name="AI Org", slug="ai-org", email="ai@org.test",
                     org_uuid="org_ai", creation_date=str(datetime.now()),
                     update_date=str(datetime.now()))
    db.add(o)
    db.add(OrganizationConfig(org_id=AI_ORG, config={"config_version": "2.0", "plan": "starter"}))
    await db.commit()
    return o


def _ai_patches():
    from src.security.features_utils import usage

    return patch(
        "src.security.features_utils.resolve.resolve_feature",
        return_value={"enabled": True, "limit": 20},
    ), patch.object(usage, "get_ai_credit_limit", return_value=20)


async def test_ai_allowance_then_pack_then_402(db, ai_org, real_redis):
    from src.security.features_utils import usage

    p1, p2 = _ai_patches()
    with p1, p2:
        db.add(PackBalance(org_id=AI_ORG, kind="ai_credits", remaining=10))
        await db.commit()

        await usage.reserve_ai_credit(AI_ORG, db, amount=18)       # allowance 20
        await usage.reserve_ai_credit(AI_ORG, db, amount=5)        # 2 allowance + 3 pack
        assert await _remaining(db, ai_org, "ai_credits") == 7
        assert await get_usage(AI_ORG, METRIC_PREMIUM_AI_CREDITS, db) == 20

        await usage.reserve_ai_credit(AI_ORG, db, amount=7)        # pack emptied
        assert await _remaining(db, ai_org, "ai_credits") == 0
        with pytest.raises(HTTPException) as exc:
            await usage.reserve_ai_credit(AI_ORG, db, amount=1)
        assert exc.value.status_code == 402
        assert exc.value.detail["error_code"] == "premium_ai_credits_exhausted"


async def test_ai_pack_spent_elsewhere_undoes_the_reservation(db, ai_org, real_redis):
    """Redis passed the reservation on a pack balance another request then
    spent: the Postgres draw fails, and the reservation is undone."""
    from src.security.features_utils import usage

    p1, p2 = _ai_patches()
    with p1, p2:
        real_redis.set(f"ai_credits_used:{AI_ORG}", 20)
        real_redis.set(f"ai_credits_period:{AI_ORG}", usage._ai_period())
        with patch.object(usage, "_ai_billing_state", AsyncMock(return_value=(5, False))):
            with pytest.raises(HTTPException) as exc:
                await usage.reserve_ai_credit(AI_ORG, db, amount=3)  # no pack row in PG
        assert exc.value.detail["error_code"] == "premium_ai_credits_exhausted"
        assert int(real_redis.get(f"ai_credits_used:{AI_ORG}")) == 20
        assert int(real_redis.get(f"ai_credits_pack_drawn:{AI_ORG}") or 0) == 0


async def test_ai_allowance_resets_monthly_and_legacy_credits_never_refill(db, ai_org, real_redis):
    from src.security.features_utils import usage

    p1, p2 = _ai_patches()
    with p1, p2:
        # Last month: 25 used = 20 allowance + 5 of 8 legacy purchased credits.
        real_redis.set(f"ai_credits_used:{AI_ORG}", 25)
        real_redis.set(f"ai_credits_purchased:{AI_ORG}", 8)
        real_redis.set(f"ai_credits_period:{AI_ORG}", "2000-01")

        summary = await usage.get_ai_credits_summary(AI_ORG, db)
        assert summary["used_credits"] == 0 and summary["purchased_credits"] == 3

        assert await usage.reserve_ai_credit(AI_ORG, db, amount=1) == 1
        assert int(real_redis.get(f"ai_credits_purchased:{AI_ORG}")) == 3
        assert real_redis.get(f"ai_credits_period:{AI_ORG}").decode() == usage._ai_period()


async def test_paused_org_gets_starter_allowance(db, ai_org, real_redis):
    from src.db.billing import BillingAccount
    from src.security.features_utils import usage

    db.add(BillingAccount(org_id=AI_ORG, status="paused"))
    row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == AI_ORG))).scalars().one()
    row.config = {"config_version": "2.0", "plan": "business"}
    db.add(row)
    await db.commit()
    with patch("src.security.features_utils.resolve.resolve_feature",
               return_value={"enabled": True, "limit": 1500}):
        # Paused: Starter's allowance applies, which includes no AI credits.
        with pytest.raises(HTTPException) as exc:
            await usage.reserve_ai_credit(AI_ORG, db, amount=1)
        assert exc.value.status_code == 402


# ── Engagement email ─────────────────────────────────────────────────────────

async def test_essential_email_is_never_gated(db, org):
    """send_email itself carries no gate; only the engagement wrapper does."""
    import inspect

    from src.services.email import utils

    assert "gate_engagement_email" not in inspect.getsource(utils.send_email)


async def test_engagement_skipped_without_managed_or_byo(db, org):
    from src.services.email.utils import gate_engagement_email, send_engagement_email

    await _plan(db, org, "growth", enforce=["managed_email"])
    assert await gate_engagement_email(org.id, db, 3) == 0
    with patch("src.services.email.utils.send_email") as send:
        assert await send_engagement_email(org.id, db, "a@b.test", "s", "b") is False
    send.assert_not_called()


async def test_engagement_shadow_sends(db, org):
    from src.services.email.utils import gate_engagement_email

    await _plan(db, org, "growth")  # shadow by default
    assert await gate_engagement_email(org.id, db, 3) == 3


async def test_engagement_with_verified_byo_sends(db, org):
    from datetime import datetime

    from src.services.email.utils import gate_engagement_email

    await _plan(db, org, "growth", enforce=["managed_email"])
    db.add(OrgEmailConfig(org_id=org.id, provider="resend", secret_enc="x",
                          verified_at=datetime.now()))
    await db.commit()
    assert await gate_engagement_email(org.id, db, 2) == 2


async def test_unverified_byo_does_not_count(db, org):
    from src.services.email.utils import gate_engagement_email

    await _plan(db, org, "growth", enforce=["managed_email"])
    db.add(OrgEmailConfig(org_id=org.id, provider="resend", secret_enc="x"))
    await db.commit()
    assert await gate_engagement_email(org.id, db, 2) == 0


async def test_managed_email_counts_and_caps_at_quota(db, org):
    from src.services.email.utils import gate_engagement_email

    await _plan(db, org, "business", enforce=[METRIC_MANAGED_EMAILS])  # 5,000 included
    assert await gate_engagement_email(org.id, db, 4998) == 4998
    assert await gate_engagement_email(org.id, db, 5) == 2  # quota covers 2 of 5
    assert await gate_engagement_email(org.id, db, 1) == 0
    assert await get_usage(org.id, METRIC_MANAGED_EMAILS, db) == 5000


async def test_managed_email_addon_on_growth(db, org):
    from src.services.email.utils import gate_engagement_email

    await _plan(db, org, "growth", enforce=["managed_email"])
    db.add(OrgAddon(org_id=org.id, addon="managed_email", quantity=1))
    await db.commit()
    assert await gate_engagement_email(org.id, db, 1) == 1


async def test_engagement_not_gated_when_self_hosted(db, org, monkeypatch):
    from src.services.email.utils import gate_engagement_email

    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "ee")
    await _plan(db, org, "starter", enforce=["managed_email"])
    assert await gate_engagement_email(org.id, db, 7) == 7
