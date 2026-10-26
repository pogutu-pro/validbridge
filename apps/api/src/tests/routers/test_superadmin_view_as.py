"""Read-only "view as school" for platform staff."""

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLog
from src.db.users import PublicUser, User
from src.routers import superadmin_view_as as mod
from src.routers.superadmin_view_as import router
from src.security.security import ALGORITHM, SECRET_KEY
from src.security.superadmin import _get_current_user_lazy

BASE = "/api/v1/ee/superadmin"


async def _user(db, uid, name, **flags):
    u = User(id=uid, username=name, first_name=name.title(), last_name="X", email=f"{name}@test.com", password="x",
             user_uuid=f"user_{name}", creation_date="now", update_date="now", **flags)
    db.add(u)
    await db.commit()
    return u


def _public(u):
    return PublicUser(id=u.id, username=u.username, first_name=u.first_name, last_name=u.last_name, email=u.email, user_uuid=u.user_uuid)


@pytest.fixture
async def people(db, org):
    return {
        "owner": await _user(db, 1, "owner", is_superadmin=True),
        "support": await _user(db, 2, "support", platform_role="support"),
        "finance": await _user(db, 3, "finance", platform_role="finance"),
        "nobody": await _user(db, 4, "nobody"),
    }


@pytest.fixture
def state(people):
    return {"user": _public(people["support"])}


@pytest.fixture
async def client(db, state, monkeypatch):
    async def overview(org_id, actor, db_session):
        assert actor is None
        return {"plan": "growth", "public_key": "pk_live_secret", "wallet_balance_cents": 5000}

    async def invoices(org_id, actor, db_session):
        return [{"number": "INV-1", "total_cents": 1000}]

    async def ledger(org_id, actor, db_session):
        return [{"id": 1, "amount_cents": 500}]

    monkeypatch.setattr(mod.school_billing, "api_overview", overview)
    monkeypatch.setattr(mod.school_billing, "api_invoices", invoices)
    monkeypatch.setattr(mod.school_billing, "api_ledger", ledger)
    app = FastAPI()
    app.include_router(router, prefix=BASE)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[_get_current_user_lazy] = lambda: state["user"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _as(state, people, who):
    state["user"] = _public(people[who])


async def _start(client, org, reason="customer asked about an invoice"):
    res = await client.post(f"{BASE}/view-as", json={"org_id": org.id, "reason": reason})
    assert res.status_code == 200, res.text
    return res.json()["grant"]


async def _open(client, org, page, grant):
    return await client.get(f"{BASE}/view-as/{org.id}/{page}", headers={"X-View-As-Grant": grant})


class TestStart:
    async def test_needs_a_real_reason_and_a_real_school(self, client, org):
        assert (await client.post(f"{BASE}/view-as", json={"org_id": org.id, "reason": "hi"})).status_code == 422
        assert (await client.post(f"{BASE}/view-as", json={"org_id": 99999, "reason": "looking around"})).status_code == 404

    async def test_non_staff_are_refused(self, client, state, people, org):
        _as(state, people, "nobody")
        assert (await client.post(f"{BASE}/view-as", json={"org_id": org.id, "reason": "let me in please"})).status_code == 403

    async def test_start_is_audited_with_the_reason(self, client, db, org, people):
        await _start(client, org, "invoice dispute 4411")
        row = (await db.execute(select(AuditLog).where(AuditLog.action == "superadmin.view_as.start"))).scalars().one()
        assert row.org_id == org.id and row.user_id == people["support"].id and row.payload["reason"] == "invoice dispute 4411"


class TestPages:
    async def test_support_and_finance_see_the_money_pages(self, client, state, people, org):
        for who in ("support", "finance"):
            _as(state, people, who)
            grant = await _start(client, org)
            billing = (await _open(client, org, "billing", grant)).json()
            assert billing["plan"] == "growth" and "public_key" not in billing, "payment keys never leave the school view"
            assert (await _open(client, org, "invoices", grant)).json()[0]["number"] == "INV-1"
            assert (await _open(client, org, "ledger", grant)).json()[0]["amount_cents"] == 500

    async def test_members_page(self, client, db, org, people):
        from src.db.user_organizations import UserOrganization

        db.add(UserOrganization(user_id=people["nobody"].id, org_id=org.id, role_id=3, creation_date="now", update_date="now"))
        await db.commit()
        grant = await _start(client, org)
        members = (await _open(client, org, "members", grant)).json()
        assert [m["username"] for m in members] == ["nobody"] and members[0]["role_id"] == 3

    async def test_every_page_view_is_logged(self, client, db, org):
        grant = await _start(client, org)
        await _open(client, org, "billing", grant)
        await _open(client, org, "invoices", grant)
        rows = (await db.execute(select(AuditLog).where(AuditLog.action == "superadmin.view_as.page").order_by(AuditLog.id))).scalars().all()
        assert [r.payload["after"]["page"] for r in rows] == ["billing", "invoices"]


class TestGrantRules:
    async def test_no_grant_or_a_garbage_grant_gets_nothing(self, client, org):
        assert (await client.get(f"{BASE}/view-as/{org.id}/billing")).status_code == 401
        assert (await _open(client, org, "billing", "nonsense")).status_code == 401

    async def test_grant_is_for_one_school_only(self, client, org):
        grant = await _start(client, org)
        assert (await client.get(f"{BASE}/view-as/{org.id + 1}/billing", headers={"X-View-As-Grant": grant})).status_code == 403

    async def test_grant_belongs_to_the_person_who_started_it(self, client, state, people, org):
        grant = await _start(client, org)
        _as(state, people, "finance")
        res = await _open(client, org, "billing", grant)
        assert res.status_code == 403

    async def test_grants_expire(self, client, org, people):
        expired = jwt.encode(
            {"typ": "view_as", "sub": str(people["support"].id), "org": org.id, "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
            SECRET_KEY, algorithm=ALGORITHM,
        )
        res = await _open(client, org, "billing", expired)
        assert res.status_code == 401 and "expired" in res.json()["detail"]

    async def test_other_kinds_of_token_do_not_work_as_a_grant(self, client, org, people):
        login_like = jwt.encode(
            {"sub": str(people["support"].id), "org": org.id, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
            SECRET_KEY, algorithm=ALGORITHM,
        )
        assert (await _open(client, org, "billing", login_like)).status_code == 403
