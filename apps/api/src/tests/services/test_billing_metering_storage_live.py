"""Storage (W4b) and live-class (W4c) metering and enforcement.

Rules under test (pricing-implementation.md §0, §5):
  * shadow logs but allows; enforce refuses with the exact §4.4 error code;
  * a class already in progress is never cut off or refused;
  * a finished class is counted once;
  * time past the plan allowance comes out of purchased hour packs;
  * the nightly scan writes a snapshot; metering errors never block uploads.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.billing import (
    EnforcementFlag,
    OrgAddon,
    PackBalance,
    StorageSnapshot,
    UsageCounter,
)
from src.db.live_sessions import LiveSession, LiveSessionStatus
from src.db.organization_config import OrganizationConfig
from src.security.features_utils import entitlements as ent_mod
from src.services.billing import storage_meter
from src.services.billing.catalog_defaults import GB, HOUR
from src.services.live import sessions

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def saas(monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "saas")
    monkeypatch.setattr(ent_mod, "_redis", lambda: None)


class _FakeRedis:
    def __init__(self):
        self.store = {}

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value, nx=False, **_):
        if nx and key in self.store:
            return False
        self.store[key] = str(value)
        return True

    def exists(self, key):
        return key in self.store

    def incrby(self, key, amount):
        self.store[key] = str(int(self.store.get(key, 0)) + amount)


@pytest.fixture
def fake_redis(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(storage_meter, "_redis", lambda: fake)
    return fake


async def _plan(db, org_id, plan="starter"):
    db.add(OrganizationConfig(org_id=org_id, config={"config_version": "2.0", "plan": plan}))
    await db.commit()


async def _mode(db, metric, mode):
    db.add(EnforcementFlag(metric=metric, mode=mode))
    await db.commit()


# ── Storage ──────────────────────────────────────────────────────────────────

async def test_storage_shadow_allows_over_limit(db, org, fake_redis):
    await _plan(db, org.id)  # Starter: 1 GB, storage defaults to shadow
    fake_redis.store[f"storage_used:{org.id}"] = str(GB)
    assert await storage_meter.check_upload(org.org_uuid, 10, db) == org.id


async def test_storage_enforce_blocks_with_402(db, org, fake_redis):
    await _plan(db, org.id)
    await _mode(db, "storage", "enforce")
    fake_redis.store[f"storage_used:{org.id}"] = str(GB - 5)
    with pytest.raises(HTTPException) as exc:
        await storage_meter.check_upload(org.org_uuid, 10, db)
    assert exc.value.status_code == 402
    assert exc.value.detail["error_code"] == "storage_quota_exceeded"
    # Within the allowance is fine.
    assert await storage_meter.check_upload(org.org_uuid, 5, db) == org.id


async def test_storage_falls_back_to_snapshot_and_seeds_counter(db, org, fake_redis):
    await _plan(db, org.id)
    await _mode(db, "storage", "enforce")
    db.add(StorageSnapshot(org_id=org.id, bytes=GB))
    await db.commit()
    with pytest.raises(HTTPException):
        await storage_meter.check_upload(org.org_uuid, 1, db)
    assert fake_redis.store[f"storage_used:{org.id}"] == str(GB)
    storage_meter.note_upload(org.id, 100)
    assert fake_redis.store[f"storage_used:{org.id}"] == str(GB + 100)


async def test_metering_error_never_blocks_upload(db, org, fake_redis):
    await _plan(db, org.id)
    with patch("src.security.features_utils.entitlements.check", AsyncMock(side_effect=RuntimeError("db down"))):
        assert await storage_meter.check_upload(org.org_uuid, 10, db) is None


async def test_storage_not_metered_when_self_hosted(db, org, monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "ee")
    assert await storage_meter.check_upload(org.org_uuid, 10**12, db) is None


async def test_upload_content_refuses_before_writing(db, org, monkeypatch, tmp_path):
    from src.services.utils import upload_content as uc

    monkeypatch.chdir(tmp_path)
    blocked = HTTPException(status_code=402, detail={"error_code": "storage_quota_exceeded"})
    with patch("src.services.billing.storage_meter.check_upload", AsyncMock(side_effect=blocked)):
        with pytest.raises(HTTPException):
            await uc.upload_content("images", "orgs", org.org_uuid, b"x" * 10, "a.png")
    assert not (tmp_path / "content" / "orgs" / org.org_uuid / "images" / "a.png").exists()


async def test_scan_writes_snapshot_and_resets_counter(db, org, fake_redis, monkeypatch):
    monkeypatch.setattr(storage_meter, "measure_org_bytes", lambda uuid: 12345)
    fake_redis.store[f"storage_used:{org.id}"] = "999999"
    result = await storage_meter.run_storage_scan(db)
    assert result["scanned"] >= 1
    snap = (await db.execute(select(StorageSnapshot).where(StorageSnapshot.org_id == org.id))).scalars().one()
    assert snap.bytes == 12345 and snap.source == "scan"
    assert fake_redis.store[f"storage_used:{org.id}"] == "12345"


def test_filesystem_measure(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    d = tmp_path / "content" / "orgs" / "org_x" / "videos"
    d.mkdir(parents=True)
    (d / "a.mp4").write_bytes(b"a" * 300)
    (d / "b.mp4").write_bytes(b"b" * 200)
    assert storage_meter._filesystem_bytes("org_x") == 500


# ── Live ─────────────────────────────────────────────────────────────────────

_n = 0


async def _session(db, org, course, status=LiveSessionStatus.SCHEDULED, **kw):
    global _n
    _n += 1
    s = LiveSession(
        session_uuid=f"livesession_{_n}", org_id=org.id, course_id=course.id,
        instructor_id=None, title="Class", livekit_room_name=f"vb-live-{_n}",
        status=status, scheduled_at=datetime.now(timezone.utc), **kw,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


async def test_live_concurrency_enforced(db, org, course):
    await _plan(db, org.id)  # Starter: 1 simultaneous class
    await _mode(db, "live_concurrency", "enforce")
    await _session(db, org, course, status=LiveSessionStatus.LIVE)
    new = await _session(db, org, course)
    with pytest.raises(HTTPException) as exc:
        await sessions.check_live_allowance(db, new)
    assert exc.value.status_code == 403
    assert exc.value.detail["error_code"] == "live_concurrency_limit"


async def test_live_concurrency_shadow_allows(db, org, course):
    await _plan(db, org.id)
    await _session(db, org, course, status=LiveSessionStatus.LIVE)
    await sessions.check_live_allowance(db, await _session(db, org, course))


async def test_live_hours_exhausted(db, org, course):
    await _plan(db, org.id)  # Starter: 2 h
    await _mode(db, "live_seconds", "enforce")
    from src.db.billing._common import current_period

    db.add(UsageCounter(org_id=org.id, metric="live_seconds", period=current_period(), used=2 * HOUR))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await sessions.check_live_allowance(db, await _session(db, org, course))
    assert exc.value.status_code == 402
    assert exc.value.detail["error_code"] == "live_hours_exhausted"


async def test_live_unlimited_skips_hours(db, org, course):
    await _plan(db, org.id, "growth")
    await _mode(db, "live_seconds", "enforce")
    from src.db.billing._common import current_period

    db.add(UsageCounter(org_id=org.id, metric="live_seconds", period=current_period(), used=999 * HOUR))
    db.add(OrgAddon(org_id=org.id, addon="live_unlimited", quantity=1))
    await db.commit()
    await sessions.check_live_allowance(db, await _session(db, org, course))


async def test_class_in_progress_is_never_refused(db, org, course):
    """start_session returns before the gate for an already-open session."""
    await _plan(db, org.id)
    live = await _session(db, org, course, status=LiveSessionStatus.LIVE)
    gate = AsyncMock(side_effect=AssertionError("gate must not run"))
    with patch.object(sessions, "check_live_allowance", gate), \
         patch.object(sessions, "_require_user", lambda u: u), \
         patch.object(sessions, "_require_staff", AsyncMock()):
        out = await sessions.start_session(None, db, SimpleNamespace(id=1), live.session_uuid)
    assert out.status == LiveSessionStatus.LIVE
    gate.assert_not_awaited()


async def test_finalize_records_usage_exactly_once(db, org, course, monkeypatch):
    await _plan(db, org.id)
    now = datetime.now(timezone.utc)
    s = await _session(
        db, org, course, status=LiveSessionStatus.ENDED,
        started_at=now - timedelta(minutes=30), ended_at=now,
    )
    for name in ("recompute_session",):
        monkeypatch.setattr(sessions, name, AsyncMock())
    monkeypatch.setattr("src.services.live.recordings.stop_recordings_for", AsyncMock())
    monkeypatch.setattr(sessions, "get_livekit_settings", lambda: None)
    monkeypatch.setattr("src.services.live.classroom.close_open_interactions", AsyncMock())
    monkeypatch.setattr("src.services.live.reporting.emit_session_finished", AsyncMock())

    assert await sessions.finalize_session(db, s, "test") is True
    assert await sessions.finalize_session(db, s, "test") is False  # second call no-op
    rows = (await db.execute(select(UsageCounter).where(UsageCounter.metric == "live_seconds"))).scalars().all()
    assert len(rows) == 1 and rows[0].used == 30 * 60


async def test_overflow_comes_out_of_packs(db, org, course):
    await _plan(db, org.id)  # Starter: 2 h allowance
    from src.db.billing._common import current_period

    now = datetime.now(timezone.utc)
    db.add(UsageCounter(org_id=org.id, metric="live_seconds", period=current_period(now), used=int(1.5 * HOUR)))
    db.add(PackBalance(org_id=org.id, kind="live_seconds", remaining=10 * HOUR))
    await db.commit()
    s = await _session(db, org, course, status=LiveSessionStatus.COMPLETED,
                       started_at=now - timedelta(hours=1), ended_at=now)

    recorded = await sessions.record_live_usage(db, s)
    # 0.5 h fits the allowance; the other 0.5 h is paid from the pack.
    assert recorded == int(0.5 * HOUR)
    pack = (await db.execute(select(PackBalance))).scalars().one()
    assert pack.remaining == 10 * HOUR - int(0.5 * HOUR)
    ent = await ent_mod.get_entitlements(org.id, db, use_cache=False)
    used = await ent_mod.get_usage(org.id, "live_seconds", db)
    # Time left = allowance + packs − used = 2 + 9.5 − 2 = 9.5 h (no double count).
    assert ent_mod._limit_for(ent, "live_seconds") - used == int(9.5 * HOUR)


async def test_overflow_without_packs_is_recorded_in_full(db, org, course):
    await _plan(db, org.id)
    now = datetime.now(timezone.utc)
    s = await _session(db, org, course, status=LiveSessionStatus.COMPLETED,
                       started_at=now - timedelta(hours=3), ended_at=now)
    assert await sessions.record_live_usage(db, s) == 3 * HOUR


async def test_live_not_metered_when_self_hosted(db, org, course, monkeypatch):
    monkeypatch.setenv("VALIDBRIDGE_DEPLOYMENT_MODE", "ee")
    now = datetime.now(timezone.utc)
    s = await _session(db, org, course, status=LiveSessionStatus.COMPLETED,
                       started_at=now - timedelta(hours=3), ended_at=now)
    assert await sessions.record_live_usage(db, s) == 0
    await sessions.check_live_allowance(db, s)
