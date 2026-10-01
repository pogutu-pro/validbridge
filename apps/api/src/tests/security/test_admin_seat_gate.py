"""Tests for admin-seat limit enforcement on role changes.

Regression guard: previously an org could exceed its plan's admin-seat cap
because no role-grant path called the seat check (check_admin_seat_limit had
zero callers).
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.security.features_utils import usage
from src.security.features_utils.usage import (
    _role_grants_dashboard_access,
    enforce_admin_seat_limit_for_role_change,
    enforce_admin_seat_limit_for_role_rights_change,
)


def _role(action_access, role_id=1):
    return SimpleNamespace(id=role_id, rights={"dashboard": {"action_access": action_access}})


def test_role_grants_dashboard_access():
    assert _role_grants_dashboard_access(_role(True)) is True
    assert _role_grants_dashboard_access(_role(False)) is False
    assert _role_grants_dashboard_access(SimpleNamespace(rights={})) is False
    assert _role_grants_dashboard_access(SimpleNamespace(rights=None)) is False
    assert _role_grants_dashboard_access(None) is False


def test_role_grants_dashboard_access_pydantic_model_rights():
    # rights as a model with model_dump() -> dict.
    class _Rights:
        def model_dump(self):
            return {"dashboard": {"action_access": True}}

    assert _role_grants_dashboard_access(SimpleNamespace(rights=_Rights())) is True


def test_role_grants_dashboard_access_unparseable_rights():
    # A rights object whose model_dump() raises falls back to False.
    class _BadRights:
        def model_dump(self):
            raise RuntimeError("boom")

    assert _role_grants_dashboard_access(SimpleNamespace(rights=_BadRights())) is False


def _db_returning(*objs):
    """AsyncSession whose execute() returns the given objects in call order."""
    def _result(obj):
        return SimpleNamespace(scalars=lambda o=obj: SimpleNamespace(first=lambda: o))

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[_result(o) for o in objs])
    return db


@pytest.mark.asyncio
async def test_demotion_never_checks_limit():
    # Assigning a non-dashboard role must never be blocked.
    check = AsyncMock()
    with patch.object(usage, "check_admin_seat_limit", check):
        await enforce_admin_seat_limit_for_role_change(1, 2, _role(False), AsyncMock())
    check.assert_not_awaited()


@pytest.mark.asyncio
async def test_admin_to_admin_swap_not_blocked():
    # User already holds an admin seat → moving to another admin role adds none.
    membership = SimpleNamespace(role_id=5)
    current_role = _role(True, role_id=5)
    db = _db_returning(membership, current_role)
    check = AsyncMock()
    with patch.object(usage, "check_admin_seat_limit", check), \
         patch.object(usage, "_get_org_config", AsyncMock(return_value=object())):
        await enforce_admin_seat_limit_for_role_change(1, 2, _role(True, role_id=6), db)
    check.assert_not_awaited()


@pytest.mark.asyncio
async def test_promotion_from_member_checks_limit():
    # User currently holds a non-admin role → promoting consumes a new seat.
    membership = SimpleNamespace(role_id=4)
    current_role = _role(False, role_id=4)
    db = _db_returning(membership, current_role)
    check = AsyncMock()
    with patch.object(usage, "check_admin_seat_limit", check), \
         patch.object(usage, "_get_org_config", AsyncMock(return_value=object())):
        await enforce_admin_seat_limit_for_role_change(1, 2, _role(True, role_id=1), db)
    check.assert_awaited_once()


@pytest.mark.asyncio
async def test_new_membership_admin_role_checks_limit():
    # No existing membership (brand-new admin) → net-new seat, check runs.
    db = _db_returning(None)
    check = AsyncMock()
    with patch.object(usage, "check_admin_seat_limit", check), \
         patch.object(usage, "_get_org_config", AsyncMock(return_value=object())):
        await enforce_admin_seat_limit_for_role_change(1, 99, _role(True), db)
    check.assert_awaited_once()


# ---- role-rights flip (dashboard.action_access false -> true) ---------------

def _rights_db(holder_count):
    db = AsyncMock()
    db.execute = AsyncMock(return_value=SimpleNamespace(scalar_one=lambda: holder_count))
    return db


@pytest.mark.asyncio
async def test_rights_flip_noop_when_not_a_true_transition():
    # Turning dashboard access OFF, or leaving it ON, never blocks.
    db = _rights_db(50)
    with patch.object(usage, "_is_non_saas", return_value=False):
        await enforce_admin_seat_limit_for_role_rights_change(
            1, 5, will_grant_dashboard=False, currently_grants_dashboard=False, db_session=db
        )
        await enforce_admin_seat_limit_for_role_rights_change(
            1, 5, will_grant_dashboard=True, currently_grants_dashboard=True, db_session=db
        )
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_rights_flip_noop_on_non_saas():
    db = _rights_db(50)
    with patch.object(usage, "_is_non_saas", return_value=True):
        await enforce_admin_seat_limit_for_role_rights_change(
            1, 5, will_grant_dashboard=True, currently_grants_dashboard=False, db_session=db
        )
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_rights_flip_gates_every_holder_as_a_new_seat():
    # A role held by 5 members gaining dashboard access creates 5 seats at once.
    gate = AsyncMock()
    with patch.object(usage, "_is_non_saas", return_value=False), \
         patch.object(usage, "_enforce_instructor_seats", gate):
        await enforce_admin_seat_limit_for_role_rights_change(
            1, 5, will_grant_dashboard=True, currently_grants_dashboard=False,
            db_session=_rights_db(5),
        )
    gate.assert_awaited_once()
    assert gate.await_args.args[:2] == (1, 5)


# ---- the seat gate itself (entitlements-backed) ----------------------------

def _decision(outcome, limit=1):
    return SimpleNamespace(outcome=outcome, limit=limit)


def _ent(plan):
    return SimpleNamespace(plan=plan)


def _seat_patches(outcome, *, plan="starter", limit=1, current=1, auto_add=False):
    from src.security.features_utils import entitlements

    return [
        patch.object(usage, "_is_non_saas", return_value=False),
        patch.object(usage, "_get_actual_admin_seat_count", AsyncMock(return_value=current)),
        patch.object(entitlements, "check", AsyncMock(return_value=_decision(outcome, limit))),
        patch.object(entitlements, "get_entitlements", AsyncMock(return_value=_ent(plan))),
        patch.object(
            entitlements, "get_active_catalog",
            AsyncMock(return_value=(1, __import__(
                "src.services.billing.catalog_defaults", fromlist=["x"]
            ).build_default_catalog())),
        ),
        patch.object(usage, "_auto_add_seats", AsyncMock(return_value=auto_add)),
    ]


async def _run_gate(patches, new_seats=1):
    from contextlib import ExitStack

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        await usage._enforce_instructor_seats(7, new_seats, AsyncMock())


@pytest.mark.asyncio
async def test_seat_gate_allows_within_allowance_and_in_shadow():
    await _run_gate(_seat_patches("allowed"))
    await _run_gate(_seat_patches("shadow_blocked"))


@pytest.mark.asyncio
async def test_seat_gate_asks_starter_to_upgrade():
    """Starter sells no extra seats: the only way on is an upgrade."""
    with pytest.raises(HTTPException) as exc:
        await _run_gate(_seat_patches("blocked", plan="starter"))
    assert exc.value.status_code == 402
    assert exc.value.detail["error_code"] == "seat_limit_reached"
    assert exc.value.detail["options"] == ["upgrade"]


@pytest.mark.asyncio
async def test_seat_gate_caps_paid_plans_and_offers_a_seat():
    """Paid plans used to be exempt; now Growth is capped at its seats and the
    school is asked to buy one — the card prompt that was missing."""
    with pytest.raises(HTTPException) as exc:
        await _run_gate(_seat_patches("blocked", plan="growth", limit=3, current=3))
    assert exc.value.status_code == 402
    assert exc.value.detail["options"] == ["add_seat", "upgrade"]
    assert exc.value.detail["limit"] == 3 and exc.value.detail["used"] == 3


@pytest.mark.asyncio
async def test_seat_gate_auto_adds_seats_when_opted_in():
    await _run_gate(_seat_patches("blocked", plan="growth", limit=3, current=3, auto_add=True))


@pytest.mark.asyncio
async def test_seat_gate_is_off_when_self_hosted():
    check = AsyncMock()
    with patch.object(usage, "_is_non_saas", return_value=True), \
         patch("src.security.features_utils.entitlements.check", check):
        await usage._enforce_instructor_seats(7, 1, AsyncMock())
    check.assert_not_awaited()


@pytest.mark.asyncio
async def test_rights_flip_allows_when_role_held_by_nobody():
    db = _rights_db(0)
    with patch.object(usage, "_is_non_saas", return_value=False):
        await enforce_admin_seat_limit_for_role_rights_change(
            1, 5, will_grant_dashboard=True, currently_grants_dashboard=False, db_session=db
        )  # no raise — assignment is gated separately
