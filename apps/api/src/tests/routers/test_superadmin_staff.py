"""Platform staff tiers (owner, support, finance), staff management, and the audit viewer."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLog
from src.db.users import AnonymousUser, PublicUser, SuperadminAPITokenUser, User
from src.routers.superadmin import router as superadmin_router
from src.routers.superadmin_billing import router as billing_router
from src.routers.superadmin_orgs import router as orgs_router
from src.routers.superadmin_staff import router as staff_router
from src.security.staff import CAPABILITIES, capabilities_of, staff_role_of
from src.security.superadmin import _get_current_user_lazy, is_user_superadmin
from src.services.audit.superadmin_audit import record_superadmin_action

BASE = "/api/v1/ee/superadmin"


def _public(u: User) -> PublicUser:
    return PublicUser(id=u.id, username=u.username, first_name=u.first_name, last_name=u.last_name, email=u.email, user_uuid=u.user_uuid)


async def _user(db, uid, name, **flags):
    u = User(id=uid, username=name, first_name=name.title(), last_name="Staff", email=f"{name}@test.com", password="x",
             user_uuid=f"user_{name}", creation_date="now", update_date="now", **flags)
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
async def people(db, org):
    return {
        "owner": await _user(db, 1, "owner", is_superadmin=True),
        "support": await _user(db, 2, "support", platform_role="support"),
        "finance": await _user(db, 3, "finance", platform_role="finance"),
        "nobody": await _user(db, 4, "nobody"),
        "target": await _user(db, 5, "target"),
    }


@pytest.fixture
def state(people):
    return {"user": _public(people["owner"])}


@pytest.fixture
def app(db, state):
    application = FastAPI()
    application.include_router(superadmin_router, prefix=BASE)
    application.include_router(orgs_router, prefix=BASE)
    application.include_router(staff_router, prefix=BASE)
    application.include_router(billing_router, prefix="/api/v1/superadmin/billing")
    application.dependency_overrides[get_db_session] = lambda: db
    application.dependency_overrides[_get_current_user_lazy] = lambda: state["user"]
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _as(state, people, who):
    state["user"] = _public(people[who])


def _required_capability(route) -> str | None:
    """The capability a route demands, read from the dependency it declares."""
    for dep in route.dependant.dependencies:
        for sub in [dep, *dep.dependencies]:
            name = getattr(sub.call, "__name__", "")
            if name.startswith("require_staff_"):
                return name.removeprefix("require_staff_")
    return None


class TestPolicyTable:
    """Every console route names its capability. This pins the table so a change is deliberate."""

    EXPECTED = {
        ("GET", "/status"): "read", ("GET", "/organizations"): "read", ("GET", "/organizations/{org_id}"): "read", ("GET", "/users"): "read",
        ("GET", "/analytics/global"): "read", ("GET", "/organizations/{org_id}/usage"): "read", ("GET", "/organizations/{org_id}/status"): "read",
        ("POST", "/organizations"): "org_write", ("PUT", "/organizations/{org_id}/plan"): "org_write", ("PUT", "/organizations/{org_id}/settings"): "org_write",
        ("PUT", "/organizations/{org_id}/config"): "org_write", ("PUT", "/organizations/{org_id}/admin_toggles"): "org_write",
        ("POST", "/public-education/applications/{app_id}/approve"): "org_write",
        ("POST", "/organizations/{org_id}/suspend"): "destructive_session", ("POST", "/organizations/{org_id}/unsuspend"): "destructive_session",
        ("DELETE", "/organizations/{org_id}"): "destructive_session", ("POST", "/organizations/{org_id}/delete/prepare"): "destructive_session",
        ("GET", "/tokens/"): "tokens", ("POST", "/tokens/"): "tokens_session", ("DELETE", "/tokens/{token_uuid}"): "tokens_session",
        ("GET", "/staff"): "staff_manage", ("PUT", "/staff/{user_uuid}"): "staff_manage_session", ("POST", "/staff"): "staff_manage_session",
        ("GET", "/audit"): "audit_read", ("GET", "/audit/export"): "audit_read_session",
    }
    BILLING = {
        ("GET", "/orgs/{org_id}"): "billing_read", ("GET", "/orgs/{org_id}/deal"): "billing_read", ("GET", "/report"): "billing_read",
        ("GET", "/catalog"): "billing_read", ("GET", "/enforcement"): "billing_read",
        ("POST", "/orgs/{org_id}/free-trial"): "trial_grant_session",
        ("POST", "/orgs/{org_id}/manual-plan"): "billing_write_session", ("POST", "/orgs/{org_id}/refund"): "billing_write_session",
        ("POST", "/orgs/{org_id}/wallet-adjust"): "billing_write_session", ("POST", "/orgs/{org_id}/invoices/{invoice_id}/mark-paid"): "billing_write_session",
        ("POST", "/orgs/{org_id}/invoices/{invoice_id}/void"): "billing_write_session", ("PUT", "/orgs/{org_id}/deal"): "billing_write_session",
        ("POST", "/orgs/{org_id}/grant-pack"): "billing_write_session", ("POST", "/orgs/{org_id}/override"): "billing_write_session",
        ("PUT", "/enforcement"): "billing_admin_session", ("POST", "/catalog"): "billing_admin_session", ("POST", "/run-cycle"): "billing_admin_session",
    }

    def _routes(self, *routers):
        out = {}
        for router in routers:
            for r in router.routes:
                for m in r.methods - {"HEAD", "OPTIONS"}:
                    out[(m, r.path)] = _required_capability(r)
        return out

    def test_console_routes_need_the_expected_capability(self):
        found = self._routes(superadmin_router, orgs_router, staff_router)
        for key, cap in self.EXPECTED.items():
            assert found.get(key) == cap, (key, found.get(key))

    def test_billing_routes_need_the_expected_capability(self):
        found = self._routes(billing_router)
        for key, cap in self.BILLING.items():
            assert found.get(key) == cap, (key, found.get(key))

    def test_no_console_route_is_left_without_a_capability(self):
        for key, cap in self._routes(superadmin_router, orgs_router, staff_router, billing_router).items():
            assert cap is not None, f"{key} has no capability"

    def test_tiers(self):
        assert capabilities_of("owner") == CAPABILITIES["owner"] and "staff_manage" in capabilities_of("owner")
        for role in ("support", "finance"):
            caps = capabilities_of(role)
            assert {"read", "billing_read", "trial_grant", "audit_read"} <= caps
            assert not caps & {"org_write", "destructive", "tokens", "billing_admin", "staff_manage"}, role
        assert "billing_write" in capabilities_of("finance") and "billing_write" not in capabilities_of("support")
        assert capabilities_of("whatever") == frozenset() and capabilities_of(None) == frozenset()


class TestWhoGetsIn:
    async def test_roles_and_the_unauthorised(self, db, people):
        assert [await staff_role_of(people[n].id, db) for n in ("owner", "support", "finance", "nobody")] == ["owner", "support", "finance", None]

    async def test_limited_staff_never_get_the_all_access_bypass(self, db, org, people):
        from src.security.org_auth import is_org_admin

        assert await is_user_superadmin(people["owner"].id, db) is True
        for who in ("support", "finance"):
            assert await is_user_superadmin(people[who].id, db) is False, "the platform-wide bypass is for owners only"
            assert await is_org_admin(people[who].id, org.id, db) is False, "no school-level admin rights either"

    async def test_status_tells_the_ui_who_is_asking(self, client, state, people):
        expectations = {"owner": True, "support": False, "finance": False}
        for who, is_owner in expectations.items():
            _as(state, people, who)
            body = (await client.get(f"{BASE}/status")).json()
            assert body["is_superadmin"] is is_owner and body["role"] == who
            assert set(body["capabilities"]) == set(CAPABILITIES[who])

    async def test_outsiders_and_anonymous_are_refused(self, client, state, people):
        _as(state, people, "nobody")
        assert (await client.get(f"{BASE}/status")).status_code == 403
        state["user"] = AnonymousUser()
        assert (await client.get(f"{BASE}/status")).status_code == 401

    async def test_a_platform_token_acts_as_an_owner_but_cannot_touch_staff(self, client, state, people):
        state["user"] = SuperadminAPITokenUser(id=999, created_by_user_id=people["owner"].id)
        assert (await client.get(f"{BASE}/status")).status_code == 200
        assert (await client.get(f"{BASE}/staff")).status_code == 200
        res = await client.post(f"{BASE}/staff", json={"email": "target@test.com", "role": "support", "reason": "token trying"})
        assert res.status_code == 403 and "session" in res.json()["detail"]


class TestEnforcement:
    async def test_support_and_finance_can_read_but_not_change_a_school(self, client, state, org, people):
        for who in ("support", "finance"):
            _as(state, people, who)
            assert (await client.get(f"{BASE}/organizations")).status_code == 200
            res = await client.put(f"{BASE}/organizations/{org.id}/plan", json={"plan": "growth"})
            assert res.status_code == 403 and who in res.json()["detail"]
            assert (await client.post(f"{BASE}/organizations/{org.id}/suspend", json={"reason": "no"})).status_code == 403
            assert (await client.get(f"{BASE}/tokens/")).status_code == 403
            assert (await client.get(f"{BASE}/staff")).status_code == 403

    async def test_owner_still_can(self, client, state, org, people):
        assert (await client.get(f"{BASE}/organizations")).status_code == 200
        assert (await client.get(f"{BASE}/staff")).status_code == 200


class TestStaffManagement:
    async def test_owner_grants_and_removes_access_and_it_is_audited(self, client, db, state, people):
        res = await client.post(f"{BASE}/staff", json={"email": "Target@Test.com", "role": "support", "reason": "joined the support team"})
        assert res.status_code == 200 and res.json()["role"] == "support"
        await db.refresh(people["target"])
        assert people["target"].platform_role == "support" and people["target"].is_superadmin is False
        assert await staff_role_of(people["target"].id, db) == "support"

        res = await client.put(f"{BASE}/staff/user_target", json={"role": "finance", "reason": "moved to finance"})
        assert res.json()["role"] == "finance"
        res = await client.put(f"{BASE}/staff/user_target", json={"role": None, "reason": "left the team"})
        assert res.status_code == 200 and res.json()["role"] is None
        await db.refresh(people["target"])
        assert people["target"].platform_role is None

        rows = (await db.execute(select(AuditLog).where(AuditLog.action == "superadmin.staff.role_change").order_by(AuditLog.id))).scalars().all()
        assert [(r.payload["before"]["role"], r.payload["after"]["role"]) for r in rows] == [(None, "support"), ("support", "finance"), ("finance", None)]
        assert all(r.payload["reason"] and r.user_id == people["owner"].id for r in rows)

    async def test_guardrails(self, client, state, people):
        body = {"role": "support", "reason": "testing the rules"}
        assert (await client.put(f"{BASE}/staff/user_owner", json=body)).status_code == 409, "owners are not edited here (and not by themselves)"
        assert (await client.post(f"{BASE}/staff", json={**body, "email": "nobody-here@test.com"})).status_code == 404
        assert (await client.put(f"{BASE}/staff/user_missing", json=body)).status_code == 404
        assert (await client.put(f"{BASE}/staff/user_target", json={"role": "owner", "reason": "promote me"})).status_code == 422, "owner cannot be granted through the API"
        assert (await client.put(f"{BASE}/staff/user_target", json={"role": "support", "reason": "x"})).status_code == 422, "a real reason is required"
        assert (await client.post(f"{BASE}/staff", json={"email": "target@test.com", "role": None, "reason": "no role"})).status_code == 422

    async def test_staff_cannot_manage_staff_or_promote_themselves(self, client, state, people):
        _as(state, people, "support")
        res = await client.put(f"{BASE}/staff/user_support", json={"role": "finance", "reason": "self service"})
        assert res.status_code == 403
        res = await client.post(f"{BASE}/staff", json={"email": "target@test.com", "role": "support", "reason": "support adds a friend"})
        assert res.status_code == 403

    async def test_listing_shows_owners_and_limited_staff_only(self, client, state, people):
        items = (await client.get(f"{BASE}/staff")).json()["items"]
        assert sorted((i["username"], i["role"]) for i in items) == [("finance", "finance"), ("owner", "owner"), ("support", "support")]


class TestAuditViewer:
    @pytest.fixture
    async def history(self, db, org, people):
        await record_superadmin_action(db, people["owner"].id, "org.plan_change", org_id=org.id, reason="upgrade after payment", before={"plan": "starter"}, after={"plan": "growth"})
        await record_superadmin_action(db, people["finance"].id, "billing.manual_plan", org_id=org.id, reason="paid by M-Pesa QK1", after={"plan": "business"}, diff_only=False)
        await record_superadmin_action(db, people["support"].id, "billing.free_trial", org_id=org.id, reason="onboarding trial", after={"plan": "growth"}, diff_only=False)
        db.add(AuditLog(user_id=people["nobody"].id, username="nobody", method="POST", path="/api/v1/courses/", action="course.create", resource="course", status_code=200))
        await db.commit()

    async def test_owner_and_support_read_all_actions_finance_only_the_money(self, client, state, people, history):
        actions = lambda body: sorted(i["action"] for i in body["items"])  # noqa: E731
        everything = ["superadmin.billing.free_trial", "superadmin.billing.manual_plan", "superadmin.org.plan_change"]
        for who in ("owner", "support"):
            _as(state, people, who)
            assert actions((await client.get(f"{BASE}/audit")).json()) == everything, who
        _as(state, people, "finance")
        body = (await client.get(f"{BASE}/audit")).json()
        assert actions(body) == ["superadmin.billing.free_trial", "superadmin.billing.manual_plan"] and body["role"] == "finance"
        assert (await client.get(f"{BASE}/audit?action=plan_change")).json()["total"] == 0, "finance cannot reach non-money rows by searching"

    async def test_rows_show_who_what_why_and_the_change(self, client, history, org):
        item = (await client.get(f"{BASE}/audit?action=org.plan_change")).json()["items"][0]
        assert item["actor"] == "owner" and item["org_name"] == org.name and item["reason"] == "upgrade after payment"
        assert item["before"] == {"plan": "starter"} and item["after"] == {"plan": "growth"}

    async def test_filters_and_paging(self, client, history, org, people):
        assert (await client.get(f"{BASE}/audit?actor=fin")).json()["total"] == 1
        assert (await client.get(f"{BASE}/audit?org_id={org.id}")).json()["total"] == 3
        assert (await client.get(f"{BASE}/audit?org_id=9999")).json()["total"] == 0
        assert (await client.get(f"{BASE}/audit?q=billing")).json()["total"] == 2
        assert (await client.get(f"{BASE}/audit?q=%25")).json()["total"] == 0, "a % in the search box is not a wildcard"
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        assert (await client.get(f"{BASE}/audit", params={"since": future})).json()["total"] == 0
        page = (await client.get(f"{BASE}/audit?limit=2&page=2")).json()
        assert page["total"] == 3 and len(page["items"]) == 1

    async def test_raw_request_logs_are_for_owners(self, client, state, people, history):
        raw = (await client.get(f"{BASE}/audit?kind=requests")).json()
        assert [i["action"] for i in raw["items"]] == ["course.create"]
        _as(state, people, "support")
        assert (await client.get(f"{BASE}/audit?kind=requests")).status_code == 403
        _as(state, people, "nobody")
        assert (await client.get(f"{BASE}/audit")).status_code == 403

    async def test_export_is_csv_safe_and_itself_audited(self, client, db, state, people, history, org):
        await record_superadmin_action(db, people["owner"].id, "note", org_id=org.id, reason="=HYPERLINK(\"http://evil\")", diff_only=False)
        res = await client.get(f"{BASE}/audit/export")
        assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
        lines = res.text.splitlines()
        assert lines[0] == "time,actor,action,school,reference,reason,before,after,ip"
        assert "'=HYPERLINK" in res.text and ",=HYPERLINK" not in res.text, "spreadsheet formulas are neutralised"
        logged = (await db.execute(select(AuditLog).where(AuditLog.action == "superadmin.audit.export"))).scalars().all()
        assert len(logged) == 1 and logged[0].user_id == people["owner"].id
        _as(state, people, "finance")
        assert "course.create" not in (await client.get(f"{BASE}/audit/export")).text
