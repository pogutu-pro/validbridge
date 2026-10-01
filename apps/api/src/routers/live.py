"""Live classroom sessions.

``router`` is mounted behind ``require_authenticated_user`` (no anonymous
callers, no API tokens). ``webhook_router`` is public and authenticated by
LiveKit's signed webhook JWT instead.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.live_sessions import (
    LiveAttendanceRead,
    LiveClassroomRead,
    LiveHandUpdate,
    LiveJoinResponse,
    LiveMediaPermissionUpdate,
    LiveMessageCreate,
    LiveMessageRead,
    LiveMuteRequest,
    LivePollCreate,
    LivePollRead,
    LivePollVoteCreate,
    LiveQuestionUpdate,
    LiveQuizAnswerCreate,
    LiveQuizCreate,
    LiveQuizRead,
    LiveQuizSourceRead,
    LiveCourseOverview,
    LiveMyLessons,
    LiveLearnerEngagement,
    LiveRecordingRead,
    LiveSessionReport,
    LiveReactionCreate,
    LiveSessionCreate,
    LiveSessionRead,
    LiveStageUpdate,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.live import classroom, insights, invitations, livekit, quizzes, recordings
from src.services.live.sessions import (
    create_session,
    end_session,
    get_attendance,
    get_classroom,
    get_session,
    join_session,
    list_course_sessions,
    require_livekit,
    start_session,
)
from src.services.live.telemetry import log_event
from src.services.live.webhooks import handle_webhook

logger = logging.getLogger(__name__)

router = APIRouter()
webhook_router = APIRouter()

_COMMON_ERRORS = {
    401: {"description": "Authentication required"},
    403: {"description": "Not allowed for this course or session"},
    404: {"description": "Live session or course not found"},
}


@router.get(
    "/me",
    response_model=LiveMyLessons,
    summary="My live lessons",
    description="Upcoming and live lessons plus ready recordings for the courses the caller is enrolled in or teaches.",
)
async def api_my_live_lessons(
    org_id: Optional[int] = None,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveMyLessons:
    return await insights.my_live_lessons(db_session, current_user, org_id)


@router.post(
    "/sessions",
    response_model=LiveSessionRead,
    summary="Schedule a live session",
    description="Schedule a live session for a course (optionally linked to one of its activities). Requires write access to the course; the caller becomes the instructor.",
    responses=_COMMON_ERRORS,
)
async def api_create_live_session(
    request: Request,
    payload: LiveSessionCreate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveSessionRead:
    return await create_session(request, db_session, current_user, payload)


@router.get(
    "/sessions",
    response_model=List[LiveSessionRead],
    summary="List a course's live sessions",
    description="List live sessions of a course the caller can read, ordered by scheduled time.",
    responses=_COMMON_ERRORS,
)
async def api_list_live_sessions(
    request: Request,
    course_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[LiveSessionRead]:
    return await list_course_sessions(request, db_session, current_user, course_uuid)


@router.get(
    "/sessions/{session_uuid}",
    response_model=LiveSessionRead,
    summary="Get a live session",
    responses=_COMMON_ERRORS,
)
async def api_get_live_session(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveSessionRead:
    return await get_session(request, db_session, current_user, session_uuid)


@router.post(
    "/sessions/{session_uuid}/start",
    response_model=LiveSessionRead,
    summary="Start a live session",
    description="Provision the LiveKit room and move the session to READY. It becomes LIVE once an instructor or moderator connects. Idempotent.",
    responses={**_COMMON_ERRORS, 409: {"description": "Session already ended"}, 502: {"description": "LiveKit unavailable"}, 503: {"description": "Live classrooms not configured"}},
)
async def api_start_live_session(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveSessionRead:
    return await start_session(request, db_session, current_user, session_uuid)


@router.post(
    "/sessions/{session_uuid}/join",
    response_model=LiveJoinResponse,
    summary="Join a live session",
    description="Issue a short-lived LiveKit access token for the calling user. Staff may join READY or LIVE sessions; enrolled learners only LIVE ones.",
    responses={**_COMMON_ERRORS, 402: {"description": "Payment required"}, 409: {"description": "Session not joinable in its current state"}, 503: {"description": "Live classrooms not configured"}},
)
async def api_join_live_session(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveJoinResponse:
    return await join_session(request, db_session, current_user, session_uuid)


@router.post(
    "/sessions/{session_uuid}/end",
    response_model=LiveSessionRead,
    summary="End a live session",
    description="End the session for everyone, close attendance and tear down the room. Idempotent.",
    responses={**_COMMON_ERRORS, 409: {"description": "Session was never started"}},
)
async def api_end_live_session(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveSessionRead:
    return await end_session(request, db_session, current_user, session_uuid)


@router.post(
    "/sessions/{session_uuid}/invitations",
    response_model=invitations.LiveInvitationResult,
    summary="Email a live lesson invitation",
    description=(
        "Staff only. Emails the classroom link to the listed addresses and/or every enrolled "
        "student. The link grants nothing by itself: joining still enforces course access."
    ),
    responses={**_COMMON_ERRORS, 409: {"description": "Lesson has ended"}, 429: {"description": "Too many sends"}},
)
async def api_send_live_invitations(
    request: Request,
    session_uuid: str,
    payload: invitations.LiveInvitationCreate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> invitations.LiveInvitationResult:
    return await invitations.send_invitations(request, db_session, current_user, session_uuid, payload)


@router.get(
    "/sessions/{session_uuid}/attendance",
    response_model=LiveAttendanceRead,
    summary="Get live session attendance",
    description="Participants and attendance for a session. Course staff only.",
    responses=_COMMON_ERRORS,
)
async def api_get_live_session_attendance(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveAttendanceRead:
    return await get_attendance(request, db_session, current_user, session_uuid)


@router.get(
    "/sessions/{session_uuid}/classroom",
    response_model=LiveClassroomRead,
    summary="Classroom bootstrap",
    description="The session plus the caller's role and moderation state. Fails if the caller may not take part.",
    responses=_COMMON_ERRORS,
)
async def api_get_live_classroom(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveClassroomRead:
    return await get_classroom(request, db_session, current_user, session_uuid)


# -- Chat + questions --------------------------------------------------------


@router.get("/sessions/{session_uuid}/messages", response_model=List[LiveMessageRead], summary="List chat messages or questions")
async def api_list_live_messages(
    request: Request,
    session_uuid: str,
    kind: str = "chat",
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[LiveMessageRead]:
    return await classroom.list_messages(request, db_session, current_user, session_uuid, kind)


@router.post("/sessions/{session_uuid}/messages", response_model=LiveMessageRead, summary="Send a chat message or ask a question")
async def api_create_live_message(
    request: Request,
    session_uuid: str,
    payload: LiveMessageCreate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveMessageRead:
    return await classroom.create_message(request, db_session, current_user, session_uuid, payload)


@router.delete("/sessions/{session_uuid}/messages/{message_uuid}", summary="Delete a message (own, or any as staff)")
async def api_delete_live_message(
    request: Request,
    session_uuid: str,
    message_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    await classroom.delete_message(request, db_session, current_user, session_uuid, message_uuid)
    return {"ok": True}


@router.patch("/sessions/{session_uuid}/questions/{message_uuid}", response_model=LiveMessageRead, summary="Mark a question answered/dismissed (staff)")
async def api_update_live_question(
    request: Request,
    session_uuid: str,
    message_uuid: str,
    payload: LiveQuestionUpdate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveMessageRead:
    return await classroom.update_question(
        request, db_session, current_user, session_uuid, message_uuid, payload.status, payload.answer
    )


# -- Polls -------------------------------------------------------------------


@router.get("/sessions/{session_uuid}/polls", response_model=List[LivePollRead], summary="List polls")
async def api_list_live_polls(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[LivePollRead]:
    return await classroom.list_polls(request, db_session, current_user, session_uuid)


@router.post("/sessions/{session_uuid}/polls", response_model=LivePollRead, summary="Launch a poll (staff)")
async def api_create_live_poll(
    request: Request,
    session_uuid: str,
    payload: LivePollCreate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LivePollRead:
    return await classroom.create_poll(request, db_session, current_user, session_uuid, payload)


@router.post("/sessions/{session_uuid}/polls/{poll_uuid}/close", response_model=LivePollRead, summary="Close a poll (staff)")
async def api_close_live_poll(
    request: Request,
    session_uuid: str,
    poll_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LivePollRead:
    return await classroom.close_poll(request, db_session, current_user, session_uuid, poll_uuid)


@router.post("/sessions/{session_uuid}/polls/{poll_uuid}/vote", response_model=LivePollRead, summary="Vote in a poll")
async def api_vote_live_poll(
    request: Request,
    session_uuid: str,
    poll_uuid: str,
    payload: LivePollVoteCreate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LivePollRead:
    return await classroom.vote_poll(request, db_session, current_user, session_uuid, poll_uuid, payload.option_index)


# -- Hand raise + reactions ----------------------------------------------------


@router.post("/sessions/{session_uuid}/hand", summary="Raise or lower your hand")
async def api_set_live_hand(
    request: Request,
    session_uuid: str,
    payload: LiveHandUpdate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    await classroom.set_own_hand(request, db_session, current_user, session_uuid, payload.raised)
    return {"ok": True}


@router.post("/sessions/{session_uuid}/reactions", summary="Send a reaction")
async def api_send_live_reaction(
    request: Request,
    session_uuid: str,
    payload: LiveReactionCreate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    await classroom.send_reaction(request, db_session, current_user, session_uuid, payload.emoji)
    return {"ok": True}


# -- Moderation (staff) ----------------------------------------------------------


@router.post("/sessions/{session_uuid}/participants/{identity}/lower-hand", summary="Lower a participant's hand (staff)")
async def api_lower_live_hand(
    request: Request,
    session_uuid: str,
    identity: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    await classroom.lower_hand(request, db_session, current_user, session_uuid, identity)
    return {"ok": True}


@router.post("/sessions/{session_uuid}/participants/{identity}/mute", summary="Mute a participant's track (staff)")
async def api_mute_live_participant(
    request: Request,
    session_uuid: str,
    identity: str,
    payload: LiveMuteRequest,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    await classroom.mute_participant(request, db_session, current_user, session_uuid, identity, payload.source)
    return {"ok": True}


@router.post("/sessions/{session_uuid}/participants/{identity}/media", summary="Allow or revoke a learner's camera and microphone (staff)")
async def api_set_live_media_permission(
    request: Request,
    session_uuid: str,
    identity: str,
    payload: LiveMediaPermissionUpdate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    await classroom.set_media_permission(request, db_session, current_user, session_uuid, identity, payload.allowed)
    return {"ok": True}


@router.post("/sessions/{session_uuid}/participants/{identity}/remove", summary="Remove a participant from the session (staff)")
async def api_remove_live_participant(
    request: Request,
    session_uuid: str,
    identity: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    await classroom.remove_participant(request, db_session, current_user, session_uuid, identity)
    return {"ok": True}


# -- Stage -----------------------------------------------------------------------


@router.post("/sessions/{session_uuid}/stage", summary="Set the main stage focus: presentation or camera (staff)")
async def api_set_live_stage(
    request: Request,
    session_uuid: str,
    payload: LiveStageUpdate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    await classroom.set_stage_focus(request, db_session, current_user, session_uuid, payload.focus)
    return {"ok": True}


# -- Live quizzes ------------------------------------------------------------------


@router.get("/sessions/{session_uuid}/quiz-sources", response_model=List[LiveQuizSourceRead], summary="Quizzes in this course that can run live (staff)")
async def api_list_live_quiz_sources(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[LiveQuizSourceRead]:
    return await quizzes.list_sources(request, db_session, current_user, session_uuid)


@router.post("/sessions/{session_uuid}/quizzes", response_model=LiveQuizRead, summary="Launch a live quiz (staff)")
async def api_start_live_quiz(
    request: Request,
    session_uuid: str,
    payload: LiveQuizCreate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveQuizRead:
    return await quizzes.start_quiz(request, db_session, current_user, session_uuid, payload)


@router.get("/sessions/{session_uuid}/quizzes/current", response_model=Optional[LiveQuizRead], summary="The running (or last) live quiz, as the caller may see it")
async def api_get_current_live_quiz(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> Optional[LiveQuizRead]:
    return await quizzes.get_current_quiz(request, db_session, current_user, session_uuid)


@router.post("/sessions/{session_uuid}/quizzes/{quiz_uuid}/answers", response_model=LiveQuizRead, summary="Answer the current quiz question")
async def api_answer_live_quiz(
    request: Request,
    session_uuid: str,
    quiz_uuid: str,
    payload: LiveQuizAnswerCreate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveQuizRead:
    return await quizzes.submit_answer(request, db_session, current_user, session_uuid, quiz_uuid, payload)


@router.post("/sessions/{session_uuid}/quizzes/{quiz_uuid}/next", response_model=LiveQuizRead, summary="Open the next question, or finish after the last (staff)")
async def api_next_live_quiz_question(
    request: Request,
    session_uuid: str,
    quiz_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveQuizRead:
    return await quizzes.next_question(request, db_session, current_user, session_uuid, quiz_uuid)


@router.post("/sessions/{session_uuid}/quizzes/{quiz_uuid}/finish", response_model=LiveQuizRead, summary="Finish a live quiz (staff)")
async def api_finish_live_quiz(
    request: Request,
    session_uuid: str,
    quiz_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveQuizRead:
    return await quizzes.finish_quiz(request, db_session, current_user, session_uuid, quiz_uuid)


# -- Recordings --------------------------------------------------------------------


@router.post("/sessions/{session_uuid}/recordings/start", response_model=LiveRecordingRead, summary="Start recording the lesson (staff)")
async def api_start_live_recording(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveRecordingRead:
    return await recordings.start_recording(request, db_session, current_user, session_uuid)


@router.post("/sessions/{session_uuid}/recordings/stop", summary="Stop recording the lesson (staff)")
async def api_stop_live_recording(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    return {"stopped": await recordings.stop_recording(request, db_session, current_user, session_uuid)}


@router.get("/sessions/{session_uuid}/recordings", response_model=List[LiveRecordingRead], summary="Recordings of a lesson")
async def api_list_live_session_recordings(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[LiveRecordingRead]:
    return await recordings.list_session_recordings(request, db_session, current_user, session_uuid)


@router.get("/recordings", response_model=List[LiveRecordingRead], summary="Live lesson recordings of a course")
async def api_list_live_course_recordings(
    request: Request,
    course_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[LiveRecordingRead]:
    return await recordings.list_course_recordings(request, db_session, current_user, course_uuid)


# -- Analytics (course staff) -------------------------------------------------------


@router.get("/sessions/{session_uuid}/report", response_model=LiveSessionReport, summary="Full analytics for one lesson (staff)")
async def api_get_live_session_report(
    request: Request,
    session_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveSessionReport:
    return await insights.session_report(request, db_session, current_user, session_uuid)


@router.get("/courses/{course_uuid}/overview", response_model=LiveCourseOverview, summary="Live classroom analytics for a course (staff)")
async def api_get_live_course_overview(
    request: Request,
    course_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveCourseOverview:
    return await insights.course_overview(request, db_session, current_user, course_uuid)


@router.get("/courses/{course_uuid}/learners", response_model=List[LiveLearnerEngagement], summary="Learner engagement: course progress, assignments, quizzes and live participation (staff)")
async def api_get_live_learner_engagement(
    request: Request,
    course_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[LiveLearnerEngagement]:
    return await insights.learner_engagement(request, db_session, current_user, course_uuid)


@webhook_router.post(
    "/webhook",
    summary="LiveKit webhook receiver",
    description="Receives LiveKit server webhooks. Authenticated by LiveKit's signed JWT over the request body.",
    include_in_schema=False,
)
async def api_livekit_webhook(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    settings = require_livekit()
    body = await request.body()
    try:
        payload = livekit.verify_webhook(settings, body, request.headers.get("Authorization"))
    except livekit.WebhookVerificationError as exc:
        log_event("webhook.rejected", logging.WARNING, reason=str(exc), body_bytes=len(body))
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    # Errors propagate as 5xx so LiveKit retries the delivery.
    try:
        await handle_webhook(db_session, payload)
    except Exception as exc:
        log_event(
            "webhook.failed",
            logging.ERROR,
            event=payload.get("event"),
            error=type(exc).__name__,
        )
        raise
    return {"ok": True}
