"""Command center and platform-wide live / exam monitors."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.billing import BillingSubscription, Invoice
from src.db.courses.exams import ExamSession
from src.db.live_sessions import LiveSession, LiveSessionStatus
from src.db.org_suspensions import OrgSuspension
from src.db.users import PublicUser, User
from src.routers.superadmin_command import router
from src.security.superadmin import _get_current_user_lazy
from src.tests.services.conftest import assignment  # noqa: F401  (fixture)

BASE = "/api/v1/ee/superadmin"
NOW = datetime.now(timezone.utc)


@pytest.fixture
async def staff(db):
    owner = User(id=1, username="owner", first_name="O", last_name="X", email="o@test.com", password="x", user_uuid="user_owner",
                 creation_date="now", update_date="now", is_superadmin=True)
    nobody = User(id=2, username="nobody", first_name="N", last_name="X", email="n@test.com", password="x", user_uuid="user_nobody",
                  creation_date="now", update_date="now")
    db.add_all([owner, nobody])
    await db.commit()
    return {"owner": owner, "nobody": nobody}


@pytest.fixture
async def client(db, staff):
    state = {"user": staff["owner"]}
    app = FastAPI()
    app.include_router(router, prefix=BASE)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[_get_current_user_lazy] = lambda: PublicUser(
        id=state["user"].id, username=state["user"].username, first_name="x", last_name="x", email=state["user"].email, user_uuid=state["user"].user_uuid
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.state = state
        yield c


async def test_empty_platform(client):
    body = (await client.get(f"{BASE}/command-center")).json()
    assert body["totals"]["suspended"] == 0 and body["overdue_invoices"] == [] and body["live_now"] == [] and body["exams_now"] == []
    assert body["unpaid"] == {"count": 0, "cents": 0}


async def test_money_and_schools_that_need_attention(client, db, org):
    db.add(Invoice(org_id=org.id, number="VB-1", period="2026-10", lines=[], total_cents=250000, status="failed", catalog_version=1))
    db.add(Invoice(org_id=org.id, number="VB-2", period="2026-09", lines=[], total_cents=100, status="paid", catalog_version=1))
    db.add(BillingSubscription(org_id=org.id, plan="growth", cycle="monthly", period_start=NOW - timedelta(days=25),
                               period_end=NOW + timedelta(days=3), pending_plan="starter"))
    db.add(OrgSuspension(org_id=org.id, reason="unpaid for 60 days"))
    await db.commit()
    body = (await client.get(f"{BASE}/command-center")).json()
    assert body["unpaid"] == {"count": 1, "cents": 250000}
    assert [(i["number"], i["org_name"]) for i in body["overdue_invoices"]] == [("VB-1", org.name)]
    assert [(c["plan"], c["pending_plan"]) for c in body["plan_changes_soon"]] == [("growth", "starter")]
    assert body["suspended_schools"][0]["reason"] == "unpaid for 60 days" and body["totals"]["suspended"] == 1


async def test_subscription_changes_far_in_the_future_are_not_flagged(client, db, org):
    db.add(BillingSubscription(org_id=org.id, plan="growth", cycle="monthly", period_start=NOW,
                               period_end=NOW + timedelta(days=20), pending_plan="starter"))
    await db.commit()
    assert (await client.get(f"{BASE}/command-center")).json()["plan_changes_soon"] == []


async def test_live_classes_across_schools(client, db, org, course, staff):
    for n, status in enumerate((LiveSessionStatus.LIVE, LiveSessionStatus.SCHEDULED)):
        db.add(LiveSession(session_uuid=f"ls_{n}", org_id=org.id, course_id=course.id, instructor_id=staff["owner"].id,
                           title=f"Lesson {n}", status=status, scheduled_at=NOW, livekit_room_name=f"room-{n}"))
    await db.commit()
    items = (await client.get(f"{BASE}/monitor/live")).json()["items"]
    assert [(i["title"], i["org_name"]) for i in items] == [("Lesson 0", org.name)], "only classes that are live"


async def test_exams_in_progress_with_disconnects_and_violations(client, db, org, assignment, staff):  # noqa: F811
    fresh, stale = NOW - timedelta(seconds=5), NOW - timedelta(minutes=5)
    for uid, seen, violations, status in ((1, fresh, 0, "in_progress"), (2, stale, 3, "in_progress"), (3, fresh, 9, "submitted")):
        db.add(User(id=uid + 10, username=f"s{uid}", first_name="S", last_name="X", email=f"s{uid}@t.com", password="x",
                    user_uuid=f"user_s{uid}", creation_date="now", update_date="now"))
        await db.commit()
        db.add(ExamSession(assignment_id=assignment.id, user_id=uid + 10, status=status, deadline_at=NOW + timedelta(minutes=20),
                           last_seen_at=seen, violation_count=violations))
    await db.commit()
    (exam,) = (await client.get(f"{BASE}/monitor/exams")).json()["items"]
    assert exam["students"] == 2 and exam["disconnected"] == 1 and exam["violations"] == 3, "submitted students are not counted"
    assert exam["org_name"] == org.name and exam["title"] == "Test Assignment"
    assert (await client.get(f"{BASE}/command-center")).json()["exam_students_now"] == 2


async def test_non_staff_are_refused(client, staff):
    client.state["user"] = staff["nobody"]
    for path in ("command-center", "monitor/live", "monitor/exams"):
        assert (await client.get(f"{BASE}/{path}")).status_code == 403
