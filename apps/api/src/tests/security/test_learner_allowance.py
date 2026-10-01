"""Active-learner allowance with a 7-day grace (pricechange.md §4)."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from src.db.billing import BillingSubscription, EnforcementFlag
from src.db.organization_config import OrganizationConfig
from src.security.features_utils import entitlements as ent_mod
from src.security.features_utils import usage

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "saas")
    monkeypatch.delenv("VALIDBRIDGE_BILLING_ENABLED", raising=False)
    monkeypatch.setattr(ent_mod, "_redis", lambda: None)


def _active(monkeypatch, n):
    async def gauge(org_id, metric, db):
        return n

    monkeypatch.setattr(ent_mod, "_default_gauge_value", gauge)


async def _starter(db, org, *, enforce=True):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "starter"}))
    if enforce:
        db.add(EnforcementFlag(metric="learners", mode="enforce"))
    await db.commit()


async def test_under_allowance_joins(db, org, monkeypatch):
    await _starter(db, org)
    _active(monkeypatch, 10)
    await usage.enforce_learner_allowance(org.id, 1, db)
    assert await db.get(BillingSubscription, org.id) is None  # no grace clock


async def test_shadow_never_blocks(db, org, monkeypatch):
    await _starter(db, org, enforce=False)
    _active(monkeypatch, 500)
    await usage.enforce_learner_allowance(org.id, 1, db)


async def test_grace_then_refused(db, org, monkeypatch):
    await _starter(db, org)
    _active(monkeypatch, 50)  # Starter allows 50

    # First time over: the grace starts and the learner still joins.
    await usage.enforce_learner_allowance(org.id, 1, db)
    sub = await db.get(BillingSubscription, org.id)
    assert sub.learner_grace_started_at is not None

    # Grace spent: new learners are refused and asked to upgrade (Starter
    # sells no extra seats).
    sub.learner_grace_started_at = datetime.now(UTC) - timedelta(days=8)
    db.add(sub)
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await usage.enforce_learner_allowance(org.id, 1, db)
    assert exc.value.status_code == 402
    assert exc.value.detail["error_code"] == "learner_allowance_exceeded"
    assert exc.value.detail["options"] == ["upgrade"]


async def test_back_under_clears_the_grace(db, org, monkeypatch):
    await _starter(db, org)
    db.add(BillingSubscription(
        org_id=org.id, plan="starter",
        learner_grace_started_at=datetime.now(UTC) - timedelta(days=20),
    ))
    await db.commit()
    _active(monkeypatch, 5)
    await usage.enforce_learner_allowance(org.id, 1, db)
    assert (await db.get(BillingSubscription, org.id)).learner_grace_started_at is None


async def test_self_hosted_is_unlimited(db, org, monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "ee")
    await _starter(db, org)
    _active(monkeypatch, 10_000)
    await usage.enforce_learner_allowance(org.id, 1, db)
