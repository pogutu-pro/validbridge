# Fixtures are imported from test_live_router; pytest injects them by name,
# which linters read as redefinitions.
# ruff: noqa: F811
"""LiveBridge interactive features: attendance analytics, lecturer answers,
stage focus, timed polls with live results, and live quizzes built on the
existing assessment system."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.live_sessions import (
    LiveParticipantRole,
    LivePoll,
    LiveQuiz,
    LiveSession,
    LiveSessionParticipant,
    LiveSessionStatus,
)
from src.db.user_audit_events import UserAuditEventType
from src.services.analytics import events as analytics_events
from src.services.live.reporting import classify

# Shared fixtures (app, client, state, enrolled, livekit_env, lk_calls) and helpers.
from src.tests.routers.test_live_router import (  # noqa: F401
    _create,
    _load,
    _participant,
    _webhook,
    app,
    client,
    enrolled,
    livekit_env,
    lk_calls,
    state,
)

T0 = datetime(2026, 9, 23, 10, 0, tzinfo=timezone.utc)


@pytest.fixture
def analytics():
    """Capture Tinybird events and durable audit rows from every live module."""
    track = AsyncMock()
    audit = AsyncMock()
    with patch("src.services.live.reporting.track", track), patch(
        "src.services.live.reporting.record_audit_event", audit
    ), patch("src.services.live.classroom.track", track), patch(
        "src.services.live.quizzes.track", track
    ), patch("src.services.live.quizzes.record_audit_event", audit):
        yield {"track": track, "audit": audit}


def _events(mock, name):
    return [c for c in mock.await_args_list if c.args and c.args[0] == name]


async def _live(client, db):
    uuid = (await _create(client)).json()["session_uuid"]
    s = await _load(db, uuid)
    s.status = LiveSessionStatus.LIVE
    s.started_at = datetime.now(timezone.utc)
    db.add(s)
    await db.commit()
    return uuid


# ---------------------------------------------------------------------------
# Attendance
# ---------------------------------------------------------------------------


def _row(**kw) -> LiveSessionParticipant:
    base = dict(session_id=1, user_id=2, org_id=1, role=LiveParticipantRole.LEARNER,
                duration_seconds=0, connection_count=1, is_connected=False)
    base.update(kw)
    return LiveSessionParticipant(**base)


def _session(**kw) -> LiveSession:
    base = dict(session_uuid="s", org_id=1, course_id=1, title="t", scheduled_at=T0,
                livekit_room_name="vb-live-x", started_at=T0, ended_at=T0 + timedelta(minutes=60),
                status=LiveSessionStatus.COMPLETED)
    base.update(kw)
    return LiveSession(**base)


class TestAttendanceClassification:
    now = T0 + timedelta(hours=2)

    def test_present(self):
        f = classify(_row(joined_at=T0 + timedelta(minutes=2), left_at=T0 + timedelta(minutes=59),
                          duration_seconds=57 * 60), _session(), self.now)
        assert f.status == "present"
        assert f.late_by_seconds == 120
        assert f.left_early_by_seconds == 60
        assert f.attendance_percent == 95.0

    def test_late(self):
        f = classify(_row(joined_at=T0 + timedelta(minutes=12), left_at=T0 + timedelta(minutes=60),
                          duration_seconds=48 * 60), _session(), self.now)
        assert (f.status, f.late_by_seconds) == ("late", 720)

    def test_left_early(self):
        f = classify(_row(joined_at=T0, left_at=T0 + timedelta(minutes=50), duration_seconds=50 * 60),
                     _session(), self.now)
        assert (f.status, f.left_early_by_seconds) == ("left_early", 600)

    def test_partial_beats_late(self):
        f = classify(_row(joined_at=T0 + timedelta(minutes=30), left_at=T0 + timedelta(minutes=45),
                          duration_seconds=15 * 60), _session(), self.now)
        assert f.status == "partial"
        assert f.attendance_percent == 25.0

    def test_still_connected_counts_live_time_and_not_early(self):
        live = _session(ended_at=None, status=LiveSessionStatus.LIVE)
        f = classify(_row(joined_at=T0, is_connected=True, connected_since=T0, left_at=None),
                     live, T0 + timedelta(minutes=20))
        assert f.duration_seconds == 20 * 60
        assert f.left_early_by_seconds == 0
        assert f.attendance_percent == 100.0


class TestAttendanceReportAndAnalytics:
    async def test_report_includes_absent_and_summary(self, client, db, state, course, admin_user, regular_user,
                                                      enrolled, livekit_env, lk_calls, analytics):
        uuid = await _live(client, db)
        attendance = (await client.get(f"/api/v1/live/sessions/{uuid}/attendance")).json()
        assert attendance["summary"]["absent"] == 1
        assert [a["user_uuid"] for a in attendance["absent"]] == [regular_user.user_uuid]

    async def test_finish_emits_attendance_analytics_once(self, client, db, state, course, admin_user,
                                                          regular_user, enrolled, livekit_env, lk_calls, analytics):
        uuid = (await _create(client)).json()["session_uuid"]
        await client.post(f"/api/v1/live/sessions/{uuid}/start")
        room = (await _load(db, uuid)).livekit_room_name
        now = datetime.now(timezone.utc).replace(microsecond=0)
        await _webhook(client, "participant_joined", room, "EV_h", now - timedelta(minutes=30),
                       participant=_participant(admin_user.user_uuid, "PA_h", "instructor", now - timedelta(minutes=30)))
        await _webhook(client, "participant_joined", room, "EV_l", now - timedelta(minutes=20),
                       participant=_participant(regular_user.user_uuid, "PA_l", "learner", now - timedelta(minutes=20)))
        assert _events(analytics["track"], analytics_events.LIVE_SESSION_STARTED)

        await client.post(f"/api/v1/live/sessions/{uuid}/end")
        await client.post(f"/api/v1/live/sessions/{uuid}/end")  # idempotent: no second emission

        attended = _events(analytics["track"], analytics_events.LIVE_SESSION_ATTENDED)
        assert len(attended) == 1
        props = attended[0].kwargs["properties"]
        assert attended[0].kwargs["user_id"] == regular_user.id
        # 20 of 30 minutes (66.7%) is under the 75% threshold: partial outranks late.
        assert props["status"] == "partial"
        assert props["late_by_seconds"] == 600
        assert 66 <= props["attendance_percent"] <= 67
        assert len(_events(analytics["track"], analytics_events.LIVE_SESSION_ENDED)) == 1
        audit_types = [c.kwargs["event_type"] for c in analytics["audit"].await_args_list]
        assert audit_types == [UserAuditEventType.LIVE_SESSION_ATTENDED]


# ---------------------------------------------------------------------------
# Chat: lecturer responses
# ---------------------------------------------------------------------------


class TestLecturerAnswers:
    async def test_written_answer_marks_answered(self, client, db, state, course, admin_user, regular_user,
                                                 enrolled, livekit_env, lk_calls):
        uuid = await _live(client, db)
        state["user"] = regular_user
        q = (await client.post(f"/api/v1/live/sessions/{uuid}/messages",
                               json={"kind": "question", "body": "Is this on the exam?"})).json()
        path = f"/api/v1/live/sessions/{uuid}/questions/{q['message_uuid']}"
        assert (await client.patch(path, json={"status": "answered", "answer": "No"})).status_code == 403

        state["user"] = admin_user
        resp = (await client.patch(path, json={"status": "open", "answer": "  Yes, chapter 3.  "})).json()
        assert resp["status"] == "answered"
        assert resp["answer"] == "Yes, chapter 3."
        assert resp["answered_by"] == "Admin User"

        state["user"] = regular_user
        listed = (await client.get(f"/api/v1/live/sessions/{uuid}/messages", params={"kind": "question"})).json()
        assert listed[0]["answer"] == "Yes, chapter 3."


# ---------------------------------------------------------------------------
# Screen sharing: stage focus
# ---------------------------------------------------------------------------


class TestStageFocus:
    async def test_lecturer_switches_focus(self, client, db, state, course, admin_user, regular_user, enrolled,
                                           livekit_env, lk_calls):
        uuid = await _live(client, db)
        with patch("src.services.live.livekit.update_room_metadata", new_callable=AsyncMock) as update:
            update.return_value = True
            resp = await client.post(f"/api/v1/live/sessions/{uuid}/stage", json={"focus": "camera"})
            assert resp.status_code == 200
            assert update.await_args.args[2]["focus"] == "camera"

            state["user"] = regular_user
            assert (await client.post(f"/api/v1/live/sessions/{uuid}/stage", json={"focus": "camera"})).status_code == 403
            assert (await client.post(f"/api/v1/live/sessions/{uuid}/stage", json={"focus": "nope"})).status_code == 422


# ---------------------------------------------------------------------------
# Polls: duration, realtime results, analytics
# ---------------------------------------------------------------------------


class TestTimedPolls:
    async def test_duration_results_and_close(self, client, db, state, course, admin_user, regular_user, enrolled,
                                              livekit_env, lk_calls, analytics):
        uuid = await _live(client, db)
        poll = (await client.post(f"/api/v1/live/sessions/{uuid}/polls",
                                  json={"question": "Pace?", "options": ["Slower", "Good"], "duration_seconds": 30})).json()
        assert poll["duration_seconds"] == 30 and poll["closes_at"]

        state["user"] = regular_user
        await client.post(f"/api/v1/live/sessions/{uuid}/polls/{poll['poll_uuid']}/vote", json={"option_index": 1})
        results = [c for c in lk_calls["send"].await_args_list if c.args[3].get("type") == "results"]
        assert results and results[-1].args[3]["counts"] == [0, 1]

        # Time runs out: votes are refused and the poll closes itself.
        row = (await db.execute(select(LivePoll).where(LivePoll.poll_uuid == poll["poll_uuid"]))).scalars().one()
        row.closes_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.add(row)
        await db.commit()
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/polls/{poll['poll_uuid']}/vote", json={"option_index": 0})
        assert resp.json()["detail"]["code"] == "POLL_CLOSED"
        listed = (await client.get(f"/api/v1/live/sessions/{uuid}/polls")).json()
        assert listed[0]["status"] == "closed" and listed[0]["counts"] == [0, 1]

        closed = _events(analytics["track"], analytics_events.LIVE_POLL_CLOSED)
        assert len(closed) == 1
        assert closed[0].kwargs["properties"]["total_votes"] == 1

    async def test_poll_duration_bounds(self, client, db, course, livekit_env, lk_calls):
        uuid = await _live(client, db)
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/polls",
                                 json={"question": "Q", "options": ["a", "b"], "duration_seconds": 3})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Live quizzes
# ---------------------------------------------------------------------------

QUIZ_CONTENTS = {
    "grading_mode": "partial_credit",
    "questions": [
        {
            "questionUUID": "question_1",
            "questionText": "2 + 2?",
            "options": [
                {"optionUUID": "o1a", "text": "3", "assigned_right_answer": False},
                {"optionUUID": "o1b", "text": "4", "assigned_right_answer": True},
            ],
        },
        {
            "questionUUID": "question_2",
            "questionText": "Pick the primes",
            "options": [
                {"optionUUID": "o2a", "text": "2", "assigned_right_answer": True},
                {"optionUUID": "o2b", "text": "3", "assigned_right_answer": True},
                {"optionUUID": "o2c", "text": "4", "assigned_right_answer": False},
            ],
        },
        # No correct option: can't be auto-scored, so it is left out.
        {"questionUUID": "question_x", "questionText": "Opinion?", "options": [
            {"optionUUID": "ox", "text": "a", "assigned_right_answer": False}]},
    ],
}

BLOCK_DOC = {
    "type": "doc",
    "content": [
        {"type": "paragraph"},
        {"type": "blockQuiz", "attrs": {"quizId": "quiz_blk", "questions": [
            {"question_id": "qb1", "question": "Capital of Kenya?", "type": "multiple_choice", "answers": [
                {"answer_id": "ab1", "answer": "Nairobi", "correct": True},
                {"answer_id": "ab2", "answer": "Mombasa", "correct": False},
            ]},
        ]}},
    ],
}


@pytest.fixture
async def quiz_sources(db, org, course, chapter, activity):
    assignment = Assignment(
        title="Week 1 check", description="", grading_type=GradingTypeEnum.PERCENTAGE,
        org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid="assignment_w1",
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    db.add(AssignmentTask(
        title="Arithmetic", description="", hint="", assignment_type=AssignmentTaskTypeEnum.QUIZ,
        contents=QUIZ_CONTENTS, assignment_task_uuid="task_arith", creation_date="now", update_date="now",
        assignment_id=assignment.id, org_id=org.id, course_id=course.id, chapter_id=chapter.id,
        activity_id=activity.id,
    ))
    db.add(Activity(
        name="Geography", activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content=BLOCK_DOC, published=True,
        org_id=org.id, course_id=course.id, activity_uuid="activity_geo",
    ))
    await db.commit()


async def _set_deadline(db, quiz_uuid, delta):
    quiz = (await db.execute(select(LiveQuiz).where(LiveQuiz.quiz_uuid == quiz_uuid))).scalars().one()
    quiz.question_deadline = datetime.now(timezone.utc) + delta
    db.add(quiz)
    await db.commit()


class TestLiveQuizzes:
    async def test_sources_reuse_existing_quizzes(self, client, db, state, course, regular_user, enrolled,
                                                  quiz_sources, livekit_env, lk_calls):
        uuid = await _live(client, db)
        sources = {s["source_id"]: s for s in (await client.get(f"/api/v1/live/sessions/{uuid}/quiz-sources")).json()}
        assert sources["task:task_arith"]["question_count"] == 2  # ungradable question skipped
        assert sources["task:task_arith"]["origin"] == "assignment"
        assert sources["block:activity_geo:quiz_blk"]["origin"] == "lesson"

        state["user"] = regular_user
        assert (await client.get(f"/api/v1/live/sessions/{uuid}/quiz-sources")).status_code == 403

    async def test_full_quiz_flow(self, client, db, state, course, admin_user, regular_user, enrolled,
                                  quiz_sources, livekit_env, lk_calls, analytics):
        uuid = await _live(client, db)
        base = f"/api/v1/live/sessions/{uuid}/quizzes"

        state["user"] = regular_user
        assert (await client.post(base, json={"source_id": "task:task_arith"})).status_code == 403

        state["user"] = admin_user
        quiz = (await client.post(base, json={"source_id": "task:task_arith", "seconds_per_question": 20})).json()
        q_uuid = quiz["quiz_uuid"]
        assert quiz["question_count"] == 2 and quiz["current_index"] == 0
        assert lk_calls["send"].await_args.args[3] == {"type": "question", "quiz_uuid": q_uuid, "index": 0}
        assert (await client.post(base, json={"source_id": "task:task_arith"})).json()["detail"]["code"] == "QUIZ_RUNNING"
        assert (await client.post(f"{base}/{q_uuid}/answers",
                                  json={"question_index": 0, "option_uuids": ["o1b"]})).status_code == 403

        # Learner: the answer key is not revealed while the question is open.
        state["user"] = regular_user
        view = (await client.get(f"{base}/current")).json()
        assert all(o["correct"] is None for o in view["current"]["options"])
        assert view["current"]["stats"] is None and view["questions"] is None

        # Single-response question: exactly one option.
        bad = await client.post(f"{base}/{q_uuid}/answers", json={"question_index": 0, "option_uuids": ["o1a", "o1b"]})
        assert bad.status_code == 422
        answered = (await client.post(f"{base}/{q_uuid}/answers",
                                      json={"question_index": 0, "option_uuids": ["o1b"]})).json()
        assert answered["current"]["my_answer"] == ["o1b"]
        assert answered["current"]["my_correct"] is None  # hidden until the question closes
        again = await client.post(f"{base}/{q_uuid}/answers", json={"question_index": 0, "option_uuids": ["o1a"]})
        assert again.json()["detail"]["code"] == "QUIZ_ALREADY_ANSWERED"

        # Staff: live stats.
        state["user"] = admin_user
        staff_view = (await client.get(f"{base}/current")).json()
        assert staff_view["current"]["stats"] == {"answered": 1, "correct": 1, "incorrect": 0, "average_percent": 100.0}
        assert staff_view["current"]["options"][1]["picks"] == 1

        # Next question; the old one is closed to answers.
        await client.post(f"{base}/{q_uuid}/next")
        state["user"] = regular_user
        late = await client.post(f"{base}/{q_uuid}/answers", json={"question_index": 0, "option_uuids": ["o1b"]})
        assert late.json()["detail"]["code"] == "QUIZ_QUESTION_CLOSED"

        # Timer ran out on question 2.
        await _set_deadline(db, q_uuid, timedelta(seconds=-10))
        expired = await client.post(f"{base}/{q_uuid}/answers", json={"question_index": 1, "option_uuids": ["o2a"]})
        assert expired.json()["detail"]["code"] == "QUIZ_QUESTION_CLOSED"

        # Within time: partial credit via the existing grader (1 of 2 primes, no wrong pick).
        await _set_deadline(db, q_uuid, timedelta(seconds=15))
        await client.post(f"{base}/{q_uuid}/answers", json={"question_index": 1, "option_uuids": ["o2a"]})

        state["user"] = admin_user
        done = (await client.post(f"{base}/{q_uuid}/next")).json()  # past the last question → finish
        assert done["status"] == "finished"
        assert done["results"] == {
            "participants": 1, "correct": 1, "incorrect": 1, "average_percent": 75.0,
            "my_percent": None, "my_correct": None,
        }
        assert lk_calls["send"].await_args.args[3]["type"] == "finished"

        state["user"] = regular_user
        mine = (await client.get(f"{base}/current")).json()
        assert mine["results"]["my_percent"] == 75.0 and mine["results"]["my_correct"] == 1

        completed = _events(analytics["track"], analytics_events.LIVE_QUIZ_COMPLETED)
        assert len(completed) == 1 and completed[0].kwargs["properties"]["score_percent"] == 75.0
        summary = _events(analytics["track"], analytics_events.LIVE_QUIZ_FINISHED)[0].kwargs["properties"]
        assert (summary["participants"], summary["correct"], summary["incorrect"], summary["average_percent"]) == (1, 1, 1, 75.0)
        assert [c.kwargs["event_type"] for c in analytics["audit"].await_args_list] == [UserAuditEventType.LIVE_QUIZ_COMPLETED]

    async def test_quiz_from_lesson_block(self, client, db, state, course, regular_user, enrolled, quiz_sources,
                                          livekit_env, lk_calls, analytics):
        uuid = await _live(client, db)
        base = f"/api/v1/live/sessions/{uuid}/quizzes"
        quiz = (await client.post(base, json={"source_id": "block:activity_geo:quiz_blk"})).json()
        state["user"] = regular_user
        resp = (await client.post(f"{base}/{quiz['quiz_uuid']}/answers",
                                  json={"question_index": 0, "option_uuids": ["ab2"]})).json()
        assert resp["current"]["my_answer"] == ["ab2"]
        unknown = await client.post(f"{base}/{quiz['quiz_uuid']}/answers",
                                    json={"question_index": 0, "option_uuids": ["nope"]})
        assert unknown.status_code in (409, 422)

    async def test_unknown_or_foreign_source(self, client, db, course, quiz_sources, livekit_env, lk_calls):
        uuid = await _live(client, db)
        base = f"/api/v1/live/sessions/{uuid}/quizzes"
        assert (await client.post(base, json={"source_id": "task:nope"})).status_code == 404
        assert (await client.post(base, json={"source_id": "block:activity_geo:other"})).status_code == 404

    async def test_ending_lesson_finishes_quiz(self, client, db, state, course, admin_user, quiz_sources,
                                              livekit_env, lk_calls, analytics):
        uuid = await _live(client, db)
        quiz = (await client.post(f"/api/v1/live/sessions/{uuid}/quizzes", json={"source_id": "task:task_arith"})).json()
        await client.post(f"/api/v1/live/sessions/{uuid}/end")
        row = (await db.execute(select(LiveQuiz).where(LiveQuiz.quiz_uuid == quiz["quiz_uuid"]))).scalars().one()
        await db.refresh(row)
        assert row.status == "finished"
        assert _events(analytics["track"], analytics_events.LIVE_QUIZ_FINISHED)

