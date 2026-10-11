"""Tests for lesson-by-lesson progression.

Same theme as chapter progression: only a published, gradable, unpassed quiz in
an earlier lesson may lock a later one. Everything else must stay open.
"""

import pytest

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.trail_steps import TrailStep
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.services.courses.lesson_progression import evaluate_lesson_gates

QUIZ = {
    "type": "doc",
    "content": [{
        "type": "blockQuiz",
        "attrs": {"quizId": "q", "questions": [{
            "question_id": "q1", "question": "?", "type": "multiple_choice",
            "answers": [
                {"answer_id": "a", "answer": "a", "correct": True},
                {"answer_id": "b", "answer": "b", "correct": False},
            ],
        }]},
    }],
}
PLAIN = {"type": "doc", "content": [{"type": "paragraph"}]}


class Course3:
    def __init__(self, db, org, course, user):
        self.db, self.org, self.course, self.user = db, org, course, user
        self.seq = 9000
        self.chapter = None
        self.order = 0

    async def chapter_(self, name="One"):
        self.chapter = Chapter(
            name=name, description="", org_id=self.org.id, course_id=self.course.id,
            chapter_uuid=f"chapter_l{name}", creation_date="x", update_date="x",
        )
        self.db.add(self.chapter)
        await self.db.commit()
        await self.db.refresh(self.chapter)
        return self.chapter

    async def lesson(self, content, published=True):
        self.seq += 1
        self.order += 1
        activity = Activity(
            id=self.seq, name=f"lesson{self.seq}", activity_uuid=f"activity_l{self.seq}",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            published=published, org_id=self.org.id, course_id=self.course.id,
            content=content, creation_date="x", update_date="x",
        )
        self.db.add(activity)
        self.db.add(ChapterActivity(
            activity_id=activity.id, course_id=self.course.id, chapter_id=self.chapter.id,
            org_id=self.org.id, order=self.order, creation_date="x", update_date="x",
        ))
        await self.db.commit()
        return activity

    async def complete(self, activity):
        trail = Trail(org_id=self.org.id, user_id=self.user.id, trail_uuid=f"trail_l{activity.id}",
                      creation_date="x", update_date="x")
        self.db.add(trail)
        await self.db.commit()
        await self.db.refresh(trail)
        run = TrailRun(trail_id=trail.id, course_id=self.course.id, org_id=self.org.id,
                       user_id=self.user.id, creation_date="x", update_date="x")
        self.db.add(run)
        await self.db.commit()
        await self.db.refresh(run)
        self.db.add(TrailStep(
            trailrun_id=run.id, trail_id=trail.id, activity_id=activity.id,
            course_id=self.course.id, org_id=self.org.id, user_id=self.user.id,
            complete=True, teacher_verified=False, grade="", creation_date="x", update_date="x",
        ))
        await self.db.commit()

    async def gates(self, policy=None):
        return await evaluate_lesson_gates(self.course.id, self.user.id, self.db, policy=policy)


@pytest.mark.asyncio
async def test_next_lesson_locked_until_quiz_passed(db, org, course, regular_user):
    h = Course3(db, org, course, regular_user)
    await h.chapter_()
    l1 = await h.lesson(QUIZ)
    l2 = await h.lesson(PLAIN)

    gates = await h.gates()
    assert gates[l1.id].locked is False
    assert gates[l2.id].locked is True
    assert gates[l2.id].reason == "quiz_incomplete"
    assert gates[l2.id].blocking[0]["activity_uuid"] == l1.activity_uuid

    await h.complete(l1)
    assert (await h.gates())[l2.id].locked is False


@pytest.mark.asyncio
async def test_lock_carries_forward_past_a_plain_lesson(db, org, course, regular_user):
    h = Course3(db, org, course, regular_user)
    await h.chapter_()
    await h.lesson(QUIZ)
    l2 = await h.lesson(PLAIN)
    l3 = await h.lesson(PLAIN)

    gates = await h.gates()
    assert gates[l2.id].locked and gates[l3.id].locked


@pytest.mark.asyncio
async def test_lessons_without_quiz_never_lock(db, org, course, regular_user):
    h = Course3(db, org, course, regular_user)
    await h.chapter_()
    await h.lesson(PLAIN)
    l2 = await h.lesson(PLAIN)
    assert (await h.gates())[l2.id].locked is False


@pytest.mark.asyncio
async def test_unpublished_quiz_lesson_does_not_lock(db, org, course, regular_user):
    h = Course3(db, org, course, regular_user)
    await h.chapter_()
    await h.lesson(QUIZ, published=False)
    l2 = await h.lesson(PLAIN)
    assert (await h.gates())[l2.id].locked is False


@pytest.mark.asyncio
async def test_opt_out_and_warn_only_policies_never_lock(db, org, course, regular_user):
    h = Course3(db, org, course, regular_user)
    await h.chapter_()
    await h.lesson(QUIZ)
    l2 = await h.lesson(PLAIN)
    assert (await h.gates({"enabled": False}))[l2.id].locked is False
    warn = (await h.gates({"enabled": True, "never_block": True}))[l2.id]
    assert warn.locked is False and warn.blocking


@pytest.mark.asyncio
async def test_existing_progress_past_a_quiz_is_honoured(db, org, course, regular_user):
    """A learner who already finished lesson 3 never took lesson 1's quiz.

    Quizzes used to be client-side only, so nothing was recorded. Locking that
    learner behind a quiz they have already moved past would trap them.
    """
    h = Course3(db, org, course, regular_user)
    await h.chapter_()
    await h.lesson(QUIZ)
    l2 = await h.lesson(PLAIN)
    l3 = await h.lesson(PLAIN)
    await h.complete(l3)

    gates = await h.gates()
    assert gates[l2.id].locked is False
    assert gates[l3.id].locked is False


@pytest.mark.asyncio
async def test_quiz_is_required_until_the_lesson_is_completed(db, org, course, regular_user):
    from src.services.courses.lesson_progression import is_quiz_required

    h = Course3(db, org, course, regular_user)
    await h.chapter_()
    quiz_lesson = await h.lesson(QUIZ)
    plain_lesson = await h.lesson(PLAIN)

    assert await is_quiz_required(quiz_lesson, regular_user.id, db) is True
    assert await is_quiz_required(plain_lesson, regular_user.id, db) is False
    assert await is_quiz_required(quiz_lesson, None, db) is False

    await h.complete(quiz_lesson)
    assert await is_quiz_required(quiz_lesson, regular_user.id, db) is False
