"""What each school collects from its own students, as the platform owner sees it."""

from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLog
from src.db.payments.payments_enrollments import EnrollmentStatusEnum, PaymentsEnrollment
from src.db.payments.payments_events import PaymentsEvent
from src.db.payments.payments_offers import PaymentsOffer
from src.db.users import PublicUser, User
from src.routers.superadmin_revenue import router
from src.security.superadmin import _get_current_user_lazy

BASE = "/api/v1/ee/superadmin"


def now():
    return datetime.now(timezone.utc)


async def _user(db, uid, name, **flags):
    u = User(id=uid, username=name, first_name=name.title(), last_name="X", email=f"{name}@test.com", password="x",
             user_uuid=f"user_{name}", creation_date="now", update_date="now", **flags)
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
async def people(db):
    return {
        "owner": await _user(db, 1, "owner", is_superadmin=True),
        "finance": await _user(db, 2, "finance", platform_role="finance"),
        "support": await _user(db, 3, "support", platform_role="support"),
        "student": await _user(db, 10, "student"),
    }


@pytest.fixture
async def client(db, people):
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


@pytest.fixture
async def offer(db, org):
    o = PaymentsOffer(offer_uuid="offer_f", org_id=org.id, name="Frontend", amount=1000, total_amount=15000, price_type="customer_choice")
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return o


_seq = [0]


def _event(db, org_id, kind, kes, offer_id=None, user_id=10, fee=0, currency="KES", status="success", at=None, ref=None):
    _seq[0] += 1
    reference = ref or f"vb_{org_id}_r{_seq[0]}"
    db.add(PaymentsEvent(
        event_id=f"evt_{_seq[0]}", event_type=kind, processed_at=at or now(),
        payload={"event": kind, "data": {"reference": reference, "status": status, "amount": int(kes * 100), "currency": currency,
                                         "metadata": {"offer_id": offer_id, "user_id": user_id, "fee_minor": int(fee * 100)}}},
    ))


async def test_collected_excludes_processing_fees_and_failed_payments(client, db, org, offer):
    _event(db, org.id, "charge.success", 5000, offer.id, fee=100)
    _event(db, org.id, "charge.success", 2000, offer.id, user_id=11)
    _event(db, org.id, "charge.success", 9999, offer.id, status="failed")
    await db.commit()
    (item,) = (await client.get(f"{BASE}/schools-revenue")).json()["items"]
    assert item["org_name"] == org.name and item["collected_cents"] == 490000 + 200000
    assert item["payments"] == 2 and item["buyers"] == 2 and item["this_month_cents"] == 690000


async def test_refunds_come_off_the_net(client, db, org, offer):
    _event(db, org.id, "charge.success", 5000, offer.id, ref=f"vb_{org.id}_paid")
    _event(db, org.id, "refund.processed", 1500, offer.id, ref=f"vb_{org.id}_paid")
    await db.commit()
    (item,) = (await client.get(f"{BASE}/schools-revenue")).json()["items"]
    assert (item["collected_cents"], item["refunded_cents"], item["net_cents"]) == (500000, 150000, 350000)


async def test_schools_and_currencies_are_kept_apart_and_ranked(client, db, org, other_org, offer):
    _event(db, org.id, "charge.success", 1000, offer.id)
    _event(db, other_org.id, "charge.success", 8000)
    _event(db, org.id, "charge.success", 50, currency="USD")
    _event(db, org.id, "charge.success", 777, ref="not-a-school-reference")  # not tied to a school
    await db.commit()
    body = (await client.get(f"{BASE}/schools-revenue")).json()
    assert [(i["org_id"], i["currency"], i["net_cents"]) for i in body["items"]] == [(other_org.id, "KES", 800000), (org.id, "KES", 100000), (org.id, "USD", 5000)]
    totals = {t["currency"]: t["net_cents"] for t in body["totals"]}
    assert totals == {"KES": 900000, "USD": 5000}


async def test_last_month_is_separated_from_this_month(client, db, org, offer):
    n = now()
    year, month = (n.year, n.month - 1) if n.month > 1 else (n.year - 1, 12)
    _event(db, org.id, "charge.success", 3000, offer.id, at=datetime(year, month, 15, tzinfo=timezone.utc))
    _event(db, org.id, "charge.success", 1000, offer.id)
    await db.commit()
    (item,) = (await client.get(f"{BASE}/schools-revenue")).json()["items"]
    assert (item["last_month_cents"], item["this_month_cents"], item["collected_cents"]) == (300000, 100000, 400000)


async def test_money_still_owed_by_students_paying_in_parts(client, db, org, offer):
    db.add(PaymentsEnrollment(enrollment_uuid="e1", offer_id=offer.id, user_id=10, org_id=org.id, status=EnrollmentStatusEnum.completed, amount_paid=5000))
    db.add(PaymentsEnrollment(enrollment_uuid="e2", offer_id=offer.id, user_id=11, org_id=org.id, status=EnrollmentStatusEnum.completed, amount_paid=15000))
    await db.commit()
    (item,) = (await client.get(f"{BASE}/schools-revenue")).json()["items"]
    assert item["outstanding_cents"] == 1000000 and item["collected_cents"] == 0


class TestWhoMaySee:
    async def test_owner_and_finance_yes_support_and_students_no(self, client, db, org):
        for uid, status in ((1, 200), (2, 200), (3, 403), (10, 403)):
            client.state["id"] = uid
            assert (await client.get(f"{BASE}/schools-revenue")).status_code == status, uid
            assert (await client.get(f"{BASE}/schools-revenue/{org.id}")).status_code == status, uid


class TestSchoolDetail:
    async def test_detail_shows_school_totals_by_month_and_offer(self, client, db, org, offer):
        _event(db, org.id, "charge.success", 5000, offer.id, fee=100)
        _event(db, org.id, "charge.success", 1000, offer.id)
        await db.commit()
        body = (await client.get(f"{BASE}/schools-revenue/{org.id}")).json()
        assert body["org"]["name"] == org.name and len(body["monthly"]) == 12
        assert body["monthly"][-1]["cents"] == 590000, "5,000 less a 100 fee, plus 1,000"
        assert body["offers"][0]["name"] == "Frontend" and body["offers"][0]["payments"] == 2
        assert body["offers"][0]["collected"] == 590000
        assert "recent" not in body, "no individual payments or students are exposed"
        assert "Student" not in str(body) and "student@test.com" not in str(body)

    async def test_opening_a_schools_detail_is_audited(self, client, db, org):
        await client.get(f"{BASE}/schools-revenue/{org.id}")
        row = (await db.execute(select(AuditLog).where(AuditLog.action == "superadmin.revenue.view"))).scalars().one()
        assert row.org_id == org.id and row.user_id == 1

    async def test_unknown_school(self, client):
        assert (await client.get(f"{BASE}/schools-revenue/99999")).status_code == 404
