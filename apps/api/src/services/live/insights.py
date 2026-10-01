"""Live classroom analytics for course staff.

Postgres is the source of truth here (attendance ledger projection, messages,
polls, quizzes, recordings), so these reports work whether or not Tinybird is
configured; the Tinybird events emitted by ``reporting``/``quizzes`` feed the
org-wide dashboards alongside them.

The learner engagement view joins live data with the LMS records the rest of
ValidBridge already keeps, using the same definitions as the per-student audit
dossier:

* progress = completed ``TrailStep`` rows / activities in the course;
* assignment average = ``compute_assignment_grade`` percentage of GRADED
  submissions;
* quiz performance = graded assignment QUIZ tasks (task grade / task max);
* recent activity = the latest ``UserActivityDay`` in the org.
"""

from collections import defaultdict
from typing import Optional

from fastapi import Request
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.courses import Course
from src.db.live_sessions import (
    LiveCourseOverview,
    LiveLearnerEngagement,
    LiveMessageKind,
    LiveMyLessons,
    LiveMyRecording,
    LiveMySession,
    LiveParticipantRole,
    LiveParticipationCounts,
    LivePoll,
    LivePollReport,
    LivePollVote,
    LiveQuestionStatus,
    LiveQuiz,
    LiveQuizAnswer,
    LiveQuizReport,
    LiveRecording,
    LiveRecordingState,
    LiveSession,
    LiveSessionLearnerRow,
    LiveSessionMessage,
    LiveSessionParticipant,
    LiveSessionReport,
    LiveSessionStatus,
    LiveSessionSummaryRow,
    utcnow,
)
from src.db.trail_steps import TrailStep
from src.db.user_activity import UserActivityDay
from src.db.users import User
from src.services.live.attendance import as_utc
from src.services.live.recordings import recordings_for_sessions
from src.services.live.reporting import (
    STATUS_LATE,
    STATUS_LEFT_EARLY,
    STATUS_PARTIAL,
    classify,
    enrolled_user_ids,
)
from src.services.live.sessions import (
    _get_course,
    _require_staff,
    _require_user,
    get_session_by_uuid,
    to_read,
)

HELD_STATUSES = (
    LiveSessionStatus.LIVE,
    LiveSessionStatus.ENDED,
    LiveSessionStatus.PROCESSING,
    LiveSessionStatus.COMPLETED,
)
FINISHED_STATUSES = (LiveSessionStatus.ENDED, LiveSessionStatus.PROCESSING, LiveSessionStatus.COMPLETED)


def _pct(part: float, whole: float) -> Optional[float]:
    return round(part * 100.0 / whole, 1) if whole else None


def _mean(values: list[float]) -> Optional[float]:
    return round(sum(values) / len(values), 1) if values else None


def _name(user: User) -> str:
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username


async def _course_by_uuid(db: AsyncSession, course_uuid: str) -> Course:
    course = (await db.execute(select(Course).where(Course.course_uuid == course_uuid))).scalars().first()
    if course is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Course not found")
    return course


# ---------------------------------------------------------------------------
# Per-session building blocks (batched over many sessions)
# ---------------------------------------------------------------------------


async def _participation(db: AsyncSession, session_ids: list[int]) -> dict[tuple[int, int], LiveParticipationCounts]:
    """(session_id, user_id) → participation counts."""
    out: dict[tuple[int, int], LiveParticipationCounts] = defaultdict(LiveParticipationCounts)
    if not session_ids:
        return out

    for session_id, user_id, kind, count in (
        await db.execute(
            select(LiveSessionMessage.session_id, LiveSessionMessage.user_id, LiveSessionMessage.kind, func.count())
            .where(
                LiveSessionMessage.session_id.in_(session_ids),
                LiveSessionMessage.user_id.is_not(None),
                LiveSessionMessage.deleted_at.is_(None),  # moderated messages don't count
            )
            .group_by(LiveSessionMessage.session_id, LiveSessionMessage.user_id, LiveSessionMessage.kind)
        )
    ).all():
        counts = out[(session_id, user_id)]
        if kind == LiveMessageKind.CHAT:
            counts.messages += count
        else:
            counts.questions += count

    for session_id, user_id, count in (
        await db.execute(
            select(LivePoll.session_id, LivePollVote.user_id, func.count())
            .join(LivePoll, LivePoll.id == LivePollVote.poll_id)
            .where(LivePoll.session_id.in_(session_ids))
            .group_by(LivePoll.session_id, LivePollVote.user_id)
        )
    ).all():
        out[(session_id, user_id)].poll_votes += count

    for session_id, user_id, count in (
        await db.execute(
            select(LiveQuiz.session_id, LiveQuizAnswer.user_id, func.count())
            .join(LiveQuiz, LiveQuiz.id == LiveQuizAnswer.quiz_id)
            .where(LiveQuiz.session_id.in_(session_ids))
            .group_by(LiveQuiz.session_id, LiveQuizAnswer.user_id)
        )
    ).all():
        out[(session_id, user_id)].quiz_answers += count

    for session_id, user_id, hands in (
        await db.execute(
            select(LiveSessionParticipant.session_id, LiveSessionParticipant.user_id, LiveSessionParticipant.hand_raises)
            .where(LiveSessionParticipant.session_id.in_(session_ids), LiveSessionParticipant.hand_raises > 0)
        )
    ).all():
        out[(session_id, user_id)].hand_raises += hands
    return out


async def _quiz_scores(db: AsyncSession, session_ids: list[int]) -> dict[tuple[int, int], list[float]]:
    """(session_id, user_id) → one percent per live quiz taken in that session.

    Unanswered questions count as 0: a quiz score is out of every question.
    """
    out: dict[tuple[int, int], list[float]] = defaultdict(list)
    if not session_ids:
        return out
    quizzes = (await db.execute(select(LiveQuiz).where(LiveQuiz.session_id.in_(session_ids)))).scalars().all()
    by_quiz = {q.id: q for q in quizzes}
    if not by_quiz:
        return out
    sums: dict[tuple[int, int], float] = defaultdict(float)
    for quiz_id, user_id, score in (
        await db.execute(
            select(LiveQuizAnswer.quiz_id, LiveQuizAnswer.user_id, func.sum(LiveQuizAnswer.score))
            .where(LiveQuizAnswer.quiz_id.in_(list(by_quiz)))
            .group_by(LiveQuizAnswer.quiz_id, LiveQuizAnswer.user_id)
        )
    ).all():
        sums[(quiz_id, user_id)] = float(score or 0)
    for (quiz_id, user_id), total in sums.items():
        quiz = by_quiz[quiz_id]
        out[(quiz.session_id, user_id)].append(total * 100.0 / max(len(quiz.questions or []), 1))
    return out


async def _poll_reports(db: AsyncSession, session: LiveSession, attendees: int) -> list[LivePollReport]:
    polls = (
        await db.execute(select(LivePoll).where(LivePoll.session_id == session.id).order_by(LivePoll.created_at))
    ).scalars().all()
    if not polls:
        return []
    counts: dict[int, dict[int, int]] = defaultdict(dict)
    for poll_id, option, count in (
        await db.execute(
            select(LivePollVote.poll_id, LivePollVote.option_index, func.count())
            .where(LivePollVote.poll_id.in_([p.id for p in polls]))
            .group_by(LivePollVote.poll_id, LivePollVote.option_index)
        )
    ).all():
        counts[poll_id][option] = count
    reports = []
    for poll in polls:
        per_option = [counts[poll.id].get(i, 0) for i in range(len(poll.options or []))]
        total = sum(per_option)
        reports.append(
            LivePollReport(
                poll_uuid=poll.poll_uuid,
                question=poll.question,
                options=list(poll.options or []),
                counts=per_option,
                total_votes=total,
                response_rate=_pct(total, attendees),
                status=poll.status,
            )
        )
    return reports


async def _quiz_reports(db: AsyncSession, session: LiveSession) -> list[LiveQuizReport]:
    quizzes = (
        await db.execute(select(LiveQuiz).where(LiveQuiz.session_id == session.id).order_by(LiveQuiz.created_at))
    ).scalars().all()
    reports = []
    for quiz in quizzes:
        answers = (await db.execute(select(LiveQuizAnswer).where(LiveQuizAnswer.quiz_id == quiz.id))).scalars().all()
        by_user: dict[int, float] = defaultdict(float)
        for a in answers:
            by_user[a.user_id] += a.score
        total_questions = max(len(quiz.questions or []), 1)
        correct = sum(1 for a in answers if a.is_correct)
        reports.append(
            LiveQuizReport(
                quiz_uuid=quiz.quiz_uuid,
                title=quiz.title,
                question_count=len(quiz.questions or []),
                participants=len(by_user),
                correct=correct,
                incorrect=len(answers) - correct,
                average_percent=_mean([s * 100.0 / total_questions for s in by_user.values()]),
                status=quiz.status,
            )
        )
    return reports


def _duration(session: LiveSession) -> Optional[int]:
    start, end = as_utc(session.started_at), as_utc(session.ended_at)
    if start is None:
        return None
    return max(0, int(((end or utcnow()) - start).total_seconds()))


# ---------------------------------------------------------------------------
# Session report
# ---------------------------------------------------------------------------


async def session_report(request: Request, db: AsyncSession, user, session_uuid: str) -> LiveSessionReport:
    user = _require_user(user)
    session = await get_session_by_uuid(db, session_uuid)
    course = await _get_course(db, session.course_id)
    await _require_staff(request, db, user, course)
    now = utcnow()

    rows = (
        await db.execute(
            select(LiveSessionParticipant, User)
            .join(User, User.id == LiveSessionParticipant.user_id)
            .where(
                LiveSessionParticipant.session_id == session.id,
                LiveSessionParticipant.role == LiveParticipantRole.LEARNER,
                LiveSessionParticipant.connection_count > 0,
            )
        )
    ).all()
    participation = await _participation(db, [session.id])
    quiz_scores = await _quiz_scores(db, [session.id])
    enrolled = await enrolled_user_ids(db, session.course_id)

    learners: list[LiveSessionLearnerRow] = []
    totals = LiveParticipationCounts()
    percents, durations = [], []
    late = early = partial = participating = 0
    for participant, member in rows:
        figures = classify(participant, session, now)
        counts = participation.get((session.id, member.id)) or LiveParticipationCounts()
        for field in ("messages", "questions", "poll_votes", "quiz_answers", "hand_raises"):
            setattr(totals, field, getattr(totals, field) + getattr(counts, field))
        if counts.total:
            participating += 1
        if figures.attendance_percent is not None:
            percents.append(figures.attendance_percent)
        durations.append(figures.duration_seconds)
        late += figures.status == STATUS_LATE
        early += figures.status == STATUS_LEFT_EARLY
        partial += figures.status == STATUS_PARTIAL
        learners.append(
            LiveSessionLearnerRow(
                user_id=member.id,
                user_uuid=member.user_uuid,
                name=_name(member),
                attendance_status=figures.status,
                attendance_percent=figures.attendance_percent,
                duration_seconds=figures.duration_seconds,
                late_by_seconds=figures.late_by_seconds,
                left_early_by_seconds=figures.left_early_by_seconds,
                participation=counts,
                quiz_percent=_mean(quiz_scores.get((session.id, member.id), [])),
            )
        )
    learners.sort(key=lambda r: r.name.lower())

    questions_answered = (
        await db.execute(
            select(func.count()).where(
                LiveSessionMessage.session_id == session.id,
                LiveSessionMessage.kind == LiveMessageKind.QUESTION,
                LiveSessionMessage.status == LiveQuestionStatus.ANSWERED.value,
                LiveSessionMessage.deleted_at.is_(None),
            )
        )
    ).scalar_one()
    attendees = len(learners)
    attended_ids = {r.user_id for r in learners}
    return LiveSessionReport(
        session=to_read(session),
        enrolled=len(enrolled),
        attendees=attendees,
        attendance_rate=_pct(attendees, len(enrolled)),
        average_attendance_percent=_mean(percents),
        average_duration_seconds=int(sum(durations) / len(durations)) if durations else None,
        late_arrivals=late,
        early_departures=early,
        partial=partial,
        absent=len([uid for uid in enrolled if uid not in attended_ids]) if session.started_at else 0,
        participating_learners=participating,
        participation_rate=_pct(participating, attendees),
        participation=totals,
        questions_answered=questions_answered,
        polls=await _poll_reports(db, session, attendees),
        quizzes=await _quiz_reports(db, session),
        completed=session.status in FINISHED_STATUSES,
        duration_seconds=_duration(session),
        recordings=await recordings_for_sessions(db, [session], staff=True),
        learners=learners,
    )


# ---------------------------------------------------------------------------
# Course overview
# ---------------------------------------------------------------------------


async def course_overview(request: Request, db: AsyncSession, user, course_uuid: str) -> LiveCourseOverview:
    user = _require_user(user)
    course = await _course_by_uuid(db, course_uuid)
    await _require_staff(request, db, user, course)
    now = utcnow()

    sessions = (
        await db.execute(
            select(LiveSession).where(LiveSession.course_id == course.id).order_by(LiveSession.scheduled_at.desc())
        )
    ).scalars().all()
    enrolled = len(await enrolled_user_ids(db, course.id))
    ids = [s.id for s in sessions]

    learners_by_session: dict[int, list[LiveSessionParticipant]] = defaultdict(list)
    if ids:
        for participant in (
            await db.execute(
                select(LiveSessionParticipant).where(
                    LiveSessionParticipant.session_id.in_(ids),
                    LiveSessionParticipant.role == LiveParticipantRole.LEARNER,
                    LiveSessionParticipant.connection_count > 0,
                )
            )
        ).scalars().all():
            learners_by_session[participant.session_id].append(participant)

    questions_by_session: dict[int, int] = {}
    poll_votes = 0
    recordings_ready = 0
    if ids:
        questions_by_session = dict(
            (
                await db.execute(
                    select(LiveSessionMessage.session_id, func.count())
                    .where(
                        LiveSessionMessage.session_id.in_(ids),
                        LiveSessionMessage.kind == LiveMessageKind.QUESTION,
                        LiveSessionMessage.deleted_at.is_(None),
                    )
                    .group_by(LiveSessionMessage.session_id)
                )
            ).all()
        )
        poll_votes = (
            await db.execute(
                select(func.count()).select_from(LivePollVote).join(LivePoll, LivePoll.id == LivePollVote.poll_id)
                .where(LivePoll.session_id.in_(ids))
            )
        ).scalar_one()
        recordings_ready = (
            await db.execute(
                select(func.count()).where(
                    LiveRecording.session_id.in_(ids), LiveRecording.status == LiveRecordingState.READY
                )
            )
        ).scalar_one()
    quiz_scores = await _quiz_scores(db, ids)
    quiz_by_session: dict[int, list[float]] = defaultdict(list)
    for (session_id, _), scores in quiz_scores.items():
        quiz_by_session[session_id].extend(scores)

    rows, rates, percents, durations = [], [], [], []
    late = early = 0
    for session in sessions:
        learners = learners_by_session.get(session.id, [])
        figures = [classify(p, session, now) for p in learners]
        session_percents = [f.attendance_percent for f in figures if f.attendance_percent is not None]
        held = session.status in HELD_STATUSES
        rate = _pct(len(learners), enrolled) if held else None
        if held:
            if rate is not None:
                rates.append(rate)
            if session_percents:
                percents.append(_mean(session_percents))
            durations.extend(f.duration_seconds for f in figures)
            late += sum(1 for f in figures if f.status == STATUS_LATE)
            early += sum(1 for f in figures if f.status == STATUS_LEFT_EARLY)
        rows.append(
            LiveSessionSummaryRow(
                session_uuid=session.session_uuid,
                title=session.title,
                status=session.status,
                scheduled_at=as_utc(session.scheduled_at),
                started_at=as_utc(session.started_at),
                duration_seconds=_duration(session),
                attendees=len(learners),
                attendance_rate=rate,
                average_attendance_percent=_mean(session_percents),
                questions=questions_by_session.get(session.id, 0),
                quiz_average_percent=_mean(quiz_by_session.get(session.id, [])),
                recording_status=session.recording_status,
            )
        )

    all_quiz = [score for scores in quiz_by_session.values() for score in scores]
    return LiveCourseOverview(
        enrolled=enrolled,
        sessions_held=sum(1 for s in sessions if s.status in HELD_STATUSES),
        sessions_upcoming=sum(
            1 for s in sessions if s.status in (LiveSessionStatus.SCHEDULED, LiveSessionStatus.READY)
        ),
        average_attendance_rate=_mean(rates),
        average_attendance_percent=_mean([p for p in percents if p is not None]),
        average_duration_seconds=int(sum(durations) / len(durations)) if durations else None,
        late_arrivals=late,
        early_departures=early,
        total_questions=sum(questions_by_session.values()),
        total_poll_votes=poll_votes,
        live_quiz_average_percent=_mean(all_quiz),
        recordings_ready=recordings_ready,
        sessions=rows,
    )


# ---------------------------------------------------------------------------
# Learner engagement: LMS + live
# ---------------------------------------------------------------------------


async def learner_engagement(request: Request, db: AsyncSession, user, course_uuid: str) -> list[LiveLearnerEngagement]:
    from src.services.courses.activities.assignments import compute_assignment_grade

    user = _require_user(user)
    course = await _course_by_uuid(db, course_uuid)
    await _require_staff(request, db, user, course)
    now = utcnow()

    learner_ids = await enrolled_user_ids(db, course.id)
    if not learner_ids:
        return []
    members = {
        u.id: u for u in (await db.execute(select(User).where(User.id.in_(learner_ids)))).scalars().all()
    }

    # -- LMS: course progress (same definition as the audit dossier) --
    activities_total = (
        await db.execute(select(func.count(Activity.id)).where(Activity.course_id == course.id))
    ).scalar_one()
    completed = dict(
        (
            await db.execute(
                select(TrailStep.user_id, func.count(TrailStep.id))
                .where(TrailStep.course_id == course.id, TrailStep.user_id.in_(learner_ids), TrailStep.complete == True)  # noqa: E712
                .group_by(TrailStep.user_id)
            )
        ).all()
    )

    # -- LMS: assignments (percent via the canonical grade formatter) --
    assignments = (await db.execute(select(Assignment).where(Assignment.course_id == course.id))).scalars().all()
    assignment_by_id = {a.id: a for a in assignments}
    max_by_assignment: dict[int, int] = defaultdict(int)
    if assignments:
        for assignment_id, max_value in (
            await db.execute(
                select(AssignmentTask.assignment_id, AssignmentTask.max_grade_value).where(
                    AssignmentTask.assignment_id.in_(list(assignment_by_id))
                )
            )
        ).all():
            max_by_assignment[assignment_id] += int(max_value or 0)
    submitted: dict[int, int] = defaultdict(int)
    assignment_percents: dict[int, list[float]] = defaultdict(list)
    graded_pairs: set[tuple[int, int]] = set()
    if assignments:
        for sub in (
            await db.execute(
                select(AssignmentUserSubmission).where(
                    AssignmentUserSubmission.assignment_id.in_(list(assignment_by_id)),
                    AssignmentUserSubmission.user_id.in_(learner_ids),
                )
            )
        ).scalars().all():
            if sub.submission_status in (
                AssignmentUserSubmissionStatus.SUBMITTED,
                AssignmentUserSubmissionStatus.GRADED,
                AssignmentUserSubmissionStatus.LATE,
            ):
                submitted[sub.user_id] += 1
            if sub.submission_status == AssignmentUserSubmissionStatus.GRADED:
                graded_pairs.add((sub.assignment_id, sub.user_id))
                max_grade = max_by_assignment.get(sub.assignment_id, 0)
                if max_grade:
                    assignment = assignment_by_id[sub.assignment_id]
                    computed = compute_assignment_grade(
                        sub.grade or 0, max_grade, assignment.grading_type, sub.overall_feedback,
                        assignment.pass_threshold_percentage,
                    )
                    if computed.get("percentage") is not None:
                        assignment_percents[sub.user_id].append(float(computed["percentage"]))

    # -- LMS: quiz performance (graded assignment QUIZ tasks) --
    quiz_percents: dict[int, list[float]] = defaultdict(list)
    if assignments:
        for user_id, assignment_id, grade, max_value in (
            await db.execute(
                select(
                    AssignmentTaskSubmission.user_id,
                    AssignmentTask.assignment_id,
                    AssignmentTaskSubmission.grade,
                    AssignmentTask.max_grade_value,
                )
                .join(AssignmentTask, AssignmentTask.id == AssignmentTaskSubmission.assignment_task_id)
                .where(
                    AssignmentTaskSubmission.course_id == course.id,
                    AssignmentTaskSubmission.user_id.in_(learner_ids),
                    AssignmentTask.assignment_type == AssignmentTaskTypeEnum.QUIZ,
                )
            )
        ).all():
            if (assignment_id, user_id) in graded_pairs and max_value:
                quiz_percents[user_id].append(float(grade or 0) * 100.0 / float(max_value))

    # -- Recent activity --
    last_active = dict(
        (
            await db.execute(
                select(UserActivityDay.user_id, func.max(UserActivityDay.activity_date))
                .where(UserActivityDay.org_id == course.org_id, UserActivityDay.user_id.in_(learner_ids))
                .group_by(UserActivityDay.user_id)
            )
        ).all()
    )

    # -- Live classroom --
    sessions = (
        await db.execute(
            select(LiveSession).where(LiveSession.course_id == course.id, LiveSession.status.in_(list(HELD_STATUSES)))
        )
    ).scalars().all()
    by_session = {s.id: s for s in sessions}
    held = len(sessions)
    live_attended: dict[int, int] = defaultdict(int)
    live_percents: dict[int, list[float]] = defaultdict(list)
    if sessions:
        for participant in (
            await db.execute(
                select(LiveSessionParticipant).where(
                    LiveSessionParticipant.session_id.in_(list(by_session)),
                    LiveSessionParticipant.user_id.in_(learner_ids),
                    LiveSessionParticipant.connection_count > 0,
                )
            )
        ).scalars().all():
            live_attended[participant.user_id] += 1
            figures = classify(participant, by_session[participant.session_id], now)
            if figures.attendance_percent is not None:
                live_percents[participant.user_id].append(figures.attendance_percent)
    participation = await _participation(db, list(by_session))
    live_participation: dict[int, int] = defaultdict(int)
    for (_, user_id), counts in participation.items():
        live_participation[user_id] += counts.total
    live_quiz: dict[int, list[float]] = defaultdict(list)
    for (_, user_id), scores in (await _quiz_scores(db, list(by_session))).items():
        live_quiz[user_id].extend(scores)

    rows = []
    for user_id in learner_ids:
        member = members.get(user_id)
        if member is None:
            continue
        done = int(completed.get(user_id, 0))
        last = last_active.get(user_id)
        rows.append(
            LiveLearnerEngagement(
                user_id=user_id,
                user_uuid=member.user_uuid,
                name=_name(member),
                username=member.username,
                progress_percent=round(done * 100.0 / activities_total, 1) if activities_total else 0.0,
                activities_completed=done,
                activities_total=activities_total,
                assignments_submitted=submitted.get(user_id, 0),
                assignments_total=len(assignments),
                assignment_average_percent=_mean(assignment_percents.get(user_id, [])),
                quiz_average_percent=_mean(quiz_percents.get(user_id, [])),
                live_quiz_average_percent=_mean(live_quiz.get(user_id, [])),
                live_sessions_attended=live_attended.get(user_id, 0),
                live_sessions_held=held,
                live_attendance_rate=_pct(live_attended.get(user_id, 0), held),
                live_average_attendance_percent=_mean(live_percents.get(user_id, [])),
                live_participation=live_participation.get(user_id, 0),
                last_active_on=last.isoformat() if last else None,
            )
        )
    rows.sort(key=lambda r: r.name.lower())
    return rows


async def learner_live_history(db: AsyncSession, user_id: int, org_id: int) -> dict:
    """One learner's live classroom record across the org — for the audit dossier."""
    now = utcnow()
    rows = (
        await db.execute(
            select(LiveSessionParticipant, LiveSession, Course)
            .join(LiveSession, LiveSession.id == LiveSessionParticipant.session_id)
            .join(Course, Course.id == LiveSession.course_id)
            .where(
                LiveSessionParticipant.user_id == user_id,
                LiveSession.org_id == org_id,
                LiveSessionParticipant.connection_count > 0,
            )
            .order_by(LiveSession.scheduled_at.desc())
        )
    ).all()
    session_ids = [s.id for _, s, _ in rows]
    participation = await _participation(db, session_ids)
    quiz_scores = await _quiz_scores(db, session_ids)

    sessions = []
    percents: list[float] = []
    for participant, session, course in rows:
        figures = classify(participant, session, now)
        if figures.attendance_percent is not None:
            percents.append(figures.attendance_percent)
        counts = participation.get((session.id, user_id)) or LiveParticipationCounts()
        sessions.append(
            {
                "session_uuid": session.session_uuid,
                "title": session.title,
                "course_uuid": course.course_uuid,
                "course_name": course.name,
                "started_at": as_utc(session.started_at).isoformat() if session.started_at else None,
                "attendance_status": figures.status,
                "attendance_percent": figures.attendance_percent,
                "duration_seconds": figures.duration_seconds,
                "late_by_seconds": figures.late_by_seconds,
                "left_early_by_seconds": figures.left_early_by_seconds,
                "participation": counts.model_dump(),
                "quiz_percent": _mean(quiz_scores.get((session.id, user_id), [])),
            }
        )
    all_quiz = [s for (sid, uid), scores in quiz_scores.items() if uid == user_id for s in scores]
    return {
        "sessions": sessions,
        "summary": {
            "sessions_attended": len(sessions),
            "average_attendance_percent": _mean(percents),
            "live_quiz_average_percent": _mean(all_quiz),
            "participation": sum(
                (participation.get((sid, user_id)) or LiveParticipationCounts()).total for sid in session_ids
            ),
        },
    }


async def my_live_lessons(db: AsyncSession, user, org_id: Optional[int]) -> LiveMyLessons:
    """Upcoming/live lessons and ready recordings for the courses this user is
    enrolled in or teaches. Joining still goes through the full access check;
    this only lists what they can expect."""
    from datetime import timedelta

    from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipStatusEnum
    from src.db.trail_runs import TrailRun

    user = _require_user(user)
    enrolled = set(
        (await db.execute(select(TrailRun.course_id).where(TrailRun.user_id == user.id))).scalars().all()
    )
    authored_uuids = (
        await db.execute(
            select(ResourceAuthor.resource_uuid).where(
                ResourceAuthor.user_id == user.id,
                ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
                ResourceAuthor.resource_uuid.like("course_%"),
            )
        )
    ).scalars().all()
    taught = set()
    if authored_uuids:
        taught = set(
            (await db.execute(select(Course.id).where(Course.course_uuid.in_(authored_uuids)))).scalars().all()
        )
    course_ids = enrolled | taught
    if not course_ids:
        return LiveMyLessons()

    course_filter = [Course.id.in_(list(course_ids))]
    if org_id is not None:
        course_filter.append(Course.org_id == org_id)
    courses = {c.id: c for c in (await db.execute(select(Course).where(*course_filter))).scalars().all()}
    if not courses:
        return LiveMyLessons()

    # A scheduled lesson nobody started for 12h is stale; don't advertise it.
    stale_before = utcnow() - timedelta(hours=12)
    rows = (
        await db.execute(
            select(LiveSession)
            .where(
                LiveSession.course_id.in_(list(courses)),
                LiveSession.status.in_([LiveSessionStatus.SCHEDULED, LiveSessionStatus.READY, LiveSessionStatus.LIVE]),
            )
            .order_by(LiveSession.scheduled_at)
        )
    ).scalars().all()
    sessions = []
    for s in rows:
        if s.status == LiveSessionStatus.SCHEDULED and as_utc(s.scheduled_at) < stale_before:
            continue
        course = courses[s.course_id]
        sessions.append(
            LiveMySession(
                session_uuid=s.session_uuid,
                title=s.title,
                status=s.status,
                scheduled_at=as_utc(s.scheduled_at),
                started_at=as_utc(s.started_at),
                course_uuid=course.course_uuid,
                course_name=course.name,
                course_thumbnail=course.thumbnail_image or None,
                is_staff=s.course_id in taught,
            )
        )
    sessions.sort(key=lambda s: (s.status != LiveSessionStatus.LIVE, s.scheduled_at))

    recs = (
        await db.execute(
            select(LiveRecording, LiveSession, Activity)
            .join(LiveSession, LiveSession.id == LiveRecording.session_id)
            .join(Activity, Activity.id == LiveRecording.activity_id)
            .where(
                LiveSession.course_id.in_(list(courses)),
                LiveRecording.status == LiveRecordingState.READY,
                Activity.published == True,  # noqa: E712
            )
            .order_by(LiveRecording.ready_at.desc())
            .limit(12)
        )
    ).all()
    recordings = [
        LiveMyRecording(
            recording_uuid=r.recording_uuid,
            session_title=s.title,
            course_uuid=courses[s.course_id].course_uuid,
            course_name=courses[s.course_id].name,
            activity_uuid=a.activity_uuid,
            ready_at=as_utc(r.ready_at),
            duration_seconds=r.duration_seconds,
        )
        for r, s, a in recs
    ]
    return LiveMyLessons(sessions=sessions[:20], recordings=recordings)
