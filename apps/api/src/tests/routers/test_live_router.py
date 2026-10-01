"""Router tests for src/routers/live.py — lifecycle, join tokens, webhooks,
attendance and the reconciler, against real RBAC on the SQLite fixtures."""

import base64
import hashlib
import json
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import jwt
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.live_sessions import (
    LiveRecordingStatus,
    LiveSession,
    LiveSessionParticipant,
    LiveSessionStatus,
)
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroups import UserGroup
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.routers.live import router as live_router, webhook_router
from src.security.auth import get_current_user
from src.services.live.reconciler import reconcile_once

API_KEY = "APIkeyTest"
API_SECRET = "test-livekit-secret-that-is-long-enough-123"
LK_URL = "wss://live.example.test"


@pytest.fixture
def livekit_env(monkeypatch):
    monkeypatch.setenv("LIVEKIT_URL", LK_URL)
    monkeypatch.setenv("LIVEKIT_API_KEY", API_KEY)
    monkeypatch.setenv("LIVEKIT_API_SECRET", API_SECRET)


@pytest.fixture
def lk_calls():
    """Stub LiveKit's RoomService so no network is used."""
    with patch("src.services.live.livekit.create_room", new_callable=AsyncMock) as create, patch(
        "src.services.live.livekit.delete_room", new_callable=AsyncMock
    ) as delete, patch(
        "src.services.live.livekit.list_participants", new_callable=AsyncMock
    ) as listing, patch(
        "src.services.live.livekit.send_data", new_callable=AsyncMock
    ) as send, patch(
        "src.services.live.livekit.update_participant", new_callable=AsyncMock
    ) as update, patch(
        "src.services.live.livekit.mute_published_tracks", new_callable=AsyncMock
    ) as mute, patch(
        "src.services.live.livekit.remove_participant", new_callable=AsyncMock
    ) as remove, patch(
        "src.services.live.livekit.room_exists", new_callable=AsyncMock
    ) as exists, patch(
        # Rate limits / broadcast throttles must not leak between test runs
        # through a developer's real Redis (SQLite ids repeat every run).
        "src.core.redis.get_redis_client", return_value=None
    ):
        listing.return_value = []
        update.return_value = True
        exists.return_value = True
        yield {"create": create, "delete": delete, "list": listing, "send": send,
               "update": update, "mute": mute, "remove": remove, "exists": exists}


@pytest.fixture
def state(admin_user):
    return {"user": admin_user}


@pytest.fixture
def app(db, state):
    application = FastAPI()
    application.include_router(live_router, prefix="/api/v1/live")
    application.include_router(webhook_router, prefix="/api/v1/live")
    application.dependency_overrides[get_db_session] = lambda: db
    application.dependency_overrides[get_current_user] = lambda: state["user"]
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def enrolled(db, org, course, regular_user):
    trail = Trail(org_id=org.id, user_id=regular_user.id, trail_uuid="trail_regular",
                  creation_date="now", update_date="now")
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    db.add(TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id,
                    user_id=regular_user.id, creation_date="now", update_date="now"))
    await db.commit()


async def _create(client, course_uuid="course_test", **extra):
    body = {
        "course_uuid": course_uuid,
        "title": "Week 1 live lecture",
        "scheduled_at": "2026-09-24T09:00:00Z",
        **extra,
    }
    return await client.post("/api/v1/live/sessions", json=body)


async def _load(db, session_uuid) -> LiveSession:
    s = (await db.execute(select(LiveSession).where(LiveSession.session_uuid == session_uuid))).scalars().one()
    await db.refresh(s)
    return s


def _signed(payload: dict) -> tuple[bytes, dict]:
    body = json.dumps(payload).encode()
    token = jwt.encode(
        {
            "iss": API_KEY,
            "exp": int(time.time()) + 300,
            "sha256": base64.b64encode(hashlib.sha256(body).digest()).decode(),
        },
        API_SECRET,
        algorithm="HS256",
    )
    return body, {"Authorization": token, "Content-Type": "application/webhook+json"}


def _participant(identity, sid, role, joined_at):
    return {
        "sid": sid,
        "identity": identity,
        "joinedAt": str(int(joined_at.timestamp())),
        "metadata": json.dumps({"role": role}),
    }


async def _webhook(client, event, room, event_id, created_at, **extra):
    payload = {
        "event": event,
        "id": event_id,
        "createdAt": str(int(created_at.timestamp())),
        "room": {"name": room},
        **extra,
    }
    body, headers = _signed(payload)
    return await client.post("/api/v1/live/webhook", content=body, headers=headers)


# ---------------------------------------------------------------------------
# Scheduling and access
# ---------------------------------------------------------------------------


class TestScheduling:
    async def test_staff_can_schedule(self, client, course, admin_user):
        resp = await _create(client)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "scheduled"
        assert data["recording_status"] == "none"
        assert data["instructor_id"] == admin_user.id
        assert data["session_uuid"].startswith("livesession_")
        assert "livekit_room_name" not in data

    async def test_learner_cannot_schedule(self, client, state, course, regular_user):
        state["user"] = regular_user
        resp = await _create(client)
        assert resp.status_code == 403

    async def test_activity_must_belong_to_course(self, client, activity):
        assert (await _create(client, activity_uuid="activity_nope")).status_code == 404
        assert (await _create(client, activity_uuid=activity.activity_uuid)).status_code == 200

    async def test_list_and_get(self, client, course):
        created = (await _create(client)).json()
        listed = await client.get("/api/v1/live/sessions", params={"course_uuid": "course_test"})
        assert [s["session_uuid"] for s in listed.json()] == [created["session_uuid"]]
        got = await client.get(f"/api/v1/live/sessions/{created['session_uuid']}")
        assert got.json()["title"] == "Week 1 live lecture"

    async def test_unknown_session(self, client):
        assert (await client.get("/api/v1/live/sessions/livesession_missing")).status_code == 404


# ---------------------------------------------------------------------------
# Lifecycle + tokens
# ---------------------------------------------------------------------------


class TestLifecycle:
    async def test_start_requires_livekit_config(self, client, course, monkeypatch):
        monkeypatch.delenv("LIVEKIT_URL", raising=False)
        uuid = (await _create(client)).json()["session_uuid"]
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/start")
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "LIVE_NOT_CONFIGURED"

    async def test_full_flow(self, client, db, state, course, admin_user, regular_user, enrolled, livekit_env, lk_calls):
        uuid = (await _create(client)).json()["session_uuid"]

        # Learners cannot join before start.
        state["user"] = regular_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/join")
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "SESSION_NOT_STARTED"
        # ...nor start it.
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/start")).status_code == 403

        state["user"] = admin_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/start")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ready"
        lk_calls["create"].assert_awaited()
        # Idempotent.
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/start")).json()["status"] == "ready"

        # Instructor token in READY.
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/join")
        assert resp.status_code == 200
        join = resp.json()
        assert set(join) == {"server_url", "token", "expires_at", "role"}
        assert join["server_url"] == LK_URL
        assert join["role"] == "instructor"
        assert API_SECRET not in resp.text
        claims = jwt.decode(join["token"], API_SECRET, algorithms=["HS256"])
        room = (await _load(db, uuid)).livekit_room_name
        assert claims["sub"] == admin_user.user_uuid
        assert claims["iss"] == API_KEY
        assert claims["video"]["room"] == room
        assert claims["video"]["roomJoin"] is True
        assert claims["video"]["canUpdateOwnMetadata"] is False
        assert "screen_share" in claims["video"]["canPublishSources"]
        assert claims["exp"] - time.time() <= 600 + 5

        # Learner still waits: READY is staff-only.
        state["user"] = regular_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/join")
        assert resp.json()["detail"]["code"] == "SESSION_NOT_LIVE"

        # Instructor connects (LiveKit webhook) → LIVE.
        t0 = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=30)
        resp = await _webhook(
            client, "participant_joined", room, "EV_host_join", t0,
            participant=_participant(admin_user.user_uuid, "PA_host", "instructor", t0),
        )
        assert resp.status_code == 200
        assert (await _load(db, uuid)).status == LiveSessionStatus.LIVE

        # Learner token: own identity only, learner grants.
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/join")
        assert resp.status_code == 200
        claims = jwt.decode(resp.json()["token"], API_SECRET, algorithms=["HS256"])
        assert resp.json()["role"] == "learner"
        assert claims["sub"] == regular_user.user_uuid
        assert json.loads(claims["metadata"])["role"] == "learner"
        assert claims["video"]["canPublishData"] is False
        assert "screen_share" not in claims["video"]["canPublishSources"]

        # Learner connects, refreshes (new SID, overlapping), then leaves.
        lj = t0 + timedelta(minutes=5)
        await _webhook(client, "participant_joined", room, "EV_l1", lj,
                       participant=_participant(regular_user.user_uuid, "PA_l1", "learner", lj))
        await _webhook(client, "participant_joined", room, "EV_l2", lj + timedelta(minutes=10),
                       participant=_participant(regular_user.user_uuid, "PA_l2", "learner", lj + timedelta(minutes=10)))
        await _webhook(client, "participant_left", room, "EV_l1_left", lj + timedelta(minutes=10, seconds=20),
                       participant=_participant(regular_user.user_uuid, "PA_l1", "learner", lj))
        # Retried delivery must not double count.
        await _webhook(client, "participant_left", room, "EV_l1_left", lj + timedelta(minutes=10, seconds=20),
                       participant=_participant(regular_user.user_uuid, "PA_l1", "learner", lj))
        await _webhook(client, "participant_left", room, "EV_l2_left", lj + timedelta(minutes=20),
                       participant=_participant(regular_user.user_uuid, "PA_l2", "learner", lj))

        # Attendance is staff-only.
        assert (await client.get(f"/api/v1/live/sessions/{uuid}/attendance")).status_code == 403

        state["user"] = admin_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/end")
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"
        lk_calls["delete"].assert_awaited_with(lk_calls["delete"].await_args.args[0], room)
        # Idempotent.
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/end")).json()["status"] == "completed"

        resp = await client.get(f"/api/v1/live/sessions/{uuid}/attendance")
        assert resp.status_code == 200
        att = resp.json()
        assert att["enrolled_count"] == 1
        assert att["attended_count"] == 1
        learner = next(p for p in att["participants"] if p["role"] == "learner")
        assert learner["duration_seconds"] == 20 * 60
        assert learner["connection_count"] == 2
        assert learner["is_connected"] is False
        host = next(p for p in att["participants"] if p["role"] == "instructor")
        assert host["is_connected"] is False  # closed at ended_at

        # Ended sessions issue no tokens.
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/join")).json()["detail"]["code"] == "SESSION_ENDED"
        # ...and cannot be restarted.
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/start")).status_code == 409


class TestJoinSecurity:
    async def _live_session(self, client, db, **extra):
        uuid = (await _create(client, **extra)).json()["session_uuid"]
        s = await _load(db, uuid)
        s.status = LiveSessionStatus.LIVE
        s.started_at = datetime.now(timezone.utc)
        db.add(s)
        await db.commit()
        return uuid

    async def test_unenrolled_learner_rejected(self, client, db, state, course, regular_user, livekit_env, lk_calls):
        uuid = await self._live_session(client, db)
        state["user"] = regular_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/join")
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "ENROLLMENT_REQUIRED"

    async def test_usergroup_restricted_course_rejected(self, client, db, state, org, regular_user, livekit_env, lk_calls):
        # public=False + a linked usergroup the learner is not in.
        private = Course(id=2, name="Private", public=False, published=True, open_to_contributors=False,
                         org_id=org.id, course_uuid="course_private", creation_date="now", update_date="now")
        group = UserGroup(id=1, name="Cohort A", description="", org_id=org.id, usergroup_uuid="usergroup_a")
        db.add(private)
        db.add(group)
        await db.commit()
        db.add(UserGroupResource(usergroup_id=group.id, resource_uuid="course_private", org_id=org.id))
        await db.commit()
        uuid = await self._live_session(client, db, course_uuid="course_private")
        # Enrollment alone is not enough without course access.
        trail = Trail(org_id=org.id, user_id=regular_user.id, trail_uuid="t", creation_date="now", update_date="now")
        db.add(trail)
        await db.commit()
        await db.refresh(trail)
        db.add(TrailRun(trail_id=trail.id, course_id=private.id, org_id=org.id, user_id=regular_user.id,
                        creation_date="now", update_date="now"))
        await db.commit()

        state["user"] = regular_user
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/join")).status_code == 403
        assert (await client.get(f"/api/v1/live/sessions/{uuid}")).status_code == 403

    async def test_other_org_user_rejected(self, client, db, state, other_org, user_role, livekit_env, lk_calls):
        # A members-only course of org 1; the caller belongs to org 2 only.
        members_only = Course(id=3, name="Members", public=False, published=True, open_to_contributors=False,
                              org_id=1, course_uuid="course_members", creation_date="now", update_date="now")
        outsider = User(id=9, username="outsider", first_name="O", last_name="U", email="o@other.com",
                        password="x", user_uuid="user_outsider", creation_date="now", update_date="now")
        db.add(members_only)
        db.add(outsider)
        await db.commit()
        db.add(UserOrganization(user_id=9, org_id=other_org.id, role_id=user_role.id,
                                creation_date="now", update_date="now"))
        await db.commit()
        uuid = await self._live_session(client, db, course_uuid="course_members")

        state["user"] = PublicUser(id=9, username="outsider", first_name="O", last_name="U",
                                   email="o@other.com", user_uuid="user_outsider")
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/join")).status_code == 403
        assert (await client.get(f"/api/v1/live/sessions/{uuid}")).status_code == 403
        assert (await client.get(f"/api/v1/live/sessions/{uuid}/attendance")).status_code == 403
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/end")).status_code == 403

    async def test_learner_via_linked_activity(self, client, db, state, activity, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live_session(client, db, activity_uuid=activity.activity_uuid)
        state["user"] = regular_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/join")
        assert resp.status_code == 200, resp.text
        assert resp.json()["role"] == "learner"

    async def test_staff_who_is_not_instructor_is_moderator(self, client, db, course, livekit_env, lk_calls):
        uuid = await self._live_session(client, db)
        s = await _load(db, uuid)
        s.instructor_id = None
        db.add(s)
        await db.commit()
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/join")
        assert resp.json()["role"] == "moderator"

    async def test_join_takes_no_identity_input(self, client, db, state, course, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live_session(client, db)
        state["user"] = regular_user
        resp = await client.post(
            f"/api/v1/live/sessions/{uuid}/join",
            json={"identity": "user_admin", "role": "instructor"},
        )
        claims = jwt.decode(resp.json()["token"], API_SECRET, algorithms=["HS256"])
        assert claims["sub"] == regular_user.user_uuid
        assert json.loads(claims["metadata"])["role"] == "learner"


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------


class TestWebhook:
    async def test_rejects_bad_signature(self, client, livekit_env):
        body = json.dumps({"event": "room_finished", "room": {"name": "vb-live-x"}}).encode()
        forged = jwt.encode({"iss": API_KEY, "sha256": "x"}, "wrong-secret-wrong-secret-wrong-secret", algorithm="HS256")
        resp = await client.post("/api/v1/live/webhook", content=body, headers={"Authorization": forged})
        assert resp.status_code == 401
        resp = await client.post("/api/v1/live/webhook", content=body)
        assert resp.status_code == 401

    async def test_rejects_tampered_body(self, client, livekit_env):
        _, headers = _signed({"event": "room_started", "room": {"name": "vb-live-x"}})
        tampered = json.dumps({"event": "room_finished", "room": {"name": "vb-live-x"}}).encode()
        resp = await client.post("/api/v1/live/webhook", content=tampered, headers=headers)
        assert resp.status_code == 401

    async def test_ignores_foreign_rooms(self, client, livekit_env):
        resp = await _webhook(client, "room_finished", "someone-else", "EV_x", datetime.now(timezone.utc))
        assert resp.status_code == 200

    async def test_room_finished_ends_live_session(self, client, db, course, admin_user, livekit_env, lk_calls):
        uuid = (await _create(client)).json()["session_uuid"]
        await client.post(f"/api/v1/live/sessions/{uuid}/start")
        room = (await _load(db, uuid)).livekit_room_name
        now = datetime.now(timezone.utc)
        await _webhook(client, "participant_joined", room, "EV_j", now,
                       participant=_participant(admin_user.user_uuid, "PA", "instructor", now))
        await _webhook(client, "room_finished", room, "EV_f", now + timedelta(minutes=5))
        s = await _load(db, uuid)
        assert s.status == LiveSessionStatus.COMPLETED
        assert s.ended_at is not None

    async def test_recording_holds_session_in_processing(self, client, db, course, chapter, admin_user,
                                                         livekit_env, lk_calls, monkeypatch):
        monkeypatch.setenv("VALIDBRIDGE_LIVE_RECORDING_ENABLED", "true")
        uuid = (await _create(client)).json()["session_uuid"]
        await client.post(f"/api/v1/live/sessions/{uuid}/start")
        room = (await _load(db, uuid)).livekit_room_name
        now = datetime.now(timezone.utc)
        await _webhook(client, "participant_joined", room, "EV_j", now,
                       participant=_participant(admin_user.user_uuid, "PA", "instructor", now))
        with patch("src.services.live.recordings.is_s3_enabled", return_value=True), patch(
            "src.services.live.livekit.start_room_recording", new_callable=AsyncMock, return_value="EG_1"
        ), patch("src.services.live.livekit.stop_egress", new_callable=AsyncMock), patch(
            "src.services.live.livekit.update_room_metadata", new_callable=AsyncMock, return_value=True
        ), patch("src.services.live.recordings._object_size", return_value=1234), patch(
            "src.services.utils.hls_jobs.enqueue"
        ):
            assert (await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")).status_code == 200
            await _webhook(client, "egress_started", "", "EV_e1", now,
                           egressInfo={"egressId": "EG_1", "roomName": room, "status": "EGRESS_ACTIVE"})
            assert (await _load(db, uuid)).recording_status == LiveRecordingStatus.RECORDING

            resp = await client.post(f"/api/v1/live/sessions/{uuid}/end")
            assert resp.json()["status"] == "processing"

            await _webhook(client, "egress_ended", "", "EV_e2", now,
                           egressInfo={"egressId": "EG_1", "roomName": room, "status": "EGRESS_COMPLETE"})
        s = await _load(db, uuid)
        assert s.recording_status == LiveRecordingStatus.READY
        assert s.status == LiveSessionStatus.COMPLETED

    async def test_egress_not_started_by_validbridge_is_ignored(self, client, db, course, admin_user, livekit_env, lk_calls):
        uuid = (await _create(client)).json()["session_uuid"]
        await client.post(f"/api/v1/live/sessions/{uuid}/start")
        room = (await _load(db, uuid)).livekit_room_name
        await _webhook(client, "egress_started", "", "EV_x", datetime.now(timezone.utc),
                       egressInfo={"egressId": "EG_foreign", "roomName": room, "status": "EGRESS_ACTIVE"})
        assert (await _load(db, uuid)).recording_status == LiveRecordingStatus.NONE


# ---------------------------------------------------------------------------
# Reconciler (server restart, missed webhooks, host disconnect, expiry)
# ---------------------------------------------------------------------------


class TestReconciler:
    async def _live(self, client, db, admin_user):
        uuid = (await _create(client)).json()["session_uuid"]
        await client.post(f"/api/v1/live/sessions/{uuid}/start")
        return uuid, (await _load(db, uuid)).livekit_room_name

    async def test_missed_webhooks_are_synthesised(self, client, db, course, admin_user, regular_user, livekit_env, lk_calls):
        uuid, room = await self._live(client, db, admin_user)
        now = datetime.now(timezone.utc)
        # API was down: LiveKit reports people we never heard about.
        lk_calls["list"].return_value = [
            _participant(admin_user.user_uuid, "PA_host", "instructor", now - timedelta(minutes=3)),
            _participant(regular_user.user_uuid, "PA_l", "learner", now - timedelta(minutes=2)),
        ]
        await reconcile_once(db, now=now)
        s = await _load(db, uuid)
        assert s.status == LiveSessionStatus.LIVE

        # Learner's leave webhook was lost; LiveKit no longer lists them.
        lk_calls["list"].return_value = [lk_calls["list"].return_value[0]]
        await reconcile_once(db, now=now + timedelta(minutes=1))
        p = (await db.execute(select(LiveSessionParticipant).where(
            LiveSessionParticipant.session_id == s.id,
            LiveSessionParticipant.user_id == regular_user.id,
        ))).scalars().one()
        await db.refresh(p)
        assert p.is_connected is False
        assert p.duration_seconds == 3 * 60

    async def test_host_disconnect_grace_then_end(self, client, db, course, admin_user, livekit_env, lk_calls):
        uuid, room = await self._live(client, db, admin_user)
        now = datetime.now(timezone.utc)
        await _webhook(client, "participant_joined", room, "EV_j", now,
                       participant=_participant(admin_user.user_uuid, "PA", "instructor", now))
        await _webhook(client, "participant_left", room, "EV_l", now + timedelta(minutes=1),
                       participant=_participant(admin_user.user_uuid, "PA", "instructor", now))

        # Within the grace window the session survives (lecturer may reconnect).
        await reconcile_once(db, now=now + timedelta(minutes=5))
        assert (await _load(db, uuid)).status == LiveSessionStatus.LIVE

        await reconcile_once(db, now=now + timedelta(minutes=20))
        s = await _load(db, uuid)
        assert s.status == LiveSessionStatus.COMPLETED
        lk_calls["delete"].assert_awaited()

    async def test_ready_session_expires(self, client, db, course, admin_user, livekit_env, lk_calls):
        uuid, _ = await self._live(client, db, admin_user)
        await reconcile_once(db, now=datetime.now(timezone.utc) + timedelta(minutes=10))
        assert (await _load(db, uuid)).status == LiveSessionStatus.READY
        await reconcile_once(db, now=datetime.now(timezone.utc) + timedelta(hours=2))
        assert (await _load(db, uuid)).status == LiveSessionStatus.COMPLETED

    async def test_ready_room_is_reprovisioned(self, client, db, course, admin_user, livekit_env, lk_calls):
        await self._live(client, db, admin_user)
        lk_calls["create"].reset_mock()
        lk_calls["exists"].return_value = False  # room vanished (LiveKit restart)
        await reconcile_once(db)
        lk_calls["create"].assert_awaited()

    async def test_teardown_failure_is_retried(self, client, db, course, admin_user, livekit_env, lk_calls):
        from src.services.live.livekit import LiveKitError

        uuid, room = await self._live(client, db, admin_user)
        now = datetime.now(timezone.utc)
        await _webhook(client, "participant_joined", room, "EV_j", now,
                       participant=_participant(admin_user.user_uuid, "PA", "instructor", now))
        lk_calls["delete"].side_effect = LiveKitError("down")
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/end")).json()["status"] == "ended"

        lk_calls["delete"].side_effect = None
        await reconcile_once(db)
        assert (await _load(db, uuid)).status == LiveSessionStatus.COMPLETED


# ---------------------------------------------------------------------------
# Classroom interaction + moderation
# ---------------------------------------------------------------------------


class TestClassroom:
    async def _live(self, client, db):
        uuid = (await _create(client)).json()["session_uuid"]
        s = await _load(db, uuid)
        s.status = LiveSessionStatus.LIVE
        s.started_at = datetime.now(timezone.utc)
        db.add(s)
        await db.commit()
        return uuid

    async def test_classroom_bootstrap(self, client, db, state, course, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live(client, db)
        state["user"] = regular_user
        data = (await client.get(f"/api/v1/live/sessions/{uuid}/classroom")).json()
        assert data["role"] == "learner"
        assert data["user_uuid"] == regular_user.user_uuid
        assert data["course_name"] == "Test Course"
        assert data["media_allowed"] is True

    async def test_chat_roundtrip_and_broadcast(self, client, db, state, course, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live(client, db)
        state["user"] = regular_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/messages", json={"kind": "chat", "body": "  hello  "})
        assert resp.status_code == 200
        msg = resp.json()
        assert msg["body"] == "hello"
        assert msg["author"]["user_uuid"] == regular_user.user_uuid
        topic = lk_calls["send"].await_args.args[2]
        assert topic == "vb.messages"

        listed = (await client.get(f"/api/v1/live/sessions/{uuid}/messages", params={"kind": "chat"})).json()
        assert [m["message_uuid"] for m in listed] == [msg["message_uuid"]]

        # Authors may delete their own messages.
        assert (await client.delete(f"/api/v1/live/sessions/{uuid}/messages/{msg['message_uuid']}")).status_code == 200

    async def test_questions_moderated_by_staff(self, client, db, state, course, admin_user, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live(client, db)
        state["user"] = regular_user
        q = (await client.post(f"/api/v1/live/sessions/{uuid}/messages", json={"kind": "question", "body": "Why?"})).json()
        assert q["status"] == "open"
        path = f"/api/v1/live/sessions/{uuid}/questions/{q['message_uuid']}"
        assert (await client.patch(path, json={"status": "answered"})).status_code == 403
        state["user"] = admin_user
        resp = await client.patch(path, json={"status": "answered"})
        assert resp.json()["status"] == "answered"
        assert resp.json()["answered_at"] is not None

    async def test_chat_requires_live_session(self, client, db, state, course, regular_user, enrolled, livekit_env, lk_calls):
        uuid = (await _create(client)).json()["session_uuid"]  # still scheduled
        state["user"] = regular_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/messages", json={"kind": "chat", "body": "hi"})
        assert resp.status_code == 409

    async def test_unenrolled_cannot_read_chat(self, client, db, state, course, regular_user, livekit_env, lk_calls):
        uuid = await self._live(client, db)
        state["user"] = regular_user
        assert (await client.get(f"/api/v1/live/sessions/{uuid}/messages")).status_code == 403

    async def test_polls(self, client, db, state, course, admin_user, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live(client, db)
        state["user"] = regular_user
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/polls",
                                  json={"question": "Q", "options": ["a", "b"]})).status_code == 403

        state["user"] = admin_user
        poll = (await client.post(f"/api/v1/live/sessions/{uuid}/polls",
                                  json={"question": "Ready?", "options": ["Yes", "No"]})).json()
        assert poll["status"] == "open"

        state["user"] = regular_user
        before = (await client.get(f"/api/v1/live/sessions/{uuid}/polls")).json()[0]
        assert before["counts"] is None  # hidden until voted
        voted = (await client.post(f"/api/v1/live/sessions/{uuid}/polls/{poll['poll_uuid']}/vote",
                                   json={"option_index": 1})).json()
        assert voted["my_vote"] == 1 and voted["counts"] == [0, 1]
        # Changing a vote replaces it.
        voted = (await client.post(f"/api/v1/live/sessions/{uuid}/polls/{poll['poll_uuid']}/vote",
                                   json={"option_index": 0})).json()
        assert voted["counts"] == [1, 0] and voted["total_votes"] == 1
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/polls/{poll['poll_uuid']}/vote",
                                  json={"option_index": 5})).status_code == 422

        state["user"] = admin_user
        closed = (await client.post(f"/api/v1/live/sessions/{uuid}/polls/{poll['poll_uuid']}/close")).json()
        assert closed["status"] == "closed"
        state["user"] = regular_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/polls/{poll['poll_uuid']}/vote", json={"option_index": 1})
        assert resp.json()["detail"]["code"] == "POLL_CLOSED"

    async def test_hand_and_reactions(self, client, db, state, course, admin_user, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live(client, db)
        state["user"] = regular_user
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/hand", json={"raised": True})).status_code == 200
        kwargs = lk_calls["update"].await_args.kwargs
        assert lk_calls["update"].await_args.args[2] == regular_user.user_uuid
        assert kwargs["attributes"]["vb.hand"]
        assert "permission" not in kwargs or kwargs.get("permission") is None

        assert (await client.post(f"/api/v1/live/sessions/{uuid}/reactions", json={"emoji": "👏"})).status_code == 200
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/reactions", json={"emoji": "<script>"})).status_code == 422

        # Learners can't lower someone else's hand.
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/participants/user_admin/lower-hand")).status_code == 403

    async def test_learner_cannot_moderate(self, client, db, state, course, admin_user, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live(client, db)
        state["user"] = regular_user
        base = f"/api/v1/live/sessions/{uuid}/participants/{admin_user.user_uuid}"
        assert (await client.post(f"{base}/mute", json={"source": "microphone"})).status_code == 403
        assert (await client.post(f"{base}/remove")).status_code == 403
        assert (await client.post(f"{base}/media", json={"allowed": False})).status_code == 403
        lk_calls["remove"].assert_not_awaited()

    async def test_nobody_can_moderate_the_instructor(self, client, db, state, course, admin_user, livekit_env, lk_calls):
        uuid = await self._live(client, db)
        # admin is the instructor; moderating yourself is refused too.
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/participants/{admin_user.user_uuid}/remove")
        assert resp.json()["detail"]["code"] == "CANNOT_MODERATE_SELF"

    async def test_mute_revoke_and_remove_learner(self, client, db, state, course, admin_user, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live(client, db)
        base = f"/api/v1/live/sessions/{uuid}/participants/{regular_user.user_uuid}"

        assert (await client.post(f"{base}/mute", json={"source": "microphone"})).status_code == 200
        lk_calls["mute"].assert_awaited()

        assert (await client.post(f"{base}/media", json={"allowed": False})).status_code == 200
        permission = lk_calls["update"].await_args.kwargs["permission"]
        assert permission["can_publish"] is False and permission["can_publish_sources"] == []

        # The revocation survives a rejoin.
        state["user"] = regular_user
        claims = jwt.decode((await client.post(f"/api/v1/live/sessions/{uuid}/join")).json()["token"],
                            API_SECRET, algorithms=["HS256"])
        assert claims["video"]["canPublish"] is False
        assert (await client.get(f"/api/v1/live/sessions/{uuid}/classroom")).json()["media_allowed"] is False

        state["user"] = admin_user
        assert (await client.post(f"{base}/remove")).status_code == 200
        lk_calls["remove"].assert_awaited()

        state["user"] = regular_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/join")
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "REMOVED_FROM_SESSION"
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/messages",
                                  json={"kind": "chat", "body": "back"})).status_code == 403


class TestInvitations:
    @pytest.fixture
    def sent(self):
        with patch("src.services.email.utils.send_email") as send, patch(
            "src.services.email.utils.get_org_signup_base_url",
            new_callable=AsyncMock, return_value="https://school.example.test/",
        ):
            yield send

    async def _drain(self):
        import asyncio
        from src.services.live import invitations

        if invitations._background:
            await asyncio.gather(*list(invitations._background))

    async def test_emails_listed_and_enrolled_students(self, client, lk_calls, livekit_env, enrolled, sent):
        uuid = (await _create(client)).json()["session_uuid"]
        res = await client.post(
            f"/api/v1/live/sessions/{uuid}/invitations",
            json={"emails": ["Guest@Example.com", "admin@test.com"], "all_enrolled": True,
                  "message": "<b>Bring notes</b>"},
        )
        assert res.status_code == 200, res.text
        # Sender is never emailed; addresses are normalised and de-duplicated.
        assert res.json() == {"queued": 2}
        await self._drain()
        recipients = sorted(call.args[0] for call in sent.call_args_list)
        assert recipients == ["guest@example.com", "regular@test.com"]
        subject, body = sent.call_args_list[0].args[1:3]
        assert "Week 1 live lecture" in subject
        short = uuid.removeprefix("livesession_")
        assert f"https://school.example.test/course/test/live/{short}" in body
        assert "calendar.google.com" in body
        assert "&lt;b&gt;Bring notes&lt;/b&gt;" in body and "<b>Bring notes" not in body

    async def test_learners_cannot_invite(self, client, lk_calls, livekit_env, enrolled, state, regular_user, sent):
        uuid = (await _create(client)).json()["session_uuid"]
        state["user"] = regular_user
        res = await client.post(f"/api/v1/live/sessions/{uuid}/invitations", json={"emails": ["a@b.co"]})
        assert res.status_code == 403
        sent.assert_not_called()

    async def test_needs_recipients(self, client, course, lk_calls, livekit_env, sent):
        uuid = (await _create(client)).json()["session_uuid"]
        res = await client.post(f"/api/v1/live/sessions/{uuid}/invitations", json={"emails": []})
        assert res.status_code == 422

    async def test_rejects_invalid_email(self, client, course, lk_calls, livekit_env, sent):
        uuid = (await _create(client)).json()["session_uuid"]
        res = await client.post(f"/api/v1/live/sessions/{uuid}/invitations", json={"emails": ["not-an-email"]})
        assert res.status_code == 422

    async def test_ended_lesson_cannot_invite(self, client, course, lk_calls, livekit_env, sent):
        uuid = (await _create(client)).json()["session_uuid"]
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/start")).status_code == 200
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/end")).status_code == 200
        res = await client.post(f"/api/v1/live/sessions/{uuid}/invitations", json={"emails": ["a@b.co"]})
        assert res.status_code == 409


# ---------------------------------------------------------------------------
# Security hardening + observability
# ---------------------------------------------------------------------------


class TestSecurityHardening:
    async def _live_session(self, client, db, **extra):
        return await TestJoinSecurity._live_session(self, client, db, **extra)

    async def test_anonymous_user_cannot_join_or_look_inside(self, client, db, state, course, anonymous_user, livekit_env, lk_calls):
        uuid = await self._live_session(client, db)
        state["user"] = anonymous_user
        for method, path in [
            ("post", "join"), ("get", "classroom"), ("get", "attendance"), ("get", "messages"), ("post", "start"),
        ]:
            resp = await getattr(client, method)(f"/api/v1/live/sessions/{uuid}/{path}")
            assert resp.status_code == 401, (path, resp.status_code)
            assert "token" not in resp.json()

    async def test_learner_cannot_act_as_lecturer(self, client, db, state, course, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live_session(client, db)
        state["user"] = regular_user
        join = await client.post(f"/api/v1/live/sessions/{uuid}/join")
        assert join.status_code == 200
        video = jwt.decode(join.json()["token"], API_SECRET, algorithms=["HS256"])["video"]
        # No admin/record/create grants, no data channel, cannot rewrite own role,
        # and no screen share for learners.
        for grant in ("roomAdmin", "roomCreate", "roomRecord", "roomList", "ingressAdmin"):
            assert not video.get(grant), grant
        assert video["canPublishData"] is False
        assert video["canUpdateOwnMetadata"] is False
        assert "screen_share" not in video["canPublishSources"]

        staff_only = [
            ("post", "start", None), ("post", "end", None), ("post", "recordings/start", None),
            ("post", "recordings/stop", None), ("post", "stage", {"focus": "camera"}),
            ("post", "polls", {"question": "Q?", "options": ["a", "b"]}),
            ("get", "quiz-sources", None), ("get", "report", None),
            ("post", "invitations", {"emails": ["x@y.co"]}),
            ("post", f"participants/{regular_user.user_uuid}/remove", None),
        ]
        for method, path, body in staff_only:
            url = f"/api/v1/live/sessions/{uuid}/{path}"
            resp = await (client.post(url, json=body) if method == "post" else client.get(url))
            assert resp.status_code == 403, (path, resp.status_code, resp.text)

    async def test_token_is_scoped_to_its_own_session(self, client, db, state, org, course, regular_user, enrolled, livekit_env, lk_calls):
        first = await self._live_session(client, db)
        second = await self._live_session(client, db)
        state["user"] = regular_user
        rooms = []
        for uuid in (first, second):
            token = (await client.post(f"/api/v1/live/sessions/{uuid}/join")).json()["token"]
            rooms.append(jwt.decode(token, API_SECRET, algorithms=["HS256"])["video"]["room"])
            assert rooms[-1] == (await _load(db, uuid)).livekit_room_name
        assert rooms[0] != rooms[1]

    async def test_other_course_session_is_closed_to_learner(self, client, db, state, org, course, admin_user, regular_user, enrolled, livekit_env, lk_calls):
        other = Course(id=3, name="Other", public=True, published=True, open_to_contributors=False,
                       org_id=org.id, course_uuid="course_other", creation_date="now", update_date="now")
        db.add(other)
        await db.commit()
        uuid = await self._live_session(client, db, course_uuid="course_other")
        state["user"] = regular_user
        for method, path in [("post", "join"), ("get", "classroom"), ("get", "messages")]:
            resp = await getattr(client, method)(f"/api/v1/live/sessions/{uuid}/{path}")
            assert resp.status_code == 403, (path, resp.status_code)

    async def test_secret_never_reaches_the_browser(self, client, db, state, course, regular_user, enrolled, livekit_env, lk_calls):
        uuid = await self._live_session(client, db)
        bodies = [
            (await client.get(f"/api/v1/live/sessions/{uuid}")).text,
            (await client.get(f"/api/v1/live/sessions/{uuid}/classroom")).text,
            (await client.post(f"/api/v1/live/sessions/{uuid}/join")).text,
            (await client.get("/api/v1/live/sessions?course_uuid=course_test")).text,
        ]
        state["user"] = regular_user
        bodies += [
            (await client.get(f"/api/v1/live/sessions/{uuid}/classroom")).text,
            (await client.post(f"/api/v1/live/sessions/{uuid}/join")).text,
            (await client.get("/api/v1/live/me")).text,
        ]
        for body in bodies:
            assert API_SECRET not in body
            assert "api_secret" not in body.lower()
        # The join token is signed with the secret but never contains it.
        token = json.loads(bodies[-2])["token"]
        assert API_SECRET not in json.dumps(jwt.decode(token, API_SECRET, algorithms=["HS256"]))

    async def test_join_is_logged_without_token_or_secret(self, client, db, state, course, regular_user, enrolled, livekit_env, lk_calls, caplog):
        import logging

        uuid = await self._live_session(client, db)
        state["user"] = regular_user
        with caplog.at_level(logging.INFO, logger="src.services.live.telemetry"):
            token = (await client.post(f"/api/v1/live/sessions/{uuid}/join")).json()["token"]
        events = [r for r in caplog.records if r.name == "src.services.live.telemetry"]
        names = {getattr(r, "event", None) for r in events}
        assert {"live.join.authorized", "live.token.issued"} <= names
        for record in events:
            text = record.getMessage() + json.dumps({k: str(v) for k, v in vars(record).items()})
            assert token not in text
            assert API_SECRET not in text

    async def test_denied_join_is_logged_with_reason(self, client, db, state, course, regular_user, livekit_env, lk_calls, caplog):
        import logging

        uuid = await self._live_session(client, db)
        state["user"] = regular_user
        with caplog.at_level(logging.INFO, logger="src.services.live.telemetry"):
            assert (await client.post(f"/api/v1/live/sessions/{uuid}/join")).status_code == 403
        denied = [r for r in caplog.records if getattr(r, "event", None) == "live.join.denied"]
        assert denied and denied[0].live_code == "ENROLLMENT_REQUIRED"
        assert denied[0].live_user_id == regular_user.id


def test_telemetry_redacts_credentials(caplog):
    import logging

    from src.services.live.telemetry import log_event

    with caplog.at_level(logging.INFO, logger="src.services.live.telemetry"):
        log_event("probe", token="tok-123", api_secret="sec-456", Authorization="Bearer x", session="s1")
    record = caplog.records[-1]
    text = record.getMessage()
    assert "tok-123" not in text and "sec-456" not in text and "Bearer x" not in text
    assert "session=s1" in text
    assert record.live_token == "[redacted]"


def test_web_app_never_references_livekit_credentials():
    """The browser only ever receives a short-lived join token from the API."""
    from pathlib import Path

    web = Path(__file__).resolve().parents[4] / "web"
    if not web.is_dir():
        pytest.skip("web app not checked out beside the API")
    offenders = []
    for path in web.rglob("*"):
        if any(part in {"node_modules", ".next", "dist", "coverage"} for part in path.parts):
            continue
        if path.suffix not in {".ts", ".tsx", ".js", ".mjs", ".json"} and not path.name.startswith(".env"):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if "LIVEKIT_API_SECRET" in text or "LIVEKIT_API_KEY" in text or "NEXT_PUBLIC_LIVEKIT" in text:
            offenders.append(str(path.relative_to(web)))
    assert not offenders, f"LiveKit credentials referenced by the web app: {offenders}"


# ---------------------------------------------------------------------------
# Realtime scenarios (server side): many participants, drops, reconnects
# ---------------------------------------------------------------------------


async def _extra_learner(db, org, course, user_role, user_id: int, name: str) -> PublicUser:
    u = User(id=user_id, username=name, first_name=name.title(), last_name="Learner", email=f"{name}@test.com",
             password="x", user_uuid=f"user_{name}", creation_date="now", update_date="now")
    db.add(u)
    await db.commit()
    db.add(UserOrganization(user_id=u.id, org_id=org.id, role_id=user_role.id, creation_date="now", update_date="now"))
    trail = Trail(org_id=org.id, user_id=u.id, trail_uuid=f"trail_{name}", creation_date="now", update_date="now")
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    db.add(TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=u.id,
                    creation_date="now", update_date="now"))
    await db.commit()
    return PublicUser(id=u.id, username=u.username, first_name=u.first_name, last_name=u.last_name,
                      email=u.email, user_uuid=u.user_uuid)


class TestRealtimeScenarios:
    async def test_lecturer_and_several_learners_with_drops_and_reconnects(
        self, client, db, state, org, course, user_role, admin_user, regular_user, enrolled, livekit_env, lk_calls
    ):
        bob = await _extra_learner(db, org, course, user_role, 20, "bob")
        cara = await _extra_learner(db, org, course, user_role, 21, "cara")
        learners = [regular_user, bob, cara]

        uuid = (await _create(client)).json()["session_uuid"]
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/start")).status_code == 200
        room = (await _load(db, uuid)).livekit_room_name
        t0 = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=60)
        m = lambda minutes: t0 + timedelta(minutes=minutes)  # noqa: E731
        p = _participant

        async def hook(event, eid, at, who, sid, role, joined):
            resp = await _webhook(client, event, room, eid, at, participant=p(who.user_uuid, sid, role, joined))
            assert resp.status_code == 200

        await hook("participant_joined", "E1", m(0), admin_user, "PH1", "instructor", m(0))
        assert (await _load(db, uuid)).status == LiveSessionStatus.LIVE

        # Every learner gets their own token, for this room only.
        identities = set()
        for learner in learners:
            state["user"] = learner
            resp = await client.post(f"/api/v1/live/sessions/{uuid}/join")
            assert resp.status_code == 200
            claims = jwt.decode(resp.json()["token"], API_SECRET, algorithms=["HS256"])
            assert claims["video"]["room"] == room
            identities.add(claims["sub"])
        assert identities == {u.user_uuid for u in learners}

        for i, learner in enumerate(learners):
            await hook("participant_joined", f"J{i}", m(1), learner, f"PL{i}", "learner", m(1))

        # Bob's network drops and he reconnects (browser refresh → new SID).
        await hook("participant_left", "BL", m(10), bob, "PL1", "learner", m(1))
        await hook("participant_joined", "BJ", m(11), bob, "PL1b", "learner", m(11))
        # Cara leaves for good: a student leaving never ends the lesson.
        await hook("participant_left", "CL", m(15), cara, "PL2", "learner", m(1))
        assert (await _load(db, uuid)).status == LiveSessionStatus.LIVE

        # Lecturer drops; within the grace window the lesson survives …
        await hook("participant_left", "HL", m(20), admin_user, "PH1", "instructor", m(0))
        lk_calls["list"].return_value = [p(regular_user.user_uuid, "PL0", "learner", m(1)),
                                         p(bob.user_uuid, "PL1b", "learner", m(11))]
        await reconcile_once(db, now=m(21))
        assert (await _load(db, uuid)).status == LiveSessionStatus.LIVE
        # … and the lecturer reconnects.
        await hook("participant_joined", "HJ", m(22), admin_user, "PH2", "instructor", m(22))
        lk_calls["list"].return_value.append(p(admin_user.user_uuid, "PH2", "instructor", m(22)))
        await reconcile_once(db, now=m(40))
        assert (await _load(db, uuid)).status == LiveSessionStatus.LIVE

        state["user"] = admin_user
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/end")).json()["status"] == "completed"

        att = (await client.get(f"/api/v1/live/sessions/{uuid}/attendance")).json()
        rows = {r["user_uuid"]: r for r in att["participants"]}
        assert att["enrolled_count"] == 3 and att["attended_count"] == 3
        assert all(not r["is_connected"] for r in rows.values())  # closed at end
        assert rows[bob.user_uuid]["connection_count"] == 2
        assert rows[admin_user.user_uuid]["connection_count"] == 2
        assert rows[cara.user_uuid]["duration_seconds"] == 14 * 60
        # Reconnect gaps are not counted as attendance.
        assert rows[bob.user_uuid]["duration_seconds"] < rows[regular_user.user_uuid]["duration_seconds"]
        assert rows[regular_user.user_uuid]["duration_seconds"] - rows[bob.user_uuid]["duration_seconds"] == 60
        assert rows[admin_user.user_uuid]["duration_seconds"] == rows[regular_user.user_uuid]["duration_seconds"] + 60 - 2 * 60

        report = (await client.get(f"/api/v1/live/sessions/{uuid}/report")).json()
        assert report["completed"] is True
        assert report["enrolled"] == 3 and report["attendees"] == 3
        # Cara attended 14 of ~60 minutes: below the presence threshold → partial.
        assert report["partial"] == 1
        assert rows[cara.user_uuid]["attendance_status"] == "partial"
        assert report["session"]["recording_status"] == "none"
        assert report["recordings"] == []

        # After the end, nobody (lecturer included) can get back in.
        for user in [admin_user, *learners]:
            state["user"] = user
            assert (await client.post(f"/api/v1/live/sessions/{uuid}/join")).json()["detail"]["code"] == "SESSION_ENDED"

    async def test_removed_learner_cannot_rejoin_by_refreshing(
        self, client, db, state, course, admin_user, regular_user, enrolled, livekit_env, lk_calls
    ):
        uuid = await TestJoinSecurity._live_session(self, client, db)
        state["user"] = admin_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/participants/{regular_user.user_uuid}/remove")
        assert resp.status_code == 200
        state["user"] = regular_user
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/join")
        assert resp.status_code == 403
