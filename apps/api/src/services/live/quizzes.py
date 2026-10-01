"""Live quizzes: run an existing ValidBridge quiz in the classroom.

No second quiz system. Questions come from what the course already has —
assignment QUIZ tasks and editor quiz blocks — normalised to the assignment
QUIZ shape (``questionUUID / questionText / options[].assigned_right_answer``)
and scored by the same grader the assignments use (``quiz_modes``).

The lecturer paces it one timed question at a time. The server owns the clock:
an answer is accepted only for the current question and before its deadline
(plus a small network grace). Correct answers are never sent to learners until
the question has closed.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Iterator, Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask, AssignmentTaskTypeEnum
from src.db.courses.courses import Course
from src.db.live_sessions import (
    LiveQuiz,
    LiveQuizAnswer,
    LiveQuizAnswerCreate,
    LiveQuizCreate,
    LiveQuizOptionRead,
    LiveQuizQuestionRead,
    LiveQuizQuestionStats,
    LiveQuizRead,
    LiveQuizResults,
    LiveQuizSourceRead,
    LiveQuizStatus,
    LiveSession,
    utcnow,
)
from src.db.user_audit_events import UserAuditEventType
from src.services.analytics import events as analytics_events
from src.services.analytics.analytics import track
from src.services.audit.audit import record_audit_event
from src.services.courses.activities.quiz_modes import (
    GRADING_MODE_ALL_OR_NOTHING,
    resolve_grading_mode,
    resolve_response_type,
    score_question,
)
from src.services.live.attendance import as_utc
from src.services.live.classroom import (
    TOPIC_QUIZ,
    ClassroomContext,
    _broadcast,
    _context,
    _require_staff,
)
from src.services.live.sessions import _error

logger = logging.getLogger(__name__)

SOURCE_ASSIGNMENT = "assignment_task"
SOURCE_BLOCK = "quiz_block"

# Answers submitted this long after the deadline still count (network latency).
ANSWER_GRACE_SECONDS = 2
_MAX_QUESTIONS = 50


# ---------------------------------------------------------------------------
# Sources → normalised questions
# ---------------------------------------------------------------------------


def _gradable(question: dict) -> bool:
    options = question.get("options") or []
    return bool(options) and any(o.get("assigned_right_answer") for o in options)


def _normalise_assignment_question(q: dict) -> Optional[dict]:
    if not isinstance(q, dict):
        return None
    options = [
        {
            "optionUUID": str(o.get("optionUUID") or ""),
            "text": str(o.get("text") or ""),
            "assigned_right_answer": bool(o.get("assigned_right_answer")),
        }
        for o in (q.get("options") or [])
        if isinstance(o, dict) and o.get("optionUUID")
    ]
    question = {
        "questionUUID": str(q.get("questionUUID") or f"question_{uuid4()}"),
        "questionText": str(q.get("questionText") or ""),
        "options": options,
    }
    question["response_type"] = resolve_response_type({**q, "options": q.get("options") or []})
    return question if _gradable(question) else None


def _normalise_block_question(q: dict) -> Optional[dict]:
    """Editor ``blockQuiz`` question → assignment QUIZ shape."""
    if not isinstance(q, dict):
        return None
    options = [
        {
            "optionUUID": str(a.get("answer_id") or ""),
            "text": str(a.get("answer") or ""),
            "assigned_right_answer": bool(a.get("correct")),
        }
        for a in (q.get("answers") or [])
        if isinstance(a, dict) and a.get("answer_id")
    ]
    question = {
        "questionUUID": str(q.get("question_id") or f"question_{uuid4()}"),
        "questionText": str(q.get("question") or ""),
        "options": options,
    }
    raw_type = q.get("response_type")
    question["response_type"] = resolve_response_type(
        {"response_type": raw_type, "options": options} if raw_type else {"options": options}
    )
    return question if _gradable(question) else None


def _quiz_blocks(node) -> Iterator[dict]:
    """Every ``blockQuiz`` node's attrs inside a Tiptap document."""
    if isinstance(node, dict):
        if node.get("type") == "blockQuiz" and isinstance(node.get("attrs"), dict):
            yield node["attrs"]
        for child in node.get("content") or []:
            yield from _quiz_blocks(child)
    elif isinstance(node, list):
        for child in node:
            yield from _quiz_blocks(child)


def _block_questions(attrs: dict) -> list[dict]:
    return [q for q in (_normalise_block_question(x) for x in (attrs.get("questions") or [])) if q]


def _assignment_questions(contents: dict) -> list[dict]:
    return [q for q in (_normalise_assignment_question(x) for x in (contents.get("questions") or [])) if q]


async def list_sources(request: Request, db: AsyncSession, user, session_uuid: str) -> list[LiveQuizSourceRead]:
    ctx = await _context(request, db, user, session_uuid)
    _require_staff(ctx)
    sources: list[LiveQuizSourceRead] = []

    rows = (
        await db.execute(
            select(AssignmentTask, Assignment)
            .join(Assignment, Assignment.id == AssignmentTask.assignment_id)
            .where(
                AssignmentTask.course_id == ctx.course.id,
                AssignmentTask.assignment_type == AssignmentTaskTypeEnum.QUIZ,
            )
        )
    ).all()
    for task, assignment in rows:
        count = len(_assignment_questions(task.contents or {}))
        if count:
            sources.append(
                LiveQuizSourceRead(
                    source_id=f"task:{task.assignment_task_uuid}",
                    origin="assignment",
                    title=task.title or assignment.title,
                    context=assignment.title,
                    question_count=count,
                )
            )

    activities = (
        await db.execute(select(Activity).where(Activity.course_id == ctx.course.id))
    ).scalars().all()
    for activity in activities:
        for index, attrs in enumerate(_quiz_blocks(activity.content or {})):
            quiz_id = attrs.get("quizId")
            count = len(_block_questions(attrs))
            if quiz_id and count:
                sources.append(
                    LiveQuizSourceRead(
                        source_id=f"block:{activity.activity_uuid}:{quiz_id}",
                        origin="lesson",
                        title=activity.name if index == 0 else f"{activity.name} ({index + 1})",
                        context=activity.name,
                        question_count=count,
                    )
                )
    return sources


async def _load_source(db: AsyncSession, course: Course, source_id: str) -> tuple[str, str, str, list[dict], str]:
    """(source_type, ref, title, questions, grading_mode) for a source id."""
    kind, _, ref = source_id.partition(":")
    if kind == "task":
        row = (
            await db.execute(
                select(AssignmentTask, Assignment)
                .join(Assignment, Assignment.id == AssignmentTask.assignment_id)
                .where(
                    AssignmentTask.assignment_task_uuid == ref,
                    AssignmentTask.course_id == course.id,
                    AssignmentTask.assignment_type == AssignmentTaskTypeEnum.QUIZ,
                )
            )
        ).first()
        if row:
            task, assignment = row
            contents = task.contents or {}
            return (
                SOURCE_ASSIGNMENT,
                ref,
                task.title or assignment.title,
                _assignment_questions(contents),
                resolve_grading_mode(contents),
            )
    elif kind == "block":
        activity_uuid, _, quiz_id = ref.partition(":")
        activity = (
            await db.execute(
                select(Activity).where(Activity.activity_uuid == activity_uuid, Activity.course_id == course.id)
            )
        ).scalars().first()
        if activity:
            for attrs in _quiz_blocks(activity.content or {}):
                if attrs.get("quizId") == quiz_id:
                    return SOURCE_BLOCK, ref, activity.name, _block_questions(attrs), GRADING_MODE_ALL_OR_NOTHING
    raise HTTPException(status_code=404, detail="Quiz not found in this course")


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------


def _question_closed(quiz: LiveQuiz, index: int, now: datetime) -> bool:
    if quiz.status == LiveQuizStatus.FINISHED.value or index < quiz.current_index:
        return True
    deadline = as_utc(quiz.question_deadline)
    return index == quiz.current_index and deadline is not None and now > deadline


def _stats(answers: list[LiveQuizAnswer]) -> LiveQuizQuestionStats:
    correct = sum(1 for a in answers if a.is_correct)
    return LiveQuizQuestionStats(
        answered=len(answers),
        correct=correct,
        incorrect=len(answers) - correct,
        average_percent=round(sum(a.score for a in answers) * 100 / len(answers), 1) if answers else None,
    )


def _question_read(
    quiz: LiveQuiz,
    index: int,
    answers: list[LiveQuizAnswer],
    mine: Optional[LiveQuizAnswer],
    *,
    is_staff: bool,
    now: datetime,
) -> LiveQuizQuestionRead:
    question = quiz.questions[index]
    closed = _question_closed(quiz, index, now)
    reveal = is_staff or closed
    picks: dict[str, int] = {}
    for a in answers:
        for option_id in a.selected or []:
            picks[option_id] = picks.get(option_id, 0) + 1
    return LiveQuizQuestionRead(
        index=index,
        text=question.get("questionText", ""),
        response_type=question.get("response_type", "single"),
        options=[
            LiveQuizOptionRead(
                option_uuid=o["optionUUID"],
                text=o.get("text", ""),
                correct=bool(o.get("assigned_right_answer")) if reveal else None,
                picks=picks.get(o["optionUUID"], 0) if reveal else None,
            )
            for o in question.get("options") or []
        ],
        closed=closed,
        my_answer=list(mine.selected) if mine else None,
        my_correct=mine.is_correct if mine and closed else None,
        my_score=mine.score if mine and closed else None,
        stats=_stats(answers) if reveal else None,
    )


def _results(quiz: LiveQuiz, answers: list[LiveQuizAnswer], user_id: int) -> LiveQuizResults:
    reached = len(quiz.questions) if quiz.status == LiveQuizStatus.FINISHED.value else quiz.current_index + 1
    by_user: dict[int, list[LiveQuizAnswer]] = {}
    for a in answers:
        by_user.setdefault(a.user_id, []).append(a)
    # Unanswered questions count as 0: the score is out of every question asked.
    percents = [sum(a.score for a in user_answers) * 100 / max(reached, 1) for user_answers in by_user.values()]
    mine = by_user.get(user_id)
    correct = sum(1 for a in answers if a.is_correct)
    return LiveQuizResults(
        participants=len(by_user),
        correct=correct,
        incorrect=len(answers) - correct,
        average_percent=round(sum(percents) / len(percents), 1) if percents else None,
        my_percent=round(sum(a.score for a in mine) * 100 / max(reached, 1), 1) if mine else None,
        my_correct=sum(1 for a in mine if a.is_correct) if mine else None,
    )


async def _answers(db: AsyncSession, quiz: LiveQuiz) -> list[LiveQuizAnswer]:
    return list((await db.execute(select(LiveQuizAnswer).where(LiveQuizAnswer.quiz_id == quiz.id))).scalars().all())


async def _view(db: AsyncSession, quiz: LiveQuiz, ctx: ClassroomContext) -> LiveQuizRead:
    now = utcnow()
    answers = await _answers(db, quiz)
    by_question: dict[int, list[LiveQuizAnswer]] = {}
    for a in answers:
        by_question.setdefault(a.question_index, []).append(a)
    mine = {a.question_index: a for a in answers if a.user_id == ctx.user.id}
    finished = quiz.status == LiveQuizStatus.FINISHED.value

    def read(index: int) -> LiveQuizQuestionRead:
        return _question_read(
            quiz, index, by_question.get(index, []), mine.get(index), is_staff=ctx.is_staff, now=now
        )

    results = _results(quiz, answers, ctx.user.id)
    if not ctx.is_staff and not finished:
        # Learners see only their own running totals mid-quiz.
        results = LiveQuizResults(
            participants=0, correct=0, incorrect=0, my_percent=results.my_percent, my_correct=results.my_correct
        )
    return LiveQuizRead(
        quiz_uuid=quiz.quiz_uuid,
        title=quiz.title,
        status=LiveQuizStatus(quiz.status),
        question_count=len(quiz.questions),
        current_index=quiz.current_index,
        seconds_per_question=quiz.seconds_per_question,
        question_deadline=as_utc(quiz.question_deadline),
        server_time=now,
        current=None if finished else read(quiz.current_index),
        questions=[read(i) for i in range(min(quiz.current_index + 1, len(quiz.questions)))] if ctx.is_staff else None,
        results=results,
    )


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


async def _get_quiz(db: AsyncSession, session: LiveSession, quiz_uuid: str) -> LiveQuiz:
    quiz = (
        await db.execute(select(LiveQuiz).where(LiveQuiz.quiz_uuid == quiz_uuid, LiveQuiz.session_id == session.id))
    ).scalars().first()
    if quiz is None:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return quiz


async def _running_quiz(db: AsyncSession, session: LiveSession) -> Optional[LiveQuiz]:
    return (
        await db.execute(
            select(LiveQuiz).where(
                LiveQuiz.session_id == session.id, LiveQuiz.status == LiveQuizStatus.RUNNING.value
            )
        )
    ).scalars().first()


async def start_quiz(
    request: Request, db: AsyncSession, user, session_uuid: str, payload: LiveQuizCreate
) -> LiveQuizRead:
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    _require_staff(ctx)
    if await _running_quiz(db, ctx.session):
        raise _error(409, "QUIZ_RUNNING", "Finish the current quiz first")
    source_type, ref, title, questions, grading_mode = await _load_source(db, ctx.course, payload.source_id)
    if not questions:
        raise _error(422, "QUIZ_EMPTY", "This quiz has no questions that can be scored automatically")

    now = utcnow()
    quiz = LiveQuiz(
        quiz_uuid=f"livequiz_{uuid4()}",
        session_id=ctx.session.id,
        org_id=ctx.session.org_id,
        created_by_id=ctx.user.id,
        source_type=source_type,
        source_ref=ref[:200],
        title=title[:300],
        questions=questions[:_MAX_QUESTIONS],
        grading_mode=grading_mode,
        seconds_per_question=payload.seconds_per_question,
        current_index=0,
        question_started_at=now,
        question_deadline=now + timedelta(seconds=payload.seconds_per_question),
    )
    db.add(quiz)
    await db.commit()
    await db.refresh(quiz)
    await _broadcast(ctx.session, TOPIC_QUIZ, {"type": "question", "quiz_uuid": quiz.quiz_uuid, "index": 0})
    return await _view(db, quiz, ctx)


async def get_current_quiz(request: Request, db: AsyncSession, user, session_uuid: str) -> Optional[LiveQuizRead]:
    """The running quiz, else the most recent finished one (for its results)."""
    ctx = await _context(request, db, user, session_uuid)
    quiz = await _running_quiz(db, ctx.session)
    if quiz is None:
        quiz = (
            await db.execute(
                select(LiveQuiz)
                .where(LiveQuiz.session_id == ctx.session.id)
                .order_by(LiveQuiz.created_at.desc(), LiveQuiz.id.desc())
            )
        ).scalars().first()
    return await _view(db, quiz, ctx) if quiz else None


async def submit_answer(
    request: Request, db: AsyncSession, user, session_uuid: str, quiz_uuid: str, payload: LiveQuizAnswerCreate
) -> LiveQuizRead:
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    if ctx.is_staff:
        raise _error(403, "QUIZ_STAFF_CANNOT_ANSWER", "Lecturers don't answer live quizzes")
    quiz = await _get_quiz(db, ctx.session, quiz_uuid)
    now = utcnow()
    deadline = as_utc(quiz.question_deadline)
    if (
        quiz.status != LiveQuizStatus.RUNNING.value
        or payload.question_index != quiz.current_index
        or deadline is None
        or now > deadline + timedelta(seconds=ANSWER_GRACE_SECONDS)
    ):
        raise _error(409, "QUIZ_QUESTION_CLOSED", "Time's up for this question")

    question = quiz.questions[quiz.current_index]
    valid_ids = {o["optionUUID"] for o in question.get("options") or []}
    selected = list(dict.fromkeys(payload.option_uuids))
    if not selected or any(option_id not in valid_ids for option_id in selected):
        raise HTTPException(status_code=422, detail="Choose one of the options")
    response_type = question.get("response_type", "single")
    if response_type == "single" and len(selected) != 1:
        raise HTTPException(status_code=422, detail="Choose exactly one option")

    score = score_question(
        [(bool(o.get("assigned_right_answer")), o["optionUUID"] in selected) for o in question.get("options") or []],
        response_type,
        quiz.grading_mode,
    )
    try:
        async with db.begin_nested():
            db.add(
                LiveQuizAnswer(
                    quiz_id=quiz.id,
                    user_id=ctx.user.id,
                    question_index=quiz.current_index,
                    selected=selected,
                    score=score,
                    is_correct=score >= 1.0,
                )
            )
    except IntegrityError:
        raise _error(409, "QUIZ_ALREADY_ANSWERED", "You've already answered this question")
    await db.commit()
    await _broadcast_progress(db, ctx.session, quiz)
    return await _view(db, quiz, ctx)


async def _broadcast_progress(db: AsyncSession, session: LiveSession, quiz: LiveQuiz) -> None:
    """Tell staff clients to refresh live results, at most ~once a second."""
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is not None:
            fresh = await asyncio.to_thread(
                client.set, f"validbridge:live:quizcast:{quiz.quiz_uuid}", "1", nx=True, px=900
            )
            if not fresh:
                return
    except Exception:  # pragma: no cover - throttling is an optimisation
        pass
    await _broadcast(
        session, TOPIC_QUIZ, {"type": "progress", "quiz_uuid": quiz.quiz_uuid, "index": quiz.current_index}
    )


async def next_question(request: Request, db: AsyncSession, user, session_uuid: str, quiz_uuid: str) -> LiveQuizRead:
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    _require_staff(ctx)
    quiz = await _get_quiz(db, ctx.session, quiz_uuid)
    if quiz.status != LiveQuizStatus.RUNNING.value:
        raise _error(409, "QUIZ_FINISHED", "This quiz has finished")
    if quiz.current_index + 1 >= len(quiz.questions):
        await _finish(db, ctx.session, quiz, broadcast=True)
        return await _view(db, quiz, ctx)
    now = utcnow()
    quiz.current_index += 1
    quiz.question_started_at = now
    quiz.question_deadline = now + timedelta(seconds=quiz.seconds_per_question)
    db.add(quiz)
    await db.commit()
    await db.refresh(quiz)
    await _broadcast(
        ctx.session, TOPIC_QUIZ, {"type": "question", "quiz_uuid": quiz.quiz_uuid, "index": quiz.current_index}
    )
    return await _view(db, quiz, ctx)


async def finish_quiz(request: Request, db: AsyncSession, user, session_uuid: str, quiz_uuid: str) -> LiveQuizRead:
    ctx = await _context(request, db, user, session_uuid)
    _require_staff(ctx)
    quiz = await _get_quiz(db, ctx.session, quiz_uuid)
    await _finish(db, ctx.session, quiz, broadcast=True)
    return await _view(db, quiz, ctx)


async def finish_running_quizzes(db: AsyncSession, session: LiveSession) -> None:
    quiz = await _running_quiz(db, session)
    if quiz is not None:
        await _finish(db, session, quiz, broadcast=False)


async def _finish(db: AsyncSession, session: LiveSession, quiz: LiveQuiz, *, broadcast: bool) -> None:
    """Finish a quiz (idempotent) and emit its analytics exactly once."""
    if quiz.status == LiveQuizStatus.FINISHED.value:
        return
    now = utcnow()
    quiz.status = LiveQuizStatus.FINISHED.value
    quiz.finished_at = now
    deadline = as_utc(quiz.question_deadline)
    if deadline is None or deadline > now:
        quiz.question_deadline = now  # closes the current question
    db.add(quiz)
    await db.commit()
    await db.refresh(quiz)
    if broadcast:
        await _broadcast(session, TOPIC_QUIZ, {"type": "finished", "quiz_uuid": quiz.quiz_uuid})
    await _emit_quiz_analytics(db, session, quiz)


async def _emit_quiz_analytics(db: AsyncSession, session: LiveSession, quiz: LiveQuiz) -> None:
    try:
        answers = await _answers(db, quiz)
        total = len(quiz.questions)
        by_user: dict[int, list[LiveQuizAnswer]] = {}
        for a in answers:
            by_user.setdefault(a.user_id, []).append(a)
        percents = []
        for user_id, user_answers in by_user.items():
            percent = round(sum(a.score for a in user_answers) * 100 / max(total, 1), 1)
            percents.append(percent)
            properties = {
                "session_uuid": session.session_uuid,
                "quiz_uuid": quiz.quiz_uuid,
                "quiz_title": quiz.title,
                "source_type": quiz.source_type,
                "score_percent": percent,
                "correct": sum(1 for a in user_answers if a.is_correct),
                "answered": len(user_answers),
                "total_questions": total,
            }
            await track(analytics_events.LIVE_QUIZ_COMPLETED, org_id=session.org_id, user_id=user_id, properties=properties)
            await record_audit_event(
                event_type=UserAuditEventType.LIVE_QUIZ_COMPLETED,
                user_id=user_id,
                org_id=session.org_id,
                target_uuid=quiz.quiz_uuid,
                metadata=properties,
            )
        correct = sum(1 for a in answers if a.is_correct)
        await track(
            analytics_events.LIVE_QUIZ_FINISHED,
            org_id=session.org_id,
            user_id=quiz.created_by_id or 0,
            properties={
                "session_uuid": session.session_uuid,
                "quiz_uuid": quiz.quiz_uuid,
                "source_type": quiz.source_type,
                "total_questions": total,
                "participants": len(by_user),
                "correct": correct,
                "incorrect": len(answers) - correct,
                "average_percent": round(sum(percents) / len(percents), 1) if percents else None,
            },
        )
    except Exception:
        logger.warning("Live quiz %s: analytics failed", quiz.quiz_uuid, exc_info=True)
