"""Tests for sequential chapter progression.

The theme throughout is fail-open. Progression gating can only hurt someone by
locking them out, so every ambiguous authoring state must resolve to "open" and
there has to be a test proving it. If these tests ever need loosening, the gate
is one authoring mistake away from trapping a real learner.
"""

import pytest

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.assignments import (
    AssessmentKindEnum,
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.services.courses.progression import (
    evaluate_course_progression,
    is_chapter_unlocked,
    resolve_progression_policy,
)

ON = {"enabled": True}
ON_PASS = {"enabled": True, "require_pass": True}
ON_WARN = {"enabled": True, "never_block": True}

# Sentinel: lets a test ask for the anonymous case explicitly.
_OMITTED = object()


class TestPolicyResolution:
    """Malformed config must disable gating, never half-enable it."""

    def test_missing_config_is_off(self):
        assert resolve_progression_policy(None).enabled is False

    def test_non_dict_is_off(self):
        assert resolve_progression_policy("nonsense").enabled is False
        assert resolve_progression_policy([1, 2]).enabled is False

    def test_non_bool_enabled_is_off(self):
        # A stringly-typed "true" is not consent to gate a course.
        assert resolve_progression_policy({"enabled": "true"}).enabled is False

    def test_enabled_defaults_to_submitted(self):
        p = resolve_progression_policy(ON)
        assert p.enabled is True
        assert p.require_pass is False
        assert p.never_block is False

    def test_explicit_off(self):
        assert resolve_progression_policy({"enabled": False}).enabled is False


class ProgressionHarness:
    """Builds a course of N chapters with chosen assessments."""

    def __init__(self, db, org, course, user):
        self.db = db
        self.org = org
        self.course = course
        self.user = user
        self.chapters: list[Chapter] = []
        self._activity_seq = 7000

    async def add_chapter(self, name: str) -> Chapter:
        chapter = Chapter(
            name=name,
            description="",
            org_id=self.org.id,
            course_id=self.course.id,
            chapter_uuid=f"chapter_{name.lower()}",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        self.db.add(chapter)
        await self.db.commit()
        await self.db.refresh(chapter)
        self.chapters.append(chapter)
        return chapter

    async def add_assessment(
        self,
        chapter: Chapter,
        *,
        kind=AssessmentKindEnum.ASSIGNMENT,
        published: bool = True,
        placed: bool = True,
        max_grade: int = 100,
        grade: int | None = None,
        status=AssignmentUserSubmissionStatus.GRADED,
        pass_threshold: float = 50,
        ungraded: bool = False,
    ) -> Assignment | None:
        """Add a placed assessment, optionally with a graded submission."""
        self._activity_seq += 1
        activity = Activity(
            id=self._activity_seq,
            name=f"act{self._activity_seq}",
            activity_uuid=f"activity_p{self._activity_seq}",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            published=published,
            org_id=self.org.id,
            course_id=self.course.id,
            content={},
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        self.db.add(activity)
        if placed:
            self.db.add(ChapterActivity(
                activity_id=activity.id,
                course_id=self.course.id,
                chapter_id=chapter.id,
                org_id=self.org.id,
                order=1,
                creation_date="2024-01-01",
                update_date="2024-01-01",
            ))
        await self.db.commit()

        assignment = Assignment(
            title=f"assessment on {chapter.name}",
            description="",
            assignment_uuid=f"assignment_p{self._activity_seq}",
            assessment_kind=kind,
            grading_type=GradingTypeEnum.PERCENTAGE,
            pass_threshold_percentage=pass_threshold,
            ungraded=ungraded,
            published=published,
            org_id=self.org.id,
            course_id=self.course.id,
            chapter_id=chapter.id,
            activity_id=activity.id,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        self.db.add(assignment)
        await self.db.commit()
        await self.db.refresh(assignment)

        if max_grade > 0:
            self.db.add(AssignmentTask(
                title="t",
                description="",
                hint="",
                assignment_task_uuid=f"assignmenttask_p{self._activity_seq}",
                assignment_id=assignment.id,
                assignment_type=AssignmentTaskTypeEnum.QUIZ,
                max_grade_value=max_grade,
                org_id=self.org.id,
                course_id=self.course.id,
                chapter_id=chapter.id,
                activity_id=activity.id,
                creation_date="2024-01-01",
                update_date="2024-01-01",
            ))
        if grade is not None:
            self.db.add(AssignmentUserSubmission(
                assignmentusersubmission_uuid=f"aus_p{self._activity_seq}",
                assignment_id=assignment.id,
                user_id=self.user.id,
                grade=grade,
                submission_status=status,
                creation_date="2024-01-01",
                update_date="2024-01-01",
            ))
        await self.db.commit()
        return assignment

    async def gates(self, policy, user_id=_OMITTED):
        return await evaluate_course_progression(
            self.course.id,
            self.user.id if user_id is _OMITTED else user_id,
            self.db,
            policy=policy,
        )


class TestFailsOpen:
    """The states that must never lock a learner."""

    @pytest.mark.asyncio
    async def test_policy_off_locks_nothing(self, db, org, course, regular_user):
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, grade=None)

        gates = await h.gates(None)
        assert gates[c2.id].locked is False
        assert gates[c2.id].blocking == []

    @pytest.mark.asyncio
    async def test_chapter_with_no_assessments_does_not_lock_the_next(
        self, db, org, course, regular_user
    ):
        """The instructor simply did not put an assessment in chapter one."""
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        c3 = await h.add_chapter("Three")

        gates = await h.gates(ON)
        assert gates[c1.id].locked is False
        assert gates[c2.id].locked is False
        assert gates[c3.id].locked is False

    @pytest.mark.asyncio
    async def test_unplaced_assignment_does_not_lock(
        self, db, org, course, regular_user
    ):
        """Authoring mistake: an assessment exists but was never placed.

        This is the exact scenario the instructor warned about. The learner
        cannot see or submit it, so it must not gate them.
        """
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, placed=False, grade=None)

        gates = await h.gates(ON)
        assert gates[c2.id].locked is False

    @pytest.mark.asyncio
    async def test_draft_assessment_does_not_lock(
        self, db, org, course, regular_user
    ):
        """A draft assessment is invisible to learners, so it cannot gate them."""
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, published=False, grade=None)

        gates = await h.gates(ON)
        assert gates[c2.id].locked is False

    @pytest.mark.asyncio
    async def test_zero_point_assessment_does_not_lock(
        self, db, org, course, regular_user
    ):
        """No gradable tasks means nothing to submit or pass."""
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, max_grade=0, grade=None)

        gates = await h.gates(ON)
        assert gates[c2.id].locked is False

    @pytest.mark.asyncio
    async def test_anonymous_user_is_never_locked(
        self, db, org, course, regular_user
    ):
        """No user id means no progression to evaluate."""
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        await h.add_chapter("Two")
        await h.add_assessment(c1, grade=None)

        gates = await h.gates(ON, user_id=None)
        assert all(g.locked is False for g in gates.values())

    @pytest.mark.asyncio
    async def test_first_chapter_is_always_open(
        self, db, org, course, regular_user
    ):
        """Gating chapter one would leave a learner with no way in."""
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        await h.add_assessment(c1, grade=None)

        gates = await h.gates(ON_PASS)
        assert gates[c1.id].locked is False


class TestSequentialGating:
    """The feature actually working, once an author configures it."""

    @pytest.mark.asyncio
    async def test_unsubmitted_assessment_locks_the_next_chapter(
        self, db, org, course, regular_user
    ):
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, grade=None)

        gates = await h.gates(ON)
        assert gates[c2.id].locked is True
        assert gates[c2.id].reason == "prerequisite_incomplete"
        assert len(gates[c2.id].blocking) == 1
        assert gates[c1.id].locked is False

    @pytest.mark.asyncio
    async def test_submitted_unlocks_when_submission_is_enough(
        self, db, org, course, regular_user
    ):
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        # FAILED grade, but hand-in alone satisfies SUBMITTED.
        await h.add_assessment(c1, grade=10, pass_threshold=50)

        gates = await h.gates(ON)
        assert gates[c2.id].locked is False

    @pytest.mark.asyncio
    async def test_failed_assessment_locks_when_pass_is_required(
        self, db, org, course, regular_user
    ):
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, grade=10, pass_threshold=50)

        gates = await h.gates(ON_PASS)
        assert gates[c2.id].locked is True
        assert gates[c2.id].reason == "prerequisite_failed"
        assert gates[c2.id].blocking[0]["state"] == "failed"

    @pytest.mark.asyncio
    async def test_passed_assessment_unlocks_under_pass_requirement(
        self, db, org, course, regular_user
    ):
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, grade=90, pass_threshold=50)

        gates = await h.gates(ON_PASS)
        assert gates[c2.id].locked is False

    @pytest.mark.asyncio
    async def test_submitted_but_ungraded_blocks_only_under_pass(
        self, db, org, course, regular_user
    ):
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(
            c1, grade=95, status=AssignmentUserSubmissionStatus.SUBMITTED
        )

        assert (await h.gates(ON))[c2.id].locked is False
        assert (await h.gates(ON_PASS))[c2.id].locked is True

    @pytest.mark.asyncio
    async def test_all_three_kinds_gate_together(
        self, db, org, course, regular_user
    ):
        """Assignment, CAT and exam all hold the next chapter."""
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, kind=AssessmentKindEnum.ASSIGNMENT, grade=None)
        await h.add_assessment(c1, kind=AssessmentKindEnum.CAT, grade=90)
        await h.add_assessment(c1, kind=AssessmentKindEnum.EXAM, grade=None)

        gates = await h.gates(ON)
        assert gates[c2.id].locked is True
        # Only the two unfinished ones are listed as blocking.
        assert len(gates[c2.id].blocking) == 2

    @pytest.mark.asyncio
    async def test_never_block_reports_without_locking(
        self, db, org, course, regular_user
    ):
        """The instructor's escape hatch: warn, but never withhold."""
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, grade=None)

        gates = await h.gates(ON_WARN)
        assert gates[c2.id].locked is False
        # Still surfaces what is outstanding so the UI can nudge.
        assert gates[c2.id].reason == "prerequisite_incomplete"
        assert gates[c2.id].message is not None

    @pytest.mark.asyncio
    async def test_never_block_also_softens_a_failure(
        self, db, org, course, regular_user
    ):
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, grade=0, pass_threshold=50)

        gates = await h.gates({**ON_PASS, "never_block": True})
        assert gates[c2.id].locked is False

    @pytest.mark.asyncio
    async def test_chapters_unlock_in_order_not_all_at_once(
        self, db, org, course, regular_user
    ):
        """Finishing chapter one opens two, but three still waits for two."""
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        c3 = await h.add_chapter("Three")
        await h.add_assessment(c1, grade=90)
        await h.add_assessment(c2, grade=None)

        gates = await h.gates(ON)
        assert gates[c2.id].locked is False
        assert gates[c3.id].locked is True
        assert gates[c3.id].prerequisite_chapter_ids == [c1.id, c2.id]


class TestIsChapterUnlocked:
    """The single question an enforcing endpoint asks."""

    @pytest.mark.asyncio
    async def test_unknown_chapter_is_unlocked(self, db, org, course, regular_user):
        """Fail open for anything we cannot evaluate."""
        assert await is_chapter_unlocked(
            course.id, 999999, regular_user.id, db, policy=ON
        ) is True

    @pytest.mark.asyncio
    async def test_known_locked_chapter_is_false(
        self, db, org, course, regular_user
    ):
        h = ProgressionHarness(db, org, course, regular_user)
        c1 = await h.add_chapter("One")
        c2 = await h.add_chapter("Two")
        await h.add_assessment(c1, grade=None)

        assert await is_chapter_unlocked(
            course.id, c1.id, regular_user.id, db, policy=ON
        ) is True
        assert await is_chapter_unlocked(
            course.id, c2.id, regular_user.id, db, policy=ON
        ) is False
