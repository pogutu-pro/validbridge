"""Tests for entitlements.py (pricing-implementation.md §4.3)."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from src.db.billing import (
    BillingAccount,
    EnforcementFlag,
    OrgAddon,
    PackBalance,
    PriceCatalog,
    StorageSnapshot,
    UsageCounter,
)
from src.db.organization_config import OrganizationConfig
from src.security.features_utils import entitlements as ent_mod
from src.security.features_utils.entitlements import (
    METRIC_CODE_RUNS,
    METRIC_INSTRUCTOR_SEATS,
    METRIC_LEARNERS,
    METRIC_LIVE_SECONDS,
    METRIC_PREMIUM_AI_CREDITS,
    METRIC_STORAGE,
    check,
    get_active_catalog,
    get_entitlements,
    get_usage,
    invalidate_entitlements,
    record_usage,
)
from src.services.billing.catalog_defaults import GB, HOUR, build_default_catalog

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def no_redis(monkeypatch):
    """Keep tests independent of any Redis the developer has running."""
    monkeypatch.setattr(ent_mod, "_redis", lambda: None)


@pytest.fixture(autouse=True)
def saas_mode(monkeypatch):
    """Limits are a hosted-service concept; these tests exercise them."""
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "saas")


async def _set_plan(db, org_id: int, plan: str, overrides: dict | None = None):
    cfg = {"config_version": "2.0", "plan": plan, "overrides": overrides or {}}
    db.add(OrganizationConfig(org_id=org_id, config=cfg))
    await db.commit()


# ---------------------------------------------------------------------------
# get_entitlements per plan
# ---------------------------------------------------------------------------

async def test_starter(db, org):
    await _set_plan(db, org.id, "starter")
    e = await get_entitlements(org.id, db)
    assert e.plan == "starter"
    assert e.catalog_version == 4
    assert e.instructor_seats == 1
    assert e.learner_allowance == 50
    assert e.storage_bytes == 1 * GB
    assert e.live_seconds_month == 2 * HOUR
    assert e.live_concurrency == 1
    assert e.premium_ai_credits_month == 0
    assert e.code_runs_month == 200
    assert e.features["sso"] is False
    assert e.features["api"] is False
    assert e.features["custom_domain"] is False
    assert e.managed_email is False
    assert e.byo_email is True
    assert e.exempt is False


async def test_growth(db, org):
    await _set_plan(db, org.id, "growth")
    e = await get_entitlements(org.id, db)
    assert e.instructor_seats == 3
    assert e.learner_allowance == 600
    assert e.storage_bytes == 10 * GB
    assert e.live_seconds_month == 30 * HOUR
    assert e.live_concurrency == 3
    assert e.premium_ai_credits_month == 300
    assert e.code_runs_month == 5000
    assert e.features["api"] is True
    assert e.features["webhooks"] is True
    assert e.features["custom_domain"] is True
    assert e.features["remove_badge"] is False
    assert e.features["sso"] is False


async def test_business(db, org):
    await _set_plan(db, org.id, "business")
    e = await get_entitlements(org.id, db)
    assert e.instructor_seats == 10
    assert e.learner_allowance == 2000
    assert e.storage_bytes == 50 * GB
    assert e.live_seconds_month == 100 * HOUR
    assert e.live_concurrency == 10
    assert e.premium_ai_credits_month == 1500
    assert e.code_runs_month == 20000
    assert e.managed_email is True
    assert e.managed_emails_month == 5000
    assert e.features["remove_badge"] is True
    assert e.features["sso"] is False


async def test_enterprise_base_allowances_and_sso_is_an_addon(db, org):
    await _set_plan(db, org.id, "enterprise")
    e = await get_entitlements(org.id, db)
    assert e.features["sso"] is False
    assert e.instructor_seats == 25
    assert e.learner_allowance == 25 * 200
    assert e.storage_bytes == 250 * GB
    assert e.premium_ai_credits_month == 5000


async def test_enterprise_deal_overrides_allowances(db, org):
    await _set_plan(db, org.id, "enterprise", {"entitlements": {"instructor_seats": None, "storage_bytes": None}})
    e = await get_entitlements(org.id, db)
    assert e.instructor_seats is None
    assert e.learner_allowance is None
    assert e.storage_bytes is None


async def test_public_education_learners_follow_instructors(db, org):
    await _set_plan(db, org.id, "public-education")
    e = await get_entitlements(org.id, db)
    assert e.instructor_seats is None  # unlimited seats
    assert e.storage_bytes == 2 * GB
    assert e.live_seconds_month == 10 * HOUR
    assert e.live_concurrency == 2
    assert e.premium_ai_credits_month == 0
    assert e.code_runs_month == 2000
    # No instructors yet → at least one seat's worth of learners.
    assert e.learner_allowance == 200


async def test_legacy_and_unknown_plans_normalise(db, org, other_org):
    await _set_plan(db, org.id, "pro")  # legacy → business
    await _set_plan(db, other_org.id, "nonsense")  # unknown → starter
    assert (await get_entitlements(org.id, db)).plan == "business"
    assert (await get_entitlements(other_org.id, db)).plan == "starter"


async def test_missing_config_defaults_to_starter(db, org):
    e = await get_entitlements(org.id, db)
    assert e.plan == "starter"


async def test_addons_packs_and_overrides(db, org):
    await _set_plan(
        db,
        org.id,
        "growth",
        overrides={
            "sso": {"force_enabled": True},
            "entitlements": {"storage_bytes": 100 * GB, "code_runs_month": None},
        },
    )
    past = datetime.now(timezone.utc) - timedelta(days=1)
    db.add(OrgAddon(org_id=org.id, addon="extra_seat", quantity=2, started_at=past))
    db.add(OrgAddon(org_id=org.id, addon="remove_badge", quantity=1, started_at=past))
    db.add(OrgAddon(org_id=org.id, addon="live_unlimited", quantity=3, started_at=past))
    # Expired add-on is ignored.
    db.add(OrgAddon(org_id=org.id, addon="managed_email", quantity=1, started_at=past,
                    ends_at=past + timedelta(hours=1)))
    db.add(PackBalance(org_id=org.id, kind="ai_credits", remaining=500))
    await db.commit()

    e = await get_entitlements(org.id, db)
    assert e.instructor_seats == 5
    assert e.learner_allowance == 1000
    assert e.features["remove_badge"] is True
    assert e.features["sso"] is True
    assert e.managed_email is False
    assert e.live_unlimited_instructors == 3
    assert e.storage_bytes == 100 * GB
    assert e.code_runs_month is None
    assert e.packs == {"ai_credits": 500}


async def test_demo_org_is_exempt(db, org):
    org.is_demo = True
    db.add(org)
    await db.commit()
    await _set_plan(db, org.id, "business")
    assert (await get_entitlements(org.id, db)).exempt is True


async def test_billing_account_exempt(db, org):
    await _set_plan(db, org.id, "starter")
    db.add(BillingAccount(org_id=org.id, exempt=True))
    await db.commit()
    assert (await get_entitlements(org.id, db)).exempt is True


async def test_catalog_from_db_overrides_defaults(db, org):
    items = build_default_catalog()
    items["plans"]["starter"]["code_runs"] = 999
    db.add(PriceCatalog(version=2, items=items))
    # A future version is not in effect yet.
    future = build_default_catalog()
    future["plans"]["starter"]["code_runs"] = 1
    db.add(PriceCatalog(version=3, items=future,
                        effective_from=datetime.now(timezone.utc) + timedelta(days=30)))
    await db.commit()
    version, _ = await get_active_catalog(db)
    assert version == 2
    await _set_plan(db, org.id, "starter")
    assert (await get_entitlements(org.id, db)).code_runs_month == 999


async def test_catalog_falls_back_to_defaults(db):
    version, items = await get_active_catalog(db)
    assert version == 4
    assert items["plans"]["growth"]["price_cents"] == 350000


# ---------------------------------------------------------------------------
# check / record_usage
# ---------------------------------------------------------------------------

async def test_default_mode_is_shadow_and_never_blocks(db, org, monkeypatch):
    monkeypatch.delenv("VALIDBRIDGE_ENFORCEMENT_DEFAULT", raising=False)
    await _set_plan(db, org.id, "starter")
    d = await check(org.id, METRIC_CODE_RUNS, 500, db)
    assert d.mode == "shadow"
    assert d.outcome == "shadow_blocked"
    assert d.allowed is True
    assert d.over_limit is True
    d.raise_if_blocked()  # no exception in shadow


async def test_off_mode_always_allows(db, org, monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_ENFORCEMENT_DEFAULT", "off")
    await _set_plan(db, org.id, "starter")
    d = await check(org.id, METRIC_CODE_RUNS, 10**9, db)
    assert d.outcome == "allowed"
    assert d.reason == "off"


async def test_enforce_blocks_with_error_contract(db, org):
    await _set_plan(db, org.id, "starter")
    db.add(EnforcementFlag(metric=METRIC_CODE_RUNS, mode="enforce"))
    await db.commit()
    await record_usage(org.id, METRIC_CODE_RUNS, 150, db)

    ok = await check(org.id, METRIC_CODE_RUNS, 50, db)
    assert ok.outcome == "allowed"
    assert ok.used == 150 and ok.limit == 200

    blocked = await check(org.id, METRIC_CODE_RUNS, 51, db)
    assert blocked.outcome == "blocked"
    assert blocked.error_code == "code_runs_exhausted"
    with pytest.raises(HTTPException) as exc:
        blocked.raise_if_blocked()
    assert exc.value.status_code == 402
    assert exc.value.detail["error_code"] == "code_runs_exhausted"
    assert exc.value.detail["used"] == 150
    assert exc.value.detail["limit"] == 200
    assert exc.value.detail["metric"] == METRIC_CODE_RUNS


async def test_packs_extend_monthly_allowance(db, org):
    await _set_plan(db, org.id, "starter")  # includes no AI credits
    db.add(EnforcementFlag(metric=METRIC_PREMIUM_AI_CREDITS, mode="enforce"))
    db.add(PackBalance(org_id=org.id, kind="ai_credits", remaining=100))
    await db.commit()
    assert (await check(org.id, METRIC_PREMIUM_AI_CREDITS, 100, db)).outcome == "allowed"
    assert (await check(org.id, METRIC_PREMIUM_AI_CREDITS, 101, db)).outcome == "blocked"


async def test_per_org_override_beats_global_flag(db, org):
    await _set_plan(db, org.id, "starter")
    db.add(EnforcementFlag(metric=METRIC_LIVE_SECONDS, mode="enforce"))
    db.add(BillingAccount(org_id=org.id, enforcement_overrides={METRIC_LIVE_SECONDS: "off"}))
    await db.commit()
    d = await check(org.id, METRIC_LIVE_SECONDS, 10 * HOUR, db)
    assert d.outcome == "allowed" and d.mode == "off"


async def test_exempt_org_is_never_blocked(db, org):
    await _set_plan(db, org.id, "starter")
    db.add(BillingAccount(org_id=org.id, exempt=True))
    db.add(EnforcementFlag(metric=METRIC_STORAGE, mode="enforce"))
    await db.commit()
    d = await check(org.id, METRIC_STORAGE, 100 * GB, db)
    assert d.outcome == "allowed" and d.reason == "exempt"


async def test_storage_uses_latest_snapshot(db, org):
    await _set_plan(db, org.id, "starter")
    db.add(EnforcementFlag(metric=METRIC_STORAGE, mode="enforce"))
    db.add(StorageSnapshot(org_id=org.id, bytes=GB - 10,
                           measured_at=datetime.now(timezone.utc)))
    await db.commit()
    assert (await check(org.id, METRIC_STORAGE, 10, db)).outcome == "allowed"
    d = await check(org.id, METRIC_STORAGE, 11, db)
    assert d.outcome == "blocked" and d.error_code == "storage_quota_exceeded"


async def test_gauge_metric_uses_caller_value(db, org):
    await _set_plan(db, org.id, "growth")
    db.add(EnforcementFlag(metric=METRIC_INSTRUCTOR_SEATS, mode="enforce"))
    db.add(EnforcementFlag(metric=METRIC_LEARNERS, mode="enforce"))
    await db.commit()
    assert (await check(org.id, METRIC_INSTRUCTOR_SEATS, 1, db, used=2)).outcome == "allowed"
    seat = await check(org.id, METRIC_INSTRUCTOR_SEATS, 1, db, used=3)
    assert seat.error_code == "seat_limit_reached"
    learners = await check(org.id, METRIC_LEARNERS, 1, db, used=600)
    assert learners.error_code == "learner_allowance_exceeded"


async def test_feature_metric_not_in_plan(db, org):
    await _set_plan(db, org.id, "growth")
    db.add(EnforcementFlag(metric="sso", mode="enforce"))
    await db.commit()
    d = await check(org.id, "sso", 1, db)
    assert d.outcome == "blocked"
    exc = d.to_http_exception()
    assert exc.status_code == 403
    assert exc.detail["error_code"] == "feature_not_in_plan"
    assert (await check(org.id, "api", 1, db)).outcome == "allowed"


async def test_unlimited_metric(db, org):
    await _set_plan(db, org.id, "enterprise", {"entitlements": {"code_runs_month": None}})
    d = await check(org.id, METRIC_CODE_RUNS, 10**9, db)
    assert d.outcome == "allowed" and d.reason == "unlimited"


async def test_unknown_metric_rejected(db, org):
    with pytest.raises(ValueError):
        await check(org.id, "bogus", 1, db)


async def test_record_usage_upserts_per_period(db, org):
    await record_usage(org.id, METRIC_CODE_RUNS, 3, db)
    await record_usage(org.id, METRIC_CODE_RUNS, 4, db)
    await record_usage(org.id, METRIC_CODE_RUNS, 5, db, period="2020-01")
    await record_usage(org.id, METRIC_CODE_RUNS, 0, db)  # no-op
    assert await get_usage(org.id, METRIC_CODE_RUNS, db) == 7
    assert await get_usage(org.id, METRIC_CODE_RUNS, db, period="2020-01") == 5
    from sqlmodel import select

    rows = (await db.execute(select(UsageCounter))).scalars().all()
    assert len(rows) == 2


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

class _FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}
        self.ttl: dict[str, int] = {}

    def get(self, key):
        return self.store.get(key)

    def setex(self, key, ttl, value):
        self.store[key] = value
        self.ttl[key] = ttl

    def delete(self, key):
        self.store.pop(key, None)


async def test_cache_round_trip_and_invalidation(db, org, monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(ent_mod, "_redis", lambda: fake)
    await _set_plan(db, org.id, "starter")

    first = await get_entitlements(org.id, db)
    key = f"entitlements:v1:{org.id}"
    assert key in fake.store and fake.ttl[key] == 60

    # Change the plan: the cached value is served until invalidated.
    row = (await db.execute(
        OrganizationConfig.__table__.select().where(OrganizationConfig.org_id == org.id)
    )).first()
    cfg = dict(row.config)
    cfg["plan"] = "business"
    await db.execute(
        OrganizationConfig.__table__.update()
        .where(OrganizationConfig.org_id == org.id)
        .values(config=cfg)
    )
    await db.commit()
    assert (await get_entitlements(org.id, db)) == first

    invalidate_entitlements(org.id)
    assert key not in fake.store
    assert (await get_entitlements(org.id, db)).plan == "business"


# ---------------------------------------------------------------------------
# Deployment mode and billing pause
# ---------------------------------------------------------------------------

async def test_self_hosted_is_unlimited(db, org, monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "ee")
    await _set_plan(db, org.id, "starter")
    db.add(EnforcementFlag(metric=METRIC_CODE_RUNS, mode="enforce"))
    await db.commit()
    d = await check(org.id, METRIC_CODE_RUNS, 10**6, db)
    assert d.outcome == "allowed" and d.reason == "not_saas"


async def test_sso_stays_plan_gated_when_self_hosted(db, org, monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "ee")
    await _set_plan(db, org.id, "growth")
    db.add(EnforcementFlag(metric="sso", mode="enforce"))
    await db.commit()
    d = await check(org.id, "sso", 1, db)
    assert d.outcome == "blocked"


async def test_paused_account_falls_back_to_starter_but_keeps_packs(db, org):
    await _set_plan(db, org.id, "business")
    db.add(BillingAccount(org_id=org.id, status="paused"))
    db.add(OrgAddon(org_id=org.id, addon="extra_seat", quantity=5))
    db.add(PackBalance(org_id=org.id, kind="ai_credits", remaining=100))
    await db.commit()
    e = await get_entitlements(org.id, db)
    assert e.plan == "starter"
    assert e.instructor_seats == 1  # extra seats pause with the plan
    assert e.packs["ai_credits"] == 100  # prepaid packs stay usable
