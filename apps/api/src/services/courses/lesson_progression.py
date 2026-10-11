"""Lesson-by-lesson progression.

The learning path is: finish a lesson, pass its quiz, move to the next lesson;
finish a chapter, do its assignment, move to the next chapter. Chapter and
assignment gating lives in :mod:`src.services.courses.progression`. This module
adds the lesson half and combines both into one verdict per lesson.

It shares that module's rule: a bug here must let people through, never trap
them. So a lesson is only locked by an earlier *published* lesson that holds a
*gradable* quiz the learner has not passed. Lessons without a quiz never block,
and the first lesson is always open.

A quiz lesson counts as passed when the learner has a completed TrailStep for
it. The only route that creates that step for a quiz lesson is the server-side
quiz submit, so a completed step is proof of a passing score.
"""

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.trail_steps import TrailStep
from src.services.courses.lesson_quiz import lesson_has_quiz
from src.services.courses.progression import (
    evaluate_course_progression,
    resolve_progression_policy,
)


@dataclass
class LessonGate:
    activity_id: int
    locked: bool = False
    # None | "quiz_incomplete" | "chapter_locked"
    reason: str | None = None
    message: str | None = None
    # Lessons whose quiz still needs passing, in course order.
    blocking: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "activity_id": self.activity_id,
            "locked": self.locked,
            "reason": self.reason,
            "message": self.message,
            "blocking": self.blocking,
        }


async def ordered_lessons(course_id: int, db_session: AsyncSession) -> list[tuple[Activity, int]]:
    """Published lessons as ``(activity, chapter_id)`` in the order learners see them.

    Chapters follow CourseChapter.order (unplaced chapters last, by id), lessons
    follow ChapterActivity.order. An activity placed twice keeps its first slot.
    """
    rows = (await db_session.execute(
        select(Activity, ChapterActivity.chapter_id, ChapterActivity.order, CourseChapter.order)
        .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)
        .join(Chapter, Chapter.id == ChapterActivity.chapter_id)
        .outerjoin(
            CourseChapter,
            (CourseChapter.chapter_id == Chapter.id)
            & (CourseChapter.course_id == course_id),
        )
        .where(Activity.course_id == course_id, Activity.published == True)  # noqa: E712
    )).all()

    def sort_key(row: Any) -> tuple:
        activity, chapter_id, lesson_order, chapter_order = row
        return (
            0 if chapter_order is not None else 1,
            chapter_order if chapter_order is not None else 0,
            chapter_id,
            lesson_order,
            activity.id,
        )

    out: list[tuple[Activity, int]] = []
    seen: set[int] = set()
    for activity, chapter_id, _, _ in sorted(rows, key=sort_key):
        if activity.id in seen:
            continue
        seen.add(activity.id)
        out.append((activity, chapter_id))
    return out


async def _completed_activity_ids(user_id: int, course_id: int, db_session: AsyncSession) -> set[int]:
    rows = (await db_session.execute(
        select(TrailStep.activity_id).where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course_id,
            TrailStep.complete == True,  # noqa: E712
        )
    )).all()
    return {r[0] for r in rows}


async def evaluate_lesson_gates(
    course_id: int,
    user_id: int | None,
    db_session: AsyncSession,
    policy: Any = None,
) -> dict[int, LessonGate]:
    """Lock state of every published lesson for one learner.

    ``policy`` is the raw ``course.progression_config``. With gating off or no
    learner, every lesson comes back unlocked so callers can use the result
    unconditionally.
    """
    lessons = await ordered_lessons(course_id, db_session)
    gates = {a.id: LessonGate(activity_id=a.id) for a, _ in lessons}
    resolved = resolve_progression_policy(policy)
    if not resolved.enabled or user_id is None or not lessons:
        return gates

    done = await _completed_activity_ids(user_id, course_id, db_session)
    chapter_gates = await evaluate_course_progression(
        course_id, user_id, db_session, policy=policy
    )

    # Learners who were already part-way through before quizzes were enforced
    # have completed later lessons without a recorded quiz pass. Progress they
    # have already made is honoured: a quiz only blocks while the learner has
    # not yet completed anything after it. New progress cannot slip past a quiz
    # this way, because completing a later lesson now requires the earlier ones.
    furthest_done = max(
        (i for i, (a, _) in enumerate(lessons) if a.id in done), default=-1
    )

    outstanding: list[dict] = []
    for index, (activity, chapter_id) in enumerate(lessons):
        gate = gates[activity.id]
        chapter_gate = chapter_gates.get(chapter_id)

        if outstanding:
            gate.blocking = list(outstanding)
            gate.reason = "quiz_incomplete"
            gate.message = "Pass the quiz in the previous lesson to open this one."
            gate.locked = not resolved.never_block
        elif chapter_gate is not None and chapter_gate.locked:
            gate.blocking = chapter_gate.blocking
            gate.reason = "chapter_locked"
            gate.message = chapter_gate.message
            gate.locked = True

        if index >= furthest_done and activity.id not in done and lesson_has_quiz(activity.content):
            outstanding.append({
                "activity_uuid": activity.activity_uuid,
                "name": activity.name,
                "chapter_id": chapter_id,
            })

    return gates


async def is_lesson_unlocked(
    course_id: int,
    activity_id: int,
    user_id: int | None,
    db_session: AsyncSession,
    policy: Any = None,
) -> bool:
    """Only an explicit lock blocks; anything unknown is open."""
    gate = (await evaluate_lesson_gates(course_id, user_id, db_session, policy)).get(activity_id)
    return gate is None or not gate.locked


async def can_bypass_progression(request: Any, user: Any, course: Any, db_session: AsyncSession) -> bool:
    """Authors and admins must be able to open every lesson to check their work.

    Anyone allowed to edit the course is exempt; the gate exists for learners.
    """
    from fastapi import HTTPException

    from src.security.rbac import AccessAction, check_resource_access

    try:
        await check_resource_access(
            request, db_session, user, course.course_uuid, AccessAction.UPDATE
        )
        return True
    except HTTPException:
        return False


async def is_quiz_required(
    activity: Activity, user_id: int | None, db_session: AsyncSession
) -> bool:
    """True when this learner still has to pass this lesson's quiz.

    The page uses it to say "pass the quiz" on the complete button instead of
    letting the learner click and be refused. It mirrors the server's own rule:
    a lesson with a gradable quiz can only be completed through the quiz submit.
    """
    if user_id is None or not lesson_has_quiz(activity.content):
        return False
    done = (await db_session.execute(
        select(TrailStep.id).where(
            TrailStep.activity_id == activity.id,
            TrailStep.user_id == user_id,
            TrailStep.complete == True,  # noqa: E712
        )
    )).first()
    return done is None
