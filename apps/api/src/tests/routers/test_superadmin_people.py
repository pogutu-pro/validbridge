"""Platform search, people profiles, and the owner-only account actions."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLog
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.routers import superadmin_people as mod
from src.routers.superadmin_people import router
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
        "nobody": await _user(db, 4, "nobody"),
        "kemi": await _user(db, 5, "kemi", locked_until="2999-01-01T00:00:00+00:00", failed_login_attempts=5),
    }


@pytest.fixture
def state(people):
    return {"user": _public(people["owner"])}


@pytest.fixture
async def client(db, state):
    app = FastAPI()
    app.include_router(router, prefix=BASE)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[_get_current_user_lazy] = lambda: state["user"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


class TestSearch:
    async def test_finds_people_and_schools(self, client, org):
        res = (await client.get(f"{BASE}/search", params={"q": "kemi"})).json()
        assert [p["username"] for p in res["people"]] == ["kemi"] and res["orgs"] == []
        res = (await client.get(f"{BASE}/search", params={"q": org.slug[:3]})).json()
        assert any(o["id"] == org.id for o in res["orgs"])

    async def test_short_queries_and_wildcards_find_nothing(self, client):
        assert (await client.get(f"{BASE}/search", params={"q": "k"})).json() == {"people": [], "orgs": []}
        assert (await client.get(f"{BASE}/search", params={"q": "%%"})).json()["people"] == []

    async def test_non_staff_are_refused(self, client, state, people):
        state["user"] = _public(people["nobody"])
        assert (await client.get(f"{BASE}/search", params={"q": "kemi"})).status_code == 403


class TestProfile:
    async def test_shows_status_schools_and_history(self, client, db, org, people):
        db.add(UserOrganization(user_id=people["kemi"].id, org_id=org.id, role_id=3, creation_date="now", update_date="now"))
        await db.commit()
        await client.post(f"{BASE}/people/user_kemi/unlock", json={"reason": "locked out after exam week"})
        profile = (await client.get(f"{BASE}/people/user_kemi")).json()
        assert profile["email"] == "kemi@test.com" and profile["locked"] is False and profile["staff_role"] is None
        assert [m["org_id"] for m in profile["memberships"]] == [org.id]
        assert [h["action"] for h in profile["history"]] == ["superadmin.people.unlock"]
        assert "password" not in profile

    async def test_unknown_person(self, client):
        assert (await client.get(f"{BASE}/people/user_ghost")).status_code == 404

    async def test_locked_state_is_reported(self, client):
        assert (await client.get(f"{BASE}/people/user_kemi")).json()["locked"] is True

    async def test_support_can_read_profiles(self, client, state, people):
        state["user"] = _public(people["support"])
        assert (await client.get(f"{BASE}/people/user_kemi")).status_code == 200


class TestActions:
    async def test_unlock_clears_the_lockout_and_is_audited(self, client, db, people):
        res = await client.post(f"{BASE}/people/user_kemi/unlock", json={"reason": "locked out after exam week"})
        assert res.status_code == 200
        await db.refresh(people["kemi"])
        assert people["kemi"].locked_until is None and people["kemi"].failed_login_attempts == 0
        row = (await db.execute(select(AuditLog).where(AuditLog.action == "superadmin.people.unlock"))).scalars().one()
        assert row.resource_id == "user_kemi" and row.payload["before"]["failed_login_attempts"] == 5

    async def test_verify_email(self, client, db, people):
        assert (await client.post(f"{BASE}/people/user_kemi/verify-email", json={"reason": "no access to the inbox"})).status_code == 200
        await db.refresh(people["kemi"])
        assert people["kemi"].email_verified is True

    async def test_sign_out_revokes_sessions(self, client, people, monkeypatch):
        seen = []
        monkeypatch.setattr(mod, "revoke_user_sessions_before", lambda uid: seen.append(uid) or True)
        assert (await client.post(f"{BASE}/people/user_kemi/sign-out", json={"reason": "lost laptop reported"})).status_code == 200
        assert seen == [people["kemi"].id]

    async def test_sign_out_reports_failure_instead_of_pretending(self, client, db, monkeypatch):
        monkeypatch.setattr(mod, "revoke_user_sessions_before", lambda uid: False)
        assert (await client.post(f"{BASE}/people/user_kemi/sign-out", json={"reason": "lost laptop reported"})).status_code == 503
        rows = (await db.execute(select(AuditLog).where(AuditLog.action == "superadmin.people.sign_out"))).scalars().all()
        assert rows == [], "nothing is logged as done when it was not"

    async def test_actions_need_a_reason(self, client):
        assert (await client.post(f"{BASE}/people/user_kemi/unlock", json={"reason": "no"})).status_code == 422

    async def test_support_cannot_act(self, client, state, people):
        state["user"] = _public(people["support"])
        for action in ("unlock", "sign-out", "verify-email"):
            res = await client.post(f"{BASE}/people/user_kemi/{action}", json={"reason": "support trying it"})
            assert res.status_code == 403, action
