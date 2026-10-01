# Fixtures are imported from test_live_router; pytest injects them by name,
# which linters read as redefinitions.
# ruff: noqa: F811
"""LiveBridge recordings (Egress → R2 → course lesson), live analytics joined
with LMS data, the audit dossier, and the transcript → RAG hook."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.live_sessions import (
    LiveRecording,
    LiveRecordingStatus,
    LiveSessionStatus,
)
from src.db.trail_steps import TrailStep
from src.services.ai.rag.content_extraction import (
    extract_all_course_content,
    extract_video_transcript,
    vtt_to_text,
)
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

EGRESS_ID = "EG_rec_1"


@pytest.fixture
def recording_env(monkeypatch, livekit_env, lk_calls):
    """Recording enabled with R2 storage; Egress, storage and HLS stubbed."""
    monkeypatch.setenv("VALIDBRIDGE_LIVE_RECORDING_ENABLED", "true")
    storage = {"size": 5_000_000}
    with patch("src.services.live.recordings.is_s3_enabled", return_value=True), patch(
        "src.services.live.recordings.get_s3_bucket_name", return_value="vb-media"
    ), patch(
        "src.services.live.livekit.start_room_recording", new_callable=AsyncMock, return_value=EGRESS_ID
    ) as start, patch("src.services.live.livekit.stop_egress", new_callable=AsyncMock) as stop, patch(
        "src.services.live.livekit.update_room_metadata", new_callable=AsyncMock, return_value=True
    ), patch(
        "src.services.live.recordings._object_size", side_effect=lambda key: storage["size"]
    ), patch("src.services.utils.hls_jobs.enqueue") as hls, patch(
        "src.services.live.recordings.track", new_callable=AsyncMock
    ) as track:
        yield {"start": start, "stop": stop, "hls": hls, "storage": storage, "track": track}


async def _live(client, db, **extra):
    uuid = (await _create(client, **extra)).json()["session_uuid"]
    s = await _load(db, uuid)
    s.status = LiveSessionStatus.LIVE
    s.started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    db.add(s)
    await db.commit()
    return uuid


async def _egress(client, db, uuid, status, event="egress_updated", **egress):
    room = (await _load(db, uuid)).livekit_room_name
    return await _webhook(client, event, "", f"EV_{status}_{event}", datetime.now(timezone.utc),
                          egressInfo={"egressId": EGRESS_ID, "roomName": room, "status": status, **egress})


async def _recording(db, uuid):
    s = await _load(db, uuid)
    rec = (await db.execute(select(LiveRecording).where(LiveRecording.session_id == s.id))).scalars().first()
    await db.refresh(rec)
    return rec


# ---------------------------------------------------------------------------
# Availability + permissions
# ---------------------------------------------------------------------------


class TestRecordingAvailability:
    async def test_disabled_by_default(self, client, db, course, livekit_env, lk_calls):
        uuid = await _live(client, db)
        assert (await client.get(f"/api/v1/live/sessions/{uuid}/classroom")).json()["recording_available"] is False
        resp = await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")
        assert resp.json()["detail"]["code"] == "RECORDING_NOT_ENABLED"

    async def test_requires_object_storage(self, client, db, course, livekit_env, lk_calls, monkeypatch):
        # Recordings are never written to the application filesystem.
        monkeypatch.setenv("VALIDBRIDGE_LIVE_RECORDING_ENABLED", "true")
        uuid = await _live(client, db)
        with patch("src.services.live.recordings.is_s3_enabled", return_value=False):
            resp = await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")
        assert resp.json()["detail"]["code"] == "RECORDING_STORAGE_UNAVAILABLE"

    async def test_learners_cannot_record(self, client, db, state, course, regular_user, enrolled, recording_env):
        uuid = await _live(client, db)
        state["user"] = regular_user
        assert (await client.get(f"/api/v1/live/sessions/{uuid}/classroom")).json()["recording_available"] is False
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")).status_code == 403


# ---------------------------------------------------------------------------
# Recording → storage → course lesson
# ---------------------------------------------------------------------------


class TestRecordingFlow:
    async def test_recording_becomes_a_course_lesson(self, client, db, state, org, course, chapter, admin_user,
                                                     regular_user, enrolled, recording_env):
        uuid = await _live(client, db)
        started = (await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")).json()
        assert started["status"] == "pending" and started["activity_uuid"] is None

        rec = await _recording(db, uuid)
        kwargs = recording_env["start"].await_args.kwargs
        # Written straight to R2 at the hosted-video key — no app filesystem.
        assert kwargs["filepath"] == rec.storage_key
        assert rec.storage_key == (
            f"content/orgs/{org.org_uuid}/courses/{course.course_uuid}/activities/{rec.activity_uuid}/video/recording.mp4"
        )
        assert kwargs["s3"]["bucket"] == "vb-media"
        assert (await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")).json()["detail"]["code"] == "RECORDING_ACTIVE"

        await _egress(client, db, uuid, "EGRESS_ACTIVE", "egress_started")
        assert (await _recording(db, uuid)).status == "recording"
        assert (await _load(db, uuid)).recording_status == LiveRecordingStatus.RECORDING

        # Learners are never told about a recording before it is ready.
        state["user"] = regular_user
        assert (await client.get("/api/v1/live/recordings", params={"course_uuid": "course_test"})).json() == []
        state["user"] = admin_user

        assert (await client.post(f"/api/v1/live/sessions/{uuid}/recordings/stop")).json() == {"stopped": 1}
        recording_env["stop"].assert_awaited_with(recording_env["stop"].await_args.args[0], EGRESS_ID)
        assert (await _recording(db, uuid)).status == "processing"

        await _egress(client, db, uuid, "EGRESS_COMPLETE", "egress_ended",
                      fileResults=[{"duration": str(1805 * 10**9), "size": "4200000"}])
        rec = await _recording(db, uuid)
        assert rec.status == "ready"
        assert rec.duration_seconds == 1805
        assert rec.file_size == 5_000_000  # verified from storage

        lesson = (await db.execute(select(Activity).where(Activity.activity_uuid == rec.activity_uuid))).scalars().one()
        assert lesson.activity_type == ActivityTypeEnum.TYPE_VIDEO
        assert lesson.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED
        assert lesson.content == {"filename": "recording.mp4", "activity_uuid": rec.activity_uuid}
        assert lesson.published is True
        assert lesson.name.startswith("Recording: Week 1 live lecture (")
        assert lesson.extra_metadata["live_recording"]["session_uuid"] == uuid
        link = (await db.execute(select(ChapterActivity).where(ChapterActivity.activity_id == lesson.id))).scalars().one()
        assert link.chapter_id == chapter.id
        recording_env["hls"].assert_called_once_with(rec.activity_uuid)
        assert recording_env["track"].await_args.args[0] == "live_recording_ready"

        state["user"] = regular_user
        listed = (await client.get("/api/v1/live/recordings", params={"course_uuid": "course_test"})).json()
        assert [(r["status"], r["activity_uuid"]) for r in listed] == [("ready", rec.activity_uuid)]

    async def test_draft_recordings_hidden_from_learners(self, client, db, state, course, chapter, admin_user,
                                                         regular_user, enrolled, recording_env):
        uuid = await _live(client, db, publish_recordings=False)
        await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")
        await _egress(client, db, uuid, "EGRESS_COMPLETE", "egress_ended")
        rec = await _recording(db, uuid)
        lesson = (await db.execute(select(Activity).where(Activity.activity_uuid == rec.activity_uuid))).scalars().one()
        assert lesson.published is False
        staff_view = (await client.get("/api/v1/live/recordings", params={"course_uuid": "course_test"})).json()
        assert staff_view[0]["published"] is False
        state["user"] = regular_user
        assert (await client.get("/api/v1/live/recordings", params={"course_uuid": "course_test"})).json() == []

    async def test_not_ready_until_file_is_in_storage(self, client, db, state, course, chapter, admin_user,
                                                      regular_user, enrolled, recording_env):
        from src.services.live.reconciler import reconcile_once

        uuid = await _live(client, db)
        await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")
        recording_env["storage"]["size"] = None  # upload not visible yet
        await _egress(client, db, uuid, "EGRESS_COMPLETE", "egress_ended")
        rec = await _recording(db, uuid)
        assert rec.status == "processing"
        assert (await db.execute(select(Activity).where(Activity.activity_uuid == rec.activity_uuid))).scalars().first() is None

        # It appears later: the reconciler finishes the job.
        recording_env["storage"]["size"] = 777
        await reconcile_once(db)
        assert (await _recording(db, uuid)).status == "ready"

    async def test_missing_file_eventually_fails(self, client, db, course, chapter, recording_env):
        from src.services.live.recordings import finalize_recording

        uuid = await _live(client, db)
        await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")
        recording_env["storage"]["size"] = None
        await _egress(client, db, uuid, "EGRESS_COMPLETE", "egress_ended")
        rec = await _recording(db, uuid)
        rec.ended_at = datetime.now(timezone.utc) - timedelta(hours=3)
        db.add(rec)
        await db.commit()
        await finalize_recording(db, rec)
        rec = await _recording(db, uuid)
        assert (rec.status, rec.error) == ("failed", "storage_missing")
        assert (await _load(db, uuid)).recording_status == LiveRecordingStatus.FAILED

    async def test_egress_failure_completes_lesson(self, client, db, course, chapter, recording_env):
        uuid = await _live(client, db)
        await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")
        await client.post(f"/api/v1/live/sessions/{uuid}/end")
        assert (await _load(db, uuid)).status == LiveSessionStatus.PROCESSING
        await _egress(client, db, uuid, "EGRESS_FAILED", "egress_ended")
        s = await _load(db, uuid)
        assert s.recording_status == LiveRecordingStatus.FAILED
        assert s.status == LiveSessionStatus.COMPLETED

    async def test_recordings_chapter_created_when_course_is_empty(self, client, db, org, course, recording_env):
        uuid = await _live(client, db)
        await client.post(f"/api/v1/live/sessions/{uuid}/recordings/start")
        await _egress(client, db, uuid, "EGRESS_COMPLETE", "egress_ended")
        chapters = (await db.execute(select(Chapter).where(Chapter.course_id == course.id))).scalars().all()
        assert [c.name for c in chapters] == ["Live lesson recordings"]

    async def test_auto_record_when_lesson_goes_live(self, client, db, course, chapter, admin_user, recording_env):
        uuid = (await _create(client, record_automatically=True)).json()["session_uuid"]
        await client.post(f"/api/v1/live/sessions/{uuid}/start")
        room = (await _load(db, uuid)).livekit_room_name
        now = datetime.now(timezone.utc)
        await _webhook(client, "participant_joined", room, "EV_auto", now,
                       participant=_participant(admin_user.user_uuid, "PA", "instructor", now))
        recording_env["start"].assert_awaited()
        assert (await _recording(db, uuid)).status == "pending"


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------


@pytest.fixture
async def lesson_with_activity(client, db, state, course, chapter, activity, admin_user, regular_user, enrolled,
                               livekit_env, lk_calls):
    """A finished 60-minute lesson: the learner joined 10 min late and stayed
    to the end, chatted twice (one message moderated away), asked a question
    that was answered, raised a hand, voted, and scored 50% on a live quiz."""
    uuid = (await _create(client)).json()["session_uuid"]
    await client.post(f"/api/v1/live/sessions/{uuid}/start")
    room = (await _load(db, uuid)).livekit_room_name
    t0 = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=60)
    await _webhook(client, "participant_joined", room, "EV_h", t0,
                   participant=_participant(admin_user.user_uuid, "PA_h", "instructor", t0))
    t1 = t0 + timedelta(minutes=10)
    await _webhook(client, "participant_joined", room, "EV_l", t1,
                   participant=_participant(regular_user.user_uuid, "PA_l", "learner", t1))

    state["user"] = regular_user
    base = f"/api/v1/live/sessions/{uuid}"
    kept = (await client.post(f"{base}/messages", json={"kind": "chat", "body": "hi"})).json()
    spam = (await client.post(f"{base}/messages", json={"kind": "chat", "body": "spam"})).json()
    q = (await client.post(f"{base}/messages", json={"kind": "question", "body": "why?"})).json()
    await client.post(f"{base}/hand", json={"raised": True})
    state["user"] = admin_user
    await client.delete(f"{base}/messages/{spam['message_uuid']}")
    await client.patch(f"{base}/questions/{q['message_uuid']}", json={"status": "answered"})
    poll = (await client.post(f"{base}/polls", json={"question": "Ok?", "options": ["Yes", "No"]})).json()
    state["user"] = regular_user
    await client.post(f"{base}/polls/{poll['poll_uuid']}/vote", json={"option_index": 0})
    state["user"] = admin_user
    await client.post(f"{base}/end")
    assert kept
    return uuid


class TestLiveAnalytics:
    async def test_session_report(self, client, db, state, lesson_with_activity, regular_user):
        report = (await client.get(f"/api/v1/live/sessions/{lesson_with_activity}/report")).json()
        assert report["enrolled"] == 1 and report["attendees"] == 1
        assert report["attendance_rate"] == 100.0
        assert report["late_arrivals"] == 1
        assert report["completed"] is True
        assert report["participation"] == {"messages": 1, "questions": 1, "poll_votes": 1, "quiz_answers": 0, "hand_raises": 1}
        assert report["participating_learners"] == 1 and report["participation_rate"] == 100.0
        assert report["questions_answered"] == 1
        assert report["polls"][0]["counts"] == [1, 0] and report["polls"][0]["response_rate"] == 100.0
        learner = report["learners"][0]
        assert learner["user_uuid"] == regular_user.user_uuid
        # Joined 10 minutes into a 60-minute lesson: 50/60 = 83.3%, above the
        # 75% threshold, so "late" rather than "partial".
        assert learner["attendance_status"] == "late"
        assert 83 <= learner["attendance_percent"] <= 84

        state["user"] = regular_user
        assert (await client.get(f"/api/v1/live/sessions/{lesson_with_activity}/report")).status_code == 403

    async def test_course_overview(self, client, db, lesson_with_activity):
        overview = (await client.get("/api/v1/live/courses/course_test/overview")).json()
        assert overview["sessions_held"] == 1 and overview["enrolled"] == 1
        assert overview["average_attendance_rate"] == 100.0
        assert overview["total_questions"] == 1 and overview["total_poll_votes"] == 1
        assert overview["late_arrivals"] == 1
        assert overview["sessions"][0]["session_uuid"] == lesson_with_activity

    async def test_learner_engagement_combines_lms_and_live(self, client, db, state, org, course, chapter, activity,
                                                            regular_user, lesson_with_activity):
        # LMS: one of the course's activities completed, one graded assignment
        # whose quiz task scored 8/10.
        assignment = Assignment(title="A1", description="", grading_type=GradingTypeEnum.PERCENTAGE, org_id=org.id,
                                course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
                                assignment_uuid="assignment_a1")
        db.add(assignment)
        await db.commit()
        await db.refresh(assignment)
        task = AssignmentTask(title="Q", description="", hint="", assignment_type=AssignmentTaskTypeEnum.QUIZ,
                              contents={}, max_grade_value=10, assignment_task_uuid="task_q", creation_date="now",
                              update_date="now", assignment_id=assignment.id, org_id=org.id, course_id=course.id,
                              chapter_id=chapter.id, activity_id=activity.id)
        db.add(task)
        await db.commit()
        await db.refresh(task)
        db.add(AssignmentUserSubmission(submission_status=AssignmentUserSubmissionStatus.GRADED, grade=8,
                                        user_id=regular_user.id, assignment_id=assignment.id,
                                        assignmentusersubmission_uuid="aus_1", creation_date="now", update_date="now"))
        db.add(AssignmentTaskSubmission(assignment_task_submission_uuid="ats_1", task_submission={}, grade=8,
                                        task_submission_grade_feedback="", assignment_type=AssignmentTaskTypeEnum.QUIZ,
                                        user_id=regular_user.id, activity_id=activity.id, course_id=course.id,
                                        chapter_id=chapter.id, assignment_task_id=task.id, creation_date="now",
                                        update_date="now"))
        from src.db.trail_runs import TrailRun

        run = (await db.execute(select(TrailRun).where(TrailRun.user_id == regular_user.id))).scalars().first()
        db.add(TrailStep(complete=True, teacher_verified=False, grade="", trailrun_id=run.id, trail_id=run.trail_id,
                         activity_id=activity.id, course_id=course.id, org_id=org.id, user_id=regular_user.id,
                         creation_date="now", update_date="now"))
        await db.commit()

        rows = (await client.get("/api/v1/live/courses/course_test/learners")).json()
        row = rows[0]
        assert row["user_uuid"] == regular_user.user_uuid
        assert row["activities_completed"] == 1 and row["activities_total"] == 1
        assert row["progress_percent"] == 100.0
        assert row["assignments_submitted"] == 1 and row["assignments_total"] == 1
        assert row["assignment_average_percent"] == 80.0
        assert row["quiz_average_percent"] == 80.0
        assert row["live_sessions_attended"] == 1 and row["live_sessions_held"] == 1
        assert row["live_attendance_rate"] == 100.0
        assert row["live_participation"] == 4  # 1 message, 1 question, 1 vote, 1 hand raise

        state["user"] = regular_user
        assert (await client.get("/api/v1/live/courses/course_test/learners")).status_code == 403

    async def test_dossier_includes_live_classroom(self, db, org, regular_user, lesson_with_activity):
        from src.services.audit.dossier import build_user_dossier

        dossier = await build_user_dossier(db, regular_user.id, org.id)
        live = dossier["live_classroom"]
        assert live["summary"]["sessions_attended"] == 1
        assert live["sessions"][0]["attendance_status"] == "late"
        assert dossier["summary"]["live_sessions_attended"] == 1


# ---------------------------------------------------------------------------
# AI preparation: recording transcript → course knowledge base
# ---------------------------------------------------------------------------

VTT = """WEBVTT

NOTE generated

1
00:00:00.000 --> 00:00:04.000
Today we cover <b>normalization</b>.

2
00:00:04.000 --> 00:00:08.000
Today we cover <b>normalization</b>.

3
00:00:08.000 --> 00:00:12.000
First normal form removes repeating groups.
"""


class TestTranscriptKnowledge:
    def test_vtt_to_text(self):
        assert vtt_to_text(VTT) == "Today we cover normalization. First normal form removes repeating groups."

    def test_transcript_uses_ready_source_language(self):
        lesson = Activity(name="Recording: DB (01 Oct 2026)", activity_type=ActivityTypeEnum.TYPE_VIDEO,
                          activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED, org_id=1, course_id=1,
                          activity_uuid="activity_rec", extra_metadata={"captions": {
                              "status": "partial", "source_language": "en",
                              "languages": [{"code": "fr", "status": "ready"}, {"code": "en", "status": "ready"}]}})
        reader = MagicMock(return_value=VTT.encode())
        with patch("src.services.ai.rag.content_extraction.read_file_content", reader):
            text = extract_video_transcript(lesson, "org_x", "course_y")
        assert "First normal form" in text
        assert reader.call_args.args[0] == "content/orgs/org_x/courses/course_y/activities/activity_rec/video/captions/en.vtt"

    def test_no_captions_means_no_transcript_and_no_ai_work(self):
        lesson = Activity(name="v", activity_type=ActivityTypeEnum.TYPE_VIDEO,
                          activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED, org_id=1, course_id=1,
                          activity_uuid="activity_v", extra_metadata={})
        with patch("src.services.ai.rag.content_extraction.read_file_content") as reader:
            assert extract_video_transcript(lesson, "org_x", "course_y") == ""
        reader.assert_not_called()

    async def test_course_extraction_indexes_recording_transcripts(self, db, org, course, chapter):
        lesson = Activity(name="Recording: Normalization (01 Oct 2026)", activity_type=ActivityTypeEnum.TYPE_VIDEO,
                          activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED, org_id=org.id, course_id=course.id,
                          activity_uuid="activity_rec2", published=True, content={"filename": "recording.mp4"},
                          extra_metadata={"captions": {"status": "ready", "source_language": "en",
                                                       "languages": [{"code": "en", "status": "ready"}]}})
        db.add(lesson)
        await db.commit()
        with patch("src.services.ai.rag.content_extraction.read_file_content", return_value=VTT.encode()):
            items = await extract_all_course_content(course.id, org.id, db)
        transcript = [i for i in items if i["source_type"] == "video_transcript"]
        assert len(transcript) == 1
        assert transcript[0]["activity_name"] == "Recording: Normalization (01 Oct 2026)"
        assert "repeating groups" in transcript[0]["text"]



class TestMyLiveLessons:
    async def test_student_sees_lessons_of_enrolled_courses(self, client, db, state, org, course, regular_user,
                                                            enrolled, livekit_env, lk_calls):
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        upcoming = (await _create(client, scheduled_at=tomorrow)).json()["session_uuid"]
        live = await _live(client, db)
        state["user"] = regular_user
        data = (await client.get("/api/v1/live/me", params={"org_id": org.id})).json()
        assert [s["session_uuid"] for s in data["sessions"]] == [live, upcoming]  # live first
        assert data["sessions"][0]["course_name"] == "Test Course"
        assert data["sessions"][0]["is_staff"] is False
        assert (await client.get("/api/v1/live/me", params={"org_id": 999})).json()["sessions"] == []

    async def test_unenrolled_student_sees_nothing(self, client, db, state, course, regular_user, livekit_env, lk_calls):
        await _create(client)
        state["user"] = regular_user
        assert (await client.get("/api/v1/live/me")).json() == {"sessions": [], "recordings": []}
