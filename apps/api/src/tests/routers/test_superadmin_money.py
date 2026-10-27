"""Money dashboard and system health."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.billing import BillingSubscription, Invoice, LedgerEntry, PaymentAttempt
from src.db.live_sessions import LiveSession, LiveSessionStatus
from src.db.users import PublicUser, User
from src.routers import superadmin_money as mod
from src.routers.superadmin_money import router
from src.security.superadmin import _get_current_user_lazy

BASE = "/api/v1/ee/superadmin"


def now():
    # Evaluated per test: a module-level value goes stale during a long suite run.
    return datetime.now(timezone.utc)


@pytest.fixture
async def client(db):
    db.add(User(id=1, username="finance", first_name="F", last_name="X", email="f@test.com", password="x", user_uuid="user_f",
                creation_date="now", update_date="now", platform_role="finance"))
    db.add(User(id=2, username="nobody", first_name="N", last_name="X", email="n@test.com", password="x", user_uuid="user_n",
                creation_date="now", update_date="now"))
    await db.commit()
    state = {"id": 1}
    app = FastAPI()
    app.include_router(router, prefix=BASE)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[_get_current_user_lazy] = lambda: PublicUser(
        id=state["id"], username="x", first_name="x", last_name="x", email="x@test.com", user_uuid=f"user_{state['id']}"
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.state = state
        yield c


async def test_money_dashboard(client, db, org):
    last_month = now().replace(day=1) - timedelta(days=3)
    db.add_all([
        PaymentAttempt(reference="vb_a", org_id=org.id, purpose="invoice", amount_cents=500000, status="success", created_at=now()),
        PaymentAttempt(reference="vb_b", org_id=org.id, purpose="invoice", amount_cents=200000, status="success", created_at=last_month),
        PaymentAttempt(reference="vbw_c", org_id=org.id, purpose="wallet", amount_cents=999999, status="success", created_at=now()),
        PaymentAttempt(reference="vb_d", org_id=org.id, purpose="invoice", amount_cents=999999, status="failed", created_at=now()),
        Invoice(org_id=org.id, number="I1", period="p", lines=[], total_cents=1000, status="open", catalog_version=1, created_at=now() - timedelta(days=5)),
        Invoice(org_id=org.id, number="I2", period="p", lines=[], total_cents=2000, status="failed", catalog_version=1, created_at=now() - timedelta(days=45)),
        Invoice(org_id=org.id, number="I3", period="p", lines=[], total_cents=4000, status="open", catalog_version=1, created_at=now() - timedelta(days=90)),
        Invoice(org_id=org.id, number="I4", period="p", lines=[], total_cents=700, status="paid", paid_via="manual", catalog_version=1),
        BillingSubscription(org_id=org.id, plan="growth", cycle="monthly", period_start=now(), period_end=now() + timedelta(days=30)),
        LedgerEntry(org_id=org.id, amount_cents=8000, kind="topup", balance_after_cents=8000),
    ])
    await db.commit()
    body = (await client.get(f"{BASE}/money")).json()
    months = {m["month"]: m["cents"] for m in body["collected_by_month"]}
    assert len(months) == 6 and months[now().strftime("%Y-%m")] == 500000, "wallet top-ups and failed payments are not revenue"
    assert sum(months.values()) == 700000
    assert [(b["count"], b["cents"]) for b in body["unpaid_aging"]] == [(1, 1000), (1, 2000), (1, 4000)]
    assert body["unpaid_total_cents"] == 7000 and body["recorded_manually"] == {"count": 1, "cents": 700}
    assert body["subscriptions_by_plan"] == {"growth": 1} and body["wallet_held_cents"] == 8000
    assert body["largest_wallets"][0]["org_name"] == org.name


async def test_finance_can_see_money_but_outsiders_cannot(client):
    assert (await client.get(f"{BASE}/money")).status_code == 200
    client.state["id"] = 2
    assert (await client.get(f"{BASE}/money")).status_code == 403
    assert (await client.get(f"{BASE}/health")).status_code == 403


async def test_health_reports_each_check_and_hides_secrets(client, monkeypatch):
    monkeypatch.setattr(mod, "get_redis_client", lambda: None)
    monkeypatch.setattr(mod, "billing_enabled", lambda: False)
    body = (await client.get(f"{BASE}/health")).json()
    checks = {c["name"]: c for c in body["checks"]}
    assert checks["Database"]["ok"] is True
    assert checks["Redis"]["ok"] is False and checks["Payments"]["ok"] is False and body["ok"] is False
    assert "VALIDBRIDGE_BILLING_ENABLED" in checks["Payments"]["detail"]
    assert "re_" not in checks["Email"]["detail"] and "password" not in checks["Email"]["detail"].lower()


async def test_health_flags_stuck_live_classes(client, db, org, course, monkeypatch):
    db.add(LiveSession(session_uuid="old", org_id=org.id, course_id=course.id, title="Forgotten", status=LiveSessionStatus.LIVE,
                       scheduled_at=now() - timedelta(hours=20), livekit_room_name="r"))
    await db.commit()
    checks = {c["name"]: c for c in (await client.get(f"{BASE}/health")).json()["checks"]}
    assert checks["Live classes"]["ok"] is False and "1 live classes" in checks["Live classes"]["detail"]
    assert checks["Exam sweeper"]["ok"] is True


async def test_what_each_school_pays_us(client, db, org, other_org):
    n = now()
    year, month = (n.year, n.month - 1) if n.month > 1 else (n.year - 1, 12)
    last_month = datetime(year, month, 15, tzinfo=timezone.utc)
    db.add_all([
        PaymentAttempt(reference="vbp_1_a", org_id=org.id, purpose="plan", amount_cents=500000, status="success", created_at=n),
        PaymentAttempt(reference="vbp_1_b", org_id=org.id, purpose="wallet_topup", amount_cents=100000, status="success", created_at=last_month),
        PaymentAttempt(reference="vbw_1_c", org_id=org.id, purpose="pack", amount_cents=999999, status="success", created_at=n),   # wallet spend
        PaymentAttempt(reference="vbc_1_d", org_id=org.id, purpose="card", amount_cents=999999, status="success", created_at=n),   # card check
        PaymentAttempt(reference="vbp_1_e", org_id=org.id, purpose="plan", amount_cents=999999, status="failed", created_at=n),
        PaymentAttempt(reference="vbp_2_f", org_id=other_org.id, purpose="plan", amount_cents=200000, status="success", created_at=n),
        Invoice(org_id=other_org.id, number="M1", period="p", lines=[], total_cents=300000, status="paid", paid_via="manual:mpesa", catalog_version=1),
        Invoice(org_id=other_org.id, number="M2", period="p", lines=[], total_cents=777, status="paid", paid_via="wallet", catalog_version=1),
        Invoice(org_id=other_org.id, number="U1", period="p", lines=[], total_cents=40000, status="open", catalog_version=1),
        BillingSubscription(org_id=org.id, plan="growth", cycle="monthly", period_start=n, period_end=n),
        LedgerEntry(org_id=org.id, amount_cents=2500, kind="topup", balance_after_cents=2500),
    ])
    await db.commit()
    body = (await client.get(f"{BASE}/schools-payments")).json()
    top, runner_up = body["items"]  # ranked by paid: org (600,000), then other_org (500,000)
    assert (top["org_id"], top["paid_cents"], top["paid_online_cents"], top["paid_manual_cents"]) == (org.id, 600000, 600000, 0), "wallet spending, card checks and failed payments are not money in"
    assert top["plan"] == "growth" and top["last_month_cents"] == 100000 and top["this_month_cents"] == 500000 and top["wallet_cents"] == 2500
    assert (runner_up["org_id"], runner_up["paid_online_cents"], runner_up["paid_manual_cents"]) == (other_org.id, 200000, 300000)
    assert runner_up["unpaid_cents"] == 40000 and runner_up["paid_cents"] == 500000, "a wallet-paid invoice is not cash"
    assert body["totals"] == {"paid_cents": 1100000, "this_month_cents": 1000000, "unpaid_cents": 40000, "schools_paying": 2}


async def test_school_payments_need_billing_access(client):
    client.state["id"] = 2
    assert (await client.get(f"{BASE}/schools-payments")).status_code == 403
