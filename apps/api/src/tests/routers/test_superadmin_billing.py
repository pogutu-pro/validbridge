"""Superadmin billing console (W11): money actions are exact, audited, reversible."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.audit_logs import AuditLog
from src.db.billing import (
    BillingAccount,
    EnforcementFlag,
    Invoice,
    PackBalance,
    PriceCatalog,
)
from src.routers import superadmin_billing as sab
from src.security.features_utils import entitlements as ent_mod
from src.services.billing import accounts
from src.services.billing.catalog_defaults import build_default_catalog, kes

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setattr(ent_mod, "_redis", lambda: None)


@pytest.fixture
def sa(admin_user):
    return SimpleNamespace(id=admin_user.id)


async def _audits(db, action):
    return (
        await db.execute(select(AuditLog).where(AuditLog.action == f"superadmin.billing.{action}"))
    ).scalars().all()


async def test_wallet_adjust_is_ledgered_and_audited(db, org, sa):
    out = await sab.api_wallet_adjust(
        org.id, sab.WalletAdjustBody(amount_cents=kes(500), reason="goodwill credit"),
        None, sa, db,
    )
    assert out["balance_cents"] == kes(500)
    assert await accounts.wallet_balance(org.id, db) == kes(500)
    audit = await _audits(db, "wallet_adjust")
    assert audit and audit[0].payload["reason"] == "goodwill credit"


async def test_wallet_cannot_be_adjusted_below_zero(db, org, sa):
    with pytest.raises(HTTPException):
        await sab.api_wallet_adjust(
            org.id, sab.WalletAdjustBody(amount_cents=-100, reason="oops"), None, sa, db,
        )


async def test_reason_is_required():
    with pytest.raises(Exception):
        sab.WalletAdjustBody(amount_cents=100, reason="")


async def test_grant_pack(db, org, sa):
    await sab.api_grant_pack(org.id, sab.PackGrantBody(kind="ai_credits", units=250, reason="support"), None, sa, db)
    pack = (await db.execute(select(PackBalance))).scalars().one()
    assert pack.remaining == 250
    with pytest.raises(HTTPException):
        await sab.api_grant_pack(org.id, sab.PackGrantBody(kind="gold", units=1, reason="x x"), None, sa, db)


async def test_void_last_unpaid_invoice_resumes_a_paused_org(db, org, sa):
    db.add(BillingAccount(org_id=org.id, status="paused"))
    inv = Invoice(org_id=org.id, number="VB-202610-1", period="2026-10", lines=[],
                  total_cents=100, status="open", catalog_version=1)
    db.add(inv)
    await db.commit()
    await sab.api_void_invoice(org.id, inv.id, sab.Reason(reason="billing error"), None, sa, db)
    await db.refresh(inv)
    assert inv.status == "void"
    assert (await db.get(BillingAccount, org.id)).status == "active"


async def test_enforcement_flags_are_validated_and_set(db, sa):
    with pytest.raises(HTTPException):
        await sab.api_set_enforcement(sab.EnforcementBody(modes={"storage": "maybe"}, reason="rollout"), None, sa, db)
    with pytest.raises(HTTPException):
        await sab.api_set_enforcement(sab.EnforcementBody(modes={"nope": "enforce"}, reason="rollout"), None, sa, db)
    await sab.api_set_enforcement(sab.EnforcementBody(modes={"storage": "enforce"}, reason="rollout"), None, sa, db)
    assert (await db.get(EnforcementFlag, "storage")).mode == "enforce"
    view = await sab.api_get_enforcement(sa, db)
    assert view["storage"] == {"mode": "enforce", "explicit": True}
    assert view["instructor_seats"]["mode"] == "enforce"  # enforced by default


async def test_catalog_versions_only_move_forward(db, sa):
    items = build_default_catalog()
    items["plans"]["growth"]["price_cents"] = kes(3900)
    out = await sab.api_publish_catalog(sab.CatalogBody(items=items, reason="price rise"), None, sa, db)
    assert out["version"] == 5
    version, active = await ent_mod.get_active_catalog(db)
    assert version == 5 and active["plans"]["growth"]["price_cents"] == kes(3900)
    rows = (await db.execute(select(PriceCatalog))).scalars().all()
    assert len(rows) == 1  # v1 (built-in) untouched, v2 added

    bad = build_default_catalog()
    bad["plans"]["growth"]["price_cents"] = 35.5
    with pytest.raises(HTTPException):
        await sab.api_publish_catalog(sab.CatalogBody(items=bad, reason="float price"), None, sa, db)


async def test_override_lifts_limits_and_pause_then_ends(db, org, sa, monkeypatch):
    from src.db.organization_config import OrganizationConfig
    from src.services.billing import notify

    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "saas")
    sent = []

    async def fake_send(org_id, subject, body, session):
        sent.append(subject)

    monkeypatch.setattr(notify, "_send", fake_send)
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "business"}))
    db.add(BillingAccount(org_id=org.id, status="paused"))
    await db.commit()
    assert (await ent_mod.get_entitlements(org.id, db)).plan == "starter"

    out = await sab.api_override_limits(
        org.id, sab.OverrideBody(days=3, reason="M-Pesa paid, settling"), None, sa, db,
    )
    assert out["override_until"]
    assert (await ent_mod.get_entitlements(org.id, db)).plan == "business"
    d = await ent_mod.check(org.id, "instructor_seats", 100, db, used=100)
    assert d.outcome == "allowed" and d.reason == "off"
    assert sent and "payment" in sent[0].lower()
    assert await _audits(db, "override_limits")

    await sab.api_end_override(org.id, sab.Reason(reason="payment received"), None, sa, db)
    assert (await ent_mod.get_entitlements(org.id, db)).plan == "starter"


# ── Custom deal + manual payments ────────────────────────────────────────────

async def _cfg(db, org_id, plan):
    from src.db.organization_config import OrganizationConfig

    db.add(OrganizationConfig(org_id=org_id, config={"config_version": "2.0", "plan": plan}))
    await db.commit()


async def test_deal_allowances_and_features(db, org, sa):
    await _cfg(db, org.id, "growth")
    await sab.api_set_deal(org.id, sab.DealBody(
        reason="school asked for more", allowances={"instructor_seats": 12, "storage_bytes": None},
        features={"sso": True}), None, sa, db)
    e = await ent_mod.get_entitlements(org.id, db, use_cache=False)
    assert e.instructor_seats == 12 and e.storage_bytes is None and e.features["sso"] is True

    await sab.api_set_deal(org.id, sab.DealBody(
        reason="back to plan", allowances={"instructor_seats": "default"}, features={"sso": False}),
        None, sa, db)
    e = await ent_mod.get_entitlements(org.id, db, use_cache=False)
    assert e.instructor_seats == 3 and e.features["sso"] is False
    with pytest.raises(HTTPException):
        await sab.api_set_deal(org.id, sab.DealBody(reason="bad", allowances={"bogus": 1}), None, sa, db)


async def test_custom_price_is_invoiced_by_the_cycle(db, org, sa, monkeypatch):
    from datetime import UTC, datetime
    from src.services.billing import cycle, notify

    monkeypatch.setenv("VALIDBRIDGE_BILLING_ENABLED", "true")

    async def quiet(*a, **k):
        return None

    monkeypatch.setattr(notify, "_send", quiet)
    await _cfg(db, org.id, "enterprise")
    out = await sab.api_set_deal(org.id, sab.DealBody(
        reason="enterprise contract", custom_price_cents=kes(30000), cycle="monthly"), None, sa, db)
    assert out["billing_starts_next_run"]
    await cycle.run_cycle(db, now=datetime.now(UTC))
    inv = (await db.execute(select(Invoice))).scalars().one()
    assert inv.total_cents == kes(30000) and inv.lines[0]["code"] == "base"


async def test_mark_paid_manually_settles_and_resumes(db, org, sa, monkeypatch):
    from src.services.billing import notify

    async def quiet(*a, **k):
        return None

    monkeypatch.setattr(notify, "_send", quiet)
    db.add(BillingAccount(org_id=org.id, status="paused"))
    inv = Invoice(org_id=org.id, number="VB-202610-9", period="2026-10", lines=[],
                  total_cents=kes(3500), status="open", catalog_version=1)
    db.add(inv)
    await db.commit()
    await sab.api_mark_invoice_paid(org.id, inv.id, sab.MarkPaidBody(
        reason="bank transfer received", method="bank_transfer", payment_reference="KCB-123"), None, sa, db)
    await db.refresh(inv)
    assert inv.status == "paid" and inv.paid_via == "manual:bank_transfer"
    assert (await db.get(BillingAccount, org.id)).status == "active"
    assert await accounts.wallet_balance(org.id, db) == 0  # in and out, recorded
    assert await _audits(db, "mark_paid")


async def test_manual_plan_activates_for_the_period(db, org, sa, monkeypatch):
    from src.services.billing import notify

    async def quiet(*a, **k):
        return None

    monkeypatch.setattr(notify, "_send", quiet)
    await _cfg(db, org.id, "starter")
    out = await sab.api_manual_plan(org.id, sab.ManualPlanBody(
        reason="paid by M-Pesa to paybill", plan="business", cycle="yearly", months=12,
        amount_cents=kes(96900), method="mpesa", payment_reference="QK12ABC"), None, sa, db)
    assert out["plan"] == "business"
    assert (await ent_mod.get_entitlements(org.id, db, use_cache=False)).plan == "business"
    sub = await accounts.get_subscription(org.id, db)
    assert sub.plan == "business" and sub.period_end is not None
    inv = (await db.execute(select(Invoice))).scalars().one()
    assert inv.status == "paid" and inv.total_cents == kes(96900)
