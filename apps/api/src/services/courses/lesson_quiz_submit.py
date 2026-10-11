"""Submit a lesson's quiz: judge it on the server, complete the lesson on a pass."""

from fastapi import HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.users import AnonymousUser, PublicUser
from src.security.rbac import AccessAction, check_resource_access
from src.services.courses.lesson_quiz import (
    check_quiz_question,
    lesson_has_quiz,
    score_lesson_quiz,
)
from src.services.trail.trail import add_activity_to_trail


async def submit_lesson_quiz(
    request: Request,
    activity_uuid: str,
    answers: list,
    user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> dict:
    """Score ``answers`` against the stored quiz; mark the lesson complete on a pass.

    The verdict never includes which answers were right, so a learner cannot
    read the key off a failed attempt. Retries are unlimited.
    """
    if isinstance(user, AnonymousUser):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to submit the quiz")

    activity = (await db_session.execute(
        select(Activity).where(Activity.activity_uuid == activity_uuid)
    )).scalars().first()
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    course = (await db_session.execute(
        select(Course).where(Course.id == activity.course_id)
    )).scalars().first()
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")

    await check_resource_access(
        request, db_session, user, course.course_uuid, AccessAction.READ
    )

    if not lesson_has_quiz(activity.content):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This lesson has no quiz")

    result = score_lesson_quiz(activity.content, answers)
    if result.passed:
        # Locked-lesson and ordering checks run inside, so a learner cannot pass
        # a quiz on a lesson they have not been allowed to reach.
        await add_activity_to_trail(
            request, user, activity_uuid, db_session, quiz_verified=True
        )

    return {
        "passed": result.passed,
        "correct": result.correct,
        "total": result.gradable,
        "results": result.results,
    }


async def check_lesson_quiz_question(
    request: Request,
    activity_uuid: str,
    question_id: str,
    answer_ids: list,
    user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> dict:
    """Instant feedback for one question. Does not complete the lesson.

    Completion still goes through :func:`submit_lesson_quiz`, which re-judges
    every answer, so this endpoint cannot be used to skip the quiz.
    """
    if isinstance(user, AnonymousUser):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to take the quiz")

    activity = (await db_session.execute(
        select(Activity).where(Activity.activity_uuid == activity_uuid)
    )).scalars().first()
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    course = (await db_session.execute(
        select(Course).where(Course.id == activity.course_id)
    )).scalars().first()
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")

    await check_resource_access(
        request, db_session, user, course.course_uuid, AccessAction.READ
    )

    verdict = check_quiz_question(activity.content, question_id, answer_ids)
    if verdict is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    return verdict
