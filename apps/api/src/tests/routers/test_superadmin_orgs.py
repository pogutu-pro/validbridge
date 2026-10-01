"""Superadmin suspend / unsuspend / guarded delete."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.db.organizations import Organization
from src.routers import superadmin_orgs as so
from src.security.org_auth import is_org_member
from src.services.orgs import suspension as svc

pytestmark = pytest.mark.asyncio


@pytest.fixture
def sa(admin_user):
    return SimpleNamespace(id=admin_user.id)


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    monkeypatch.setattr(so, "_invalidate_org_caches", lambda org: None)

    async def no_members(org_id, db):
        return None

    monkeypatch.setattr(so, "_invalidate_members", no_members)


async def _second_org(db):
    o = Organization(id=2, name="School B", slug="school-b", email="b@x.com", org_uuid="org_b",
                     creation_date="x", update_date="x")
    db.add(o)
    await db.commit()
    return o


async def test_suspend_locks_members_out_and_unsuspend_restores(db, org, regular_user, sa):
    assert await is_org_member(regular_user.id, org.id, db)
    await so.api_suspend(org.id, so.SuspendBody(reason="unpaid", message="Contact us"), None, sa, db)
    assert not await is_org_member(regular_user.id, org.id, db)
    status = await so.api_org_status(org.id, sa, db)
    assert status["suspended"] and status["message"] == "Contact us"

    await so.api_unsuspend(org.id, so.Reason(reason="paid now"), None, sa, db)
    assert await is_org_member(regular_user.id, org.id, db)


async def test_delete_requires_suspension_first(db, org, sa):
    b = await _second_org(db)
    with pytest.raises(HTTPException) as exc:
        await so.api_prepare_delete(b.id, so.Reason(reason="closing down"), None, sa, db)
    assert exc.value.status_code == 409


async def test_delete_needs_token_and_exact_slug(db, org, sa):
    b = await _second_org(db)
    await so.api_suspend(b.id, so.SuspendBody(reason="closing"), None, sa, db)
    prep = await so.api_prepare_delete(b.id, so.Reason(reason="closing down"), None, sa, db)

    for token, slug in (("bogus.sig", "school-b"), (prep["confirm_token"], "School-B")):
        with pytest.raises(HTTPException):
            await so.api_delete(b.id, so.DeleteBody(reason="closing", confirm_token=token,
                                                    confirm_slug=slug), None, sa, db)
    assert await db.get(Organization, b.id) is not None

    out = await so.api_delete(b.id, so.DeleteBody(reason="closing", confirm_token=prep["confirm_token"],
                                                  confirm_slug="school-b"), None, sa, db)
    assert out["status"] == "deleted"
    db.expire_all()
    assert await db.get(Organization, b.id) is None


async def test_token_is_bound_to_org_actor_and_time():
    t = svc.make_delete_token(5, 9, now=1000)
    assert svc.check_delete_token(t, 5, 9, now=1001)
    assert not svc.check_delete_token(t, 6, 9, now=1001)  # other org
    assert not svc.check_delete_token(t, 5, 8, now=1001)  # other superadmin
    assert not svc.check_delete_token(t, 5, 9, now=1000 + svc.CONFIRM_TTL_SECONDS + 1)


async def test_default_and_demo_orgs_cannot_be_deleted(db, org, sa, monkeypatch):
    await so.api_suspend(org.id, so.SuspendBody(reason="x x x"), None, sa, db)
    from config.config import get_validbridge_config

    monkeypatch.setattr(get_validbridge_config().hosting_config, "tenancy", "single")
    with pytest.raises(HTTPException) as exc:
        await so.api_prepare_delete(org.id, so.Reason(reason="oops"), None, sa, db)
    assert exc.value.status_code == 403
