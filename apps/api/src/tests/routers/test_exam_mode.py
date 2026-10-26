"""Exam mode: server-owned clock, the answer gate, the sitting lifecycle, and the staff monitor."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.exams import ExamEvent, ExamSession
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.routers.courses.assignments import router as assignments_router
from src.routers.courses.exams import router as exams_router
from src.security.auth import get_current_user
from src.services.courses.activities import exams as exam_service

UUID = "assignment_exam_test"


@pytest.fixture
async def assignment(db, org, course, chapter, activity):
    a = Assignment(
        id=1, title="CAT 1", description="First CAT", published=True, grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=True, org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid=UUID, creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


@pytest.fixture
async def task(db, org, course, chapter, activity, assignment):
    t = AssignmentTask(
        id=1, title="Q1", description="Capital of Kenya?", hint="", reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER, contents={"prompt": "Capital of Kenya?"},
        max_grade_value=10, assignment_id=assignment.id, org_id=org.id, course_id=course.id,
        chapter_id=chapter.id, activity_id=activity.id, assignment_task_uuid="assignmenttask_exam_1",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


@pytest.fixture
async def enrolled(db, org, course, regular_user):
    trail = Trail(org_id=org.id, user_id=regular_user.id, trail_uuid="trail_regular", creation_date="now", update_date="now")
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    db.add(TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=regular_user.id, creation_date="now", update_date="now"))
    await db.commit()


@pytest.fixture
def state(regular_user):
    return {"user": regular_user}


@pytest.fixture
def app(db, state):
    application = FastAPI()
    application.include_router(exams_router, prefix="/api/v1/exams")
    application.include_router(assignments_router, prefix="/api/v1/assignments")
    application.dependency_overrides[get_db_session] = lambda: db
    application.dependency_overrides[get_current_user] = lambda: state["user"]
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _iso(delta_minutes):
    return (datetime.now(timezone.utc) + timedelta(minutes=delta_minutes)).isoformat()


async def _enable(client, state, admin_user, regular_user, **overrides):
    """Staff turn exam mode on, then hand the client back to the student."""
    state["user"] = admin_user
    body = {"enabled": True, "duration_minutes": 30, **overrides}
    res = await client.put(f"/api/v1/exams/{UUID}", json=body)
    assert res.status_code == 200, res.text
    state["user"] = regular_user
    return res.json()


async def _session(db):
    return (await db.execute(select(ExamSession))).scalars().one()


async def _events(db):
    return [(e.kind, e.is_violation) for e in (await db.execute(select(ExamEvent).order_by(ExamEvent.id))).scalars().all()]


class TestGate:
    async def test_a_normal_assignment_is_not_affected(self, client, assignment, task, enrolled):
        res = await client.get(f"/api/v1/assignments/{UUID}/tasks")
        assert res.status_code == 200 and len(res.json()) == 1

    async def test_questions_and_answers_need_a_live_sitting(self, client, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        res = await client.get(f"/api/v1/assignments/{UUID}/tasks")
        assert res.status_code == 403 and res.json()["detail"]["code"] == "EXAM_SESSION_REQUIRED"
        assert (await client.get(f"/api/v1/assignments/task/{task.assignment_task_uuid}")).status_code == 403
        put = await client.put(
            f"/api/v1/assignments/{UUID}/tasks/{task.assignment_task_uuid}/submissions",
            json={"task_submission": {"answer": "Nairobi"}, "assignment_type": "SHORT_ANSWER"},
        )
        assert put.status_code == 403 and put.json()["detail"]["code"] == "EXAM_SESSION_REQUIRED"
        assert (await client.post(f"/api/v1/assignments/{UUID}/submissions")).status_code == 403, "the normal submit button is no way round the exam screen"

    async def test_staff_are_not_restricted(self, client, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        state["user"] = admin_user
        assert (await client.get(f"/api/v1/assignments/{UUID}/tasks")).status_code == 200

    async def test_inside_a_sitting_the_student_can_read_and_answer(self, client, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        assert (await client.post(f"/api/v1/exams/{UUID}/start")).status_code == 200
        tasks = await client.get(f"/api/v1/assignments/{UUID}/tasks")
        assert tasks.status_code == 200 and tasks.json()[0]["title"] == "Q1"
        put = await client.put(
            f"/api/v1/assignments/{UUID}/tasks/{task.assignment_task_uuid}/submissions",
            json={"task_submission": {"answer": "Nairobi"}, "assignment_type": "SHORT_ANSWER"},
        )
        assert put.status_code == 200, put.text

    async def test_no_retry_for_an_exam_even_if_retries_were_switched_on(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        assignment.allow_retries, assignment.max_retries = True, 3
        db.add(assignment)
        await db.commit()
        await _enable(client, state, admin_user, regular_user)
        res = await client.post(f"/api/v1/assignments/{UUID}/submissions/me/retry")
        assert res.status_code == 403 and res.json()["detail"]["code"] == "EXAM_NO_RETRY"


class TestSettings:
    async def test_only_staff_can_configure(self, client, state, regular_user, assignment, enrolled):
        res = await client.put(f"/api/v1/exams/{UUID}", json={"enabled": True, "duration_minutes": 30})
        assert res.status_code == 403

    async def test_must_close_after_it_opens(self, client, state, admin_user, assignment):
        state["user"] = admin_user
        res = await client.put(f"/api/v1/exams/{UUID}", json={"duration_minutes": 30, "opens_at": _iso(60), "closes_at": _iso(30)})
        assert res.status_code == 422

    async def test_students_see_the_rules_but_not_the_questions(self, client, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user, require_camera=True, watermark=True)
        res = await client.get(f"/api/v1/exams/{UUID}")
        body = res.json()
        assert res.status_code == 200 and body["window"] == "open" and body["session_status"] is None
        assert body["settings"]["duration_minutes"] == 30 and body["settings"]["require_camera"] is True


class TestSitting:
    async def test_start_fixes_the_deadline_on_the_server(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user, duration_minutes=45)
        body = (await client.post(f"/api/v1/exams/{UUID}/start")).json()
        assert body["session_status"] == "in_progress" and 44 * 60 <= body["seconds_left"] <= 45 * 60

    async def test_closes_at_caps_every_deadline(self, client, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user, duration_minutes=120, closes_at=_iso(20))
        body = (await client.post(f"/api/v1/exams/{UUID}/start")).json()
        assert body["seconds_left"] <= 20 * 60, "a long exam started late still ends at the closing time"

    async def test_not_open_and_closed_windows(self, client, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user, opens_at=_iso(60))
        res = await client.post(f"/api/v1/exams/{UUID}/start")
        assert res.status_code == 403 and res.json()["detail"]["code"] == "EXAM_NOT_OPEN"

    async def test_closed_exam_cannot_be_started(self, client, db, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user, closes_at=_iso(5))
        settings = (await db.execute(select(exam_service.ExamSettings))).scalars().one()
        settings.closes_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.add(settings)
        await db.commit()
        res = await client.post(f"/api/v1/exams/{UUID}/start")
        assert res.status_code == 403 and res.json()["detail"]["code"] == "EXAM_CLOSED"

    async def test_coming_back_resumes_the_same_sitting_and_the_clock_keeps_running(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        first = (await client.post(f"/api/v1/exams/{UUID}/start")).json()
        again = (await client.post(f"/api/v1/exams/{UUID}/start")).json()
        assert again["deadline_at"] == first["deadline_at"], "closing the tab does not reset or pause the clock"
        session = await _session(db)
        assert session.resume_count == 1
        assert ("resumed", False) in await _events(db)

    async def test_finishing_hands_in_the_work_and_ends_the_sitting(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        await client.put(
            f"/api/v1/assignments/{UUID}/tasks/{task.assignment_task_uuid}/submissions",
            json={"task_submission": {"answer": "Nairobi"}, "assignment_type": "SHORT_ANSWER"},
        )
        done = await client.post(f"/api/v1/exams/{UUID}/finish")
        assert done.status_code == 200 and done.json()["session_status"] == "submitted"
        sub = (await db.execute(select(AssignmentUserSubmission))).scalars().one()
        assert sub.submission_status in (AssignmentUserSubmissionStatus.SUBMITTED, AssignmentUserSubmissionStatus.GRADED)
        again = await client.post(f"/api/v1/exams/{UUID}/start")
        assert again.status_code == 409 and again.json()["detail"]["code"] == "EXAM_ALREADY_TAKEN"
        assert (await client.get(f"/api/v1/assignments/{UUID}/tasks")).status_code == 403, "questions stay closed to a finisher while others may still sit"

    async def test_after_the_exam_closes_a_finisher_may_review(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user, closes_at=_iso(30))
        await client.post(f"/api/v1/exams/{UUID}/start")
        await client.post(f"/api/v1/exams/{UUID}/finish")
        settings = (await db.execute(select(exam_service.ExamSettings))).scalars().one()
        settings.closes_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.add(settings)
        await db.commit()
        assert (await client.get(f"/api/v1/assignments/{UUID}/tasks")).status_code == 200


class TestDeadline:
    async def _expire(self, db):
        session = await _session(db)
        session.deadline_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.add(session)
        await db.commit()

    async def test_answers_are_refused_after_the_deadline(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        await self._expire(db)
        put = await client.put(
            f"/api/v1/assignments/{UUID}/tasks/{task.assignment_task_uuid}/submissions",
            json={"task_submission": {"answer": "late"}, "assignment_type": "SHORT_ANSWER"},
        )
        assert put.status_code == 403 and put.json()["detail"]["code"] == "EXAM_TIME_UP"

    async def test_the_server_submits_for_a_student_who_never_comes_back(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        await client.put(
            f"/api/v1/assignments/{UUID}/tasks/{task.assignment_task_uuid}/submissions",
            json={"task_submission": {"answer": "Nairobi"}, "assignment_type": "SHORT_ANSWER"},
        )
        await self._expire(db)
        assert await exam_service.sweep_expired(db) == 1
        session = await _session(db)
        assert session.status == "submitted" and session.auto_submitted is True
        sub = (await db.execute(select(AssignmentUserSubmission))).scalars().one()
        assert sub.submission_status in (AssignmentUserSubmissionStatus.SUBMITTED, AssignmentUserSubmissionStatus.GRADED)
        assert ("auto_submitted", False) in await _events(db)
        assert await exam_service.sweep_expired(db) == 0, "closing a sitting twice does nothing"

    async def test_the_heartbeat_also_closes_an_expired_sitting(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        await self._expire(db)
        body = (await client.post(f"/api/v1/exams/{UUID}/heartbeat", json={"camera_on": True})).json()
        assert body["session_status"] == "submitted"


class TestSupervision:
    async def test_camera_and_screen_changes_become_events(self, client, db, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        hb = f"/api/v1/exams/{UUID}/heartbeat"
        await client.post(hb, json={"camera_on": True, "screen_shared": True, "fullscreen": True})
        await client.post(hb, json={"camera_on": False, "screen_shared": True, "fullscreen": True})
        await client.post(hb, json={"camera_on": False, "screen_shared": True, "fullscreen": True})
        await client.post(hb, json={"camera_on": True, "screen_shared": False, "fullscreen": False})
        events = await _events(db)
        assert events == [("started", False), ("camera_off", True), ("camera_on", False), ("screen_share_stopped", True), ("fullscreen_exit", True)], events
        session = await _session(db)
        assert session.violation_count == 3 and session.camera_on is True and session.screen_shared is False

    async def test_starting_without_the_camera_is_a_violation(self, client, db, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        await client.post(f"/api/v1/exams/{UUID}/heartbeat", json={"camera_on": False, "screen_shared": True, "fullscreen": True})
        assert ("camera_off", True) in await _events(db)

    async def test_an_optional_check_is_not_a_violation(self, client, db, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user, require_camera=False)
        await client.post(f"/api/v1/exams/{UUID}/start")
        hb = f"/api/v1/exams/{UUID}/heartbeat"
        await client.post(hb, json={"camera_on": True})
        await client.post(hb, json={"camera_on": False})
        assert ("camera_off", False) in await _events(db)
        assert (await _session(db)).violation_count == 0

    async def test_client_events_and_the_blur_then_hidden_pair_counts_once(self, client, db, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        ev = f"/api/v1/exams/{UUID}/events"
        await client.post(ev, json={"kind": "window_blur"})
        await client.post(ev, json={"kind": "tab_hidden"})
        await client.post(ev, json={"kind": "paste_attempt", "detail": "in answer box"})
        await client.post(ev, json={"kind": "tab_visible"})
        assert await _events(db) == [("started", False), ("window_blur", True), ("tab_hidden", False), ("paste_attempt", True), ("tab_visible", False)]
        assert (await _session(db)).violation_count == 2

    async def test_unknown_or_forged_event_kinds_are_refused(self, client, db, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        for kind in ("auto_submitted", "submitted", "made_up", "camera_off"):
            assert (await client.post(f"/api/v1/exams/{UUID}/events", json={"kind": kind})).status_code == 422, kind

    async def test_events_after_submission_are_ignored(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        await client.post(f"/api/v1/exams/{UUID}/finish")
        res = await client.post(f"/api/v1/exams/{UUID}/events", json={"kind": "tab_hidden"})
        assert res.json() == {"recorded": False}

    async def test_a_long_silence_is_recorded_as_a_gap(self, client, db, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        session = await _session(db)
        session.last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=90)
        db.add(session)
        await db.commit()
        await client.post(f"/api/v1/exams/{UUID}/heartbeat", json={"camera_on": True})
        assert [k for k, _ in await _events(db)].count("connection_gap") == 1


class TestMonitor:
    async def test_students_cannot_open_the_monitor(self, client, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user)
        assert (await client.get(f"/api/v1/exams/{UUID}/monitor")).status_code == 403
        assert (await client.get(f"/api/v1/exams/{UUID}/students/{regular_user.user_uuid}/events")).status_code == 403

    async def test_roster_shows_everyone_enrolled_with_live_status(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        state["user"] = admin_user
        roster = (await client.get(f"/api/v1/exams/{UUID}/monitor")).json()
        assert roster["counts"]["not_started"] == 1 and roster["students"][0]["status"] == "not_started"

        state["user"] = regular_user
        await client.post(f"/api/v1/exams/{UUID}/start")
        await client.post(f"/api/v1/exams/{UUID}/heartbeat", json={"camera_on": False, "screen_shared": True, "fullscreen": True})
        await client.post(f"/api/v1/exams/{UUID}/events", json={"kind": "tab_hidden"})
        state["user"] = admin_user
        roster = (await client.get(f"/api/v1/exams/{UUID}/monitor")).json()
        row = roster["students"][0]
        assert row["status"] == "in_progress" and row["connected"] is True and row["violation_count"] == 2
        assert row["camera_on"] is False and row["seconds_left"] > 0
        assert roster["counts"] == {"not_started": 0, "in_progress": 1, "submitted": 0, "disconnected": 0, "flagged": 1}

        timeline = (await client.get(f"/api/v1/exams/{UUID}/students/{regular_user.user_uuid}/events")).json()
        assert [e["kind"] for e in timeline] == ["started", "camera_off", "tab_hidden"]
        assert [e["is_violation"] for e in timeline] == [False, True, True]

    async def test_a_silent_browser_shows_as_disconnected(self, client, db, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        session = await _session(db)
        session.last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=60)
        db.add(session)
        await db.commit()
        state["user"] = admin_user
        roster = (await client.get(f"/api/v1/exams/{UUID}/monitor")).json()
        assert roster["students"][0]["connected"] is False and roster["counts"]["disconnected"] == 1

    async def test_opening_the_monitor_closes_expired_sittings(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await client.post(f"/api/v1/exams/{UUID}/start")
        session = await _session(db)
        session.deadline_at = datetime.now(timezone.utc) - timedelta(minutes=2)
        db.add(session)
        await db.commit()
        state["user"] = admin_user
        row = (await client.get(f"/api/v1/exams/{UUID}/monitor")).json()["students"][0]
        assert row["status"] == "submitted" and row["auto_submitted"] is True

    async def test_not_an_exam(self, client, state, admin_user, assignment):
        state["user"] = admin_user
        assert (await client.get(f"/api/v1/exams/{UUID}/monitor")).status_code == 404


class TestOneBrowserAtATime:
    async def _start(self, client, cid):
        return await client.post(f"/api/v1/exams/{UUID}/start", json={"client_id": cid})

    async def test_the_newest_window_wins_and_the_older_one_is_told_to_close(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await self._start(client, "window-a")
        hb = f"/api/v1/exams/{UUID}/heartbeat"
        assert (await client.post(hb, json={"client_id": "window-a", "camera_on": True})).json()["superseded"] is False
        await self._start(client, "window-b")
        assert (await client.post(hb, json={"client_id": "window-a", "camera_on": True})).json()["superseded"] is True, "the first browser closes itself"
        assert (await client.post(hb, json={"client_id": "window-b", "camera_on": True})).json()["superseded"] is False
        events = await _events(db)
        assert ("second_window", True) in events, "opening a second browser while the first is live is flagged for staff"
        assert (await _session(db)).active_client == "window-b"

    async def test_the_old_window_cannot_hand_in_or_log_events(self, client, db, state, admin_user, regular_user, assignment, task, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await self._start(client, "window-a")
        await self._start(client, "window-b")
        res = await client.post(f"/api/v1/exams/{UUID}/finish", json={"client_id": "window-a"})
        assert res.status_code == 409 and res.json()["detail"]["code"] == "EXAM_OTHER_WINDOW"
        assert (await client.post(f"/api/v1/exams/{UUID}/events", json={"kind": "tab_hidden", "client_id": "window-a"})).json() == {"recorded": False}
        assert (await client.post(f"/api/v1/exams/{UUID}/finish", json={"client_id": "window-b"})).json()["session_status"] == "submitted"

    async def test_reloading_the_same_tab_is_not_a_second_window(self, client, db, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await self._start(client, "window-a")
        await self._start(client, "window-a")
        assert ("second_window", True) not in await _events(db)

    async def test_continuing_after_the_first_window_died_is_not_a_violation(self, client, db, state, admin_user, regular_user, assignment, enrolled):
        await _enable(client, state, admin_user, regular_user)
        await self._start(client, "window-a")
        session = await _session(db)
        session.last_seen_at = datetime.now(timezone.utc) - timedelta(minutes=2)
        db.add(session)
        await db.commit()
        await self._start(client, "window-b")
        events = await _events(db)
        assert ("second_window", False) in events and ("second_window", True) not in events
