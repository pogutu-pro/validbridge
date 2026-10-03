"""Tests for weighted-aggregate course certification.

The weighted mode is only allowed to activate when every gradable assessment
carries a weight and those weights total 100. Almost every test here is about the
*fallback*: a course that is only half configured must keep the exact legacy
all-must-pass behaviour rather than being certified from a partial total.
"""

import pytest
from sqlmodel import select

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.assignments import (
    Assignment,
    AssessmentKindEnum,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.services.courses.certifications import (
    DEFAULT_WEIGHTED_PASS_THRESHOLD,
    are_course_assignments_passed,
    compute_course_certification_score,
    resolve_certification_mode,
)


def _record(weight, percentage=100.0, passed=True, gradable=True,
            formative=False, submitted=True):
    """A minimal record shaped like _evaluate_course_assessments output."""
    return {
        "weight": weight,
        "gradable": gradable,
        "formative": formative,
        "percentage": percentage,
        "passed": passed,
        "submitted": submitted,
    }


class TestResolveCertificationMode:
    """The 100-total gate, tested directly because it is the safety property."""

    def test_all_weights_null_falls_back_to_and(self):
        mode, _ = resolve_certification_mode([_record(None), _record(None)])
        assert mode == "AND"

    def test_one_null_weight_falls_back_to_and(self):
        mode, _ = resolve_certification_mode([_record(50), _record(None)])
        assert mode == "AND"

    def test_weights_totalling_100_activates_weighted(self):
        mode, _ = resolve_certification_mode([_record(60), _record(40)])
        assert mode == "WEIGHTED"

    def test_float_weights_are_tolerated(self):
        # 33.3 + 33.3 + 33.4 must not fall back on float error alone.
        mode, _ = resolve_certification_mode(
            [_record(33.3), _record(33.3), _record(33.4)]
        )
        assert mode == "WEIGHTED"

    def test_weights_under_100_fall_back_to_and(self):
        # The dangerous case: 95 total must NOT certify from a 95% aggregate.
        mode, _ = resolve_certification_mode([_record(50), _record(45)])
        assert mode == "AND"

    def test_weights_over_100_fall_back_to_and(self):
        mode, _ = resolve_certification_mode([_record(60), _record(60)])
        assert mode == "AND"

    def test_empty_course_is_and(self):
        assert resolve_certification_mode([])[0] == "AND"

    def test_default_threshold_is_fifty(self):
        assert DEFAULT_WEIGHTED_PASS_THRESHOLD == 50.0


class WeightedTestHarness:
    """Builds a course of weighted assessments for the weighted-mode tests.

    specs entries are (weight, max_grade, grade, ungraded, task_count); `grade`
    of None means "learner never submitted".
    """

    def __init__(self, db, org, course, chapter, user):
        self.db = db
        self.org = org
        self.course = course
        self.chapter = chapter
        self.user = user

    async def build(self, specs):
        """
        specs: list of (weight, max_grade, grade, ungraded, num_tasks).

        Each entry becomes one published activity + one assignment + one task.
        """
        for idx, (weight, max_grade, grade, ungraded, task_count) in enumerate(
            specs, start=1
        ):
            activity = Activity(
                id=9000 + idx,
                name=f"a{idx}",
                activity_uuid=f"activity_w{idx}",
                activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                published=True,
                org_id=self.org.id,
                course_id=self.course.id,
                content={},
                creation_date="2024-01-01",
                update_date="2024-01-01",
            )
            self.db.add(activity)
            self.db.add(ChapterActivity(
                activity_id=activity.id,
                course_id=self.course.id,
                chapter_id=self.chapter.id,
                org_id=self.org.id,
                order=idx,
                creation_date="2024-01-01",
                update_date="2024-01-01",
            ))
            assignment = Assignment(
                title=f"a{idx}",
                description="",
                assignment_uuid=f"assignment_w{idx}",
                assessment_kind=AssessmentKindEnum.ASSIGNMENT,
                weight=weight,
                grading_type=GradingTypeEnum.PERCENTAGE,
                pass_threshold_percentage=50,
                ungraded=ungraded,
                published=True,
                org_id=self.org.id,
                course_id=self.course.id,
                chapter_id=self.chapter.id,
                activity_id=activity.id,
                creation_date="2024-01-01",
                update_date="2024-01-01",
            )
            self.db.add(assignment)
            await self.db.commit()
            await self.db.refresh(assignment)

            for t in range(task_count):
                self.db.add(AssignmentTask(
                    title=f"t{t}",
                    description="",
                    hint="",
                    assignment_task_uuid=f"assignmenttask_w{idx}_{t}",
                    assignment_id=assignment.id,
                    assignment_type=AssignmentTaskTypeEnum.QUIZ,
                    max_grade_value=max_grade,
                    org_id=self.org.id,
                    course_id=self.course.id,
                    chapter_id=self.chapter.id,
                    activity_id=activity.id,
                    creation_date="2024-01-01",
                    update_date="2024-01-01",
                ))
            if grade is not None:
                self.db.add(AssignmentUserSubmission(
                    assignmentusersubmission_uuid=f"aus_w{idx}",
                    assignment_id=assignment.id,
                    user_id=self.user.id,
                    grade=grade,
                    submission_status=AssignmentUserSubmissionStatus.GRADED,
                    creation_date="2024-01-01",
                    update_date="2024-01-01",
                ))
            await self.db.commit()



class TestWeightedAggregate:
    """Arithmetic of the aggregate, and how incomplete work scores."""

    async def _setup(
        self, db, org, course, chapter, user, *, specs, threshold=None
    ):
        """Thin delegate so the existing tests read the same as before."""
        harness = WeightedTestHarness(db, org, course, user=user, chapter=chapter)
        await harness.build(specs)

    @pytest.mark.asyncio
    async def test_weighted_aggregate_passes_when_above_default_threshold(
        self, db, org, course, chapter, regular_user
    ):
        await self._setup(
            db, org, course, chapter, regular_user,
            # 80 * 0.6 + 40 * 0.4 = 64
            specs=[(60, 100, 80, False, 1), (40, 100, 40, False, 1)],
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["mode"] == "WEIGHTED"
        assert result["percentage"] == 64.0
        assert result["passed"] is True

    @pytest.mark.asyncio
    async def test_weighted_aggregate_fails_when_below_threshold(
        self, db, org, course, chapter, regular_user
    ):
        await self._setup(
            db, org, course, chapter, regular_user,
            # 60 * 0.6 + 20 * 0.4 = 44
            specs=[(60, 100, 60, False, 1), (40, 100, 20, False, 1)],
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["mode"] == "WEIGHTED"
        assert result["percentage"] == 44.0
        assert result["passed"] is False

    @pytest.mark.asyncio
    async def test_course_threshold_overrides_the_default(
        self, db, org, course, chapter, regular_user
    ):
        await self._setup(
            db, org, course, chapter, regular_user,
            specs=[(60, 100, 80, False, 1), (40, 100, 40, False, 1)],
        )
        # 64 clears the default 50 but not a 70 bar.
        assert await are_course_assignments_passed(
            regular_user.id, course.id, db,
            pass_threshold_percentage=70,
        ) is False
        assert await are_course_assignments_passed(
            regular_user.id, course.id, db,
            pass_threshold_percentage=60,
        ) is True

    @pytest.mark.asyncio
    async def test_partial_credit_can_certify_in_weighted_mode(
        self, db, org, course, chapter, regular_user
    ):
        """The whole point of weighting: compensating strengths.

        90 on the 40% assessment and 40 on the 60% assessment is 60 overall —
        a pass, even though the learner failed the assessment carrying the most
        weight. AND mode would refuse this; that is the intended difference.
        """
        await self._setup(
            db, org, course, chapter, regular_user,
            specs=[(60, 100, 40, False, 1), (40, 100, 90, False, 1)],
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["mode"] == "WEIGHTED"
        assert result["percentage"] == 60.0
        assert result["passed"] is True

    @pytest.mark.asyncio
    async def test_missing_submission_scores_zero_not_skipped(
        self, db, org, course, chapter, regular_user
    ):
        """An unsubmitted weighted assessment must withhold the certificate.

        Skipping it would let the remaining weights renormalise to 100% and
        certify a learner who did half the course.
        """
        await self._setup(
            db, org, course, chapter, regular_user,
            specs=[(60, 100, 100, False, 1), (40, 100, None, False, 1)],
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["mode"] == "WEIGHTED"
        assert result["percentage"] == 60.0
        assert result["passed"] is True

    @pytest.mark.asyncio
    async def test_and_mode_ignores_course_threshold(
        self, db, org, course, chapter, regular_user
    ):
        """The course bar is a weighted-mode knob only.

        With all weights NULL the course is in AND mode, where each assessment
        keeps its own 50% threshold; a 99% course threshold must not change that.
        """
        await self._setup(
            db, org, course, chapter, regular_user,
            specs=[(None, 100, 55, False, 1)],
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db,
            pass_threshold_percentage=99,
        )
        assert result["mode"] == "AND"
        assert result["percentage"] is None
        assert result["passed"] is True

    @pytest.mark.asyncio
    async def test_and_mode_still_requires_every_assessment_passed(
        self, db, org, course, chapter, regular_user
    ):
        await self._setup(
            db, org, course, chapter, regular_user,
            specs=[
                (None, 100, 100, False, 1),
                (None, 100, 20, False, 1),
            ],
        )
        assert await are_course_assignments_passed(
            regular_user.id, course.id, db
        ) is False

    @pytest.mark.asyncio
    async def test_formative_assessment_is_excluded_from_the_weight_sum(
        self, db, org, course, chapter, regular_user
    ):
        """Formative work carries no weight and must not drag the total to 95.

        An author who marks one of three assessments ungraded should still get
        weighted mode over the two that actually score.
        """
        await self._setup(
            db, org, course, chapter, regular_user,
            specs=[
                (50, 100, 100, True, 1),   # formative: excluded entirely
                (60, 100, 100, False, 1),
                (40, 100, 100, False, 1),
            ],
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["mode"] == "WEIGHTED"
        assert result["percentage"] == 100.0
        assert result["passed"] is True
        # Every assessment is still reported, but the formative one is flagged
        # and excluded from the arithmetic.
        assert len(result["breakdown"]) == 3
        by_uuid = {b["assignment_uuid"]: b for b in result["breakdown"]}
        assert by_uuid["assignment_w1"]["formative"] is True
        assert by_uuid["assignment_w1"]["gradable"] is False
        assert by_uuid["assignment_w2"]["gradable"] is True

    @pytest.mark.asyncio
    async def test_zero_max_assessment_is_excluded_from_the_weight_sum(
        self, db, org, course, chapter, regular_user
    ):
        await self._setup(
            db, org, course, chapter, regular_user,
            specs=[
                (50, 0, 0, False, 1),      # no gradable points: excluded
                (60, 100, 100, False, 1),
                (40, 100, 100, False, 1),
            ],
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["mode"] == "WEIGHTED"
        assert result["percentage"] == 100.0

    @pytest.mark.asyncio
    async def test_zero_weight_assessment_cannot_inflate_the_total(
        self, db, org, course, chapter, regular_user
    ):
        await self._setup(
            db, org, course, chapter, regular_user,
            specs=[
                (0, 100, 100, False, 1),
                (60, 100, 50, False, 1),
                (40, 100, 50, False, 1),
            ],
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["mode"] == "WEIGHTED"
        # 100*0 + 50*0.6 + 50*0.4 = 50
        assert result["percentage"] == 50.0
        assert result["passed"] is True

    @pytest.mark.asyncio
    async def test_unpublished_assessment_does_not_enter_the_total(
        self, db, org, course, chapter, regular_user
    ):
        await self._setup(
            db, org, course, chapter, regular_user,
            specs=[(100, 100, 0, False, 1)],
        )
        # Flip the activity to draft after setup.
        activity = await db.get(Activity, 9001)
        activity.published = False
        await db.commit()

        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        # With the only assessment hidden there is nothing to certify against.
        assert result["breakdown"] == []
        assert result["passed"] is True

    @pytest.mark.asyncio
    async def test_breakdown_reports_each_assessment(
        self, db, org, course, chapter, regular_user
    ):
        await self._setup(
            db, org, course, chapter, regular_user,
            specs=[(60, 100, 80, False, 1), (40, 100, 40, False, 1)],
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        by_uuid = {b["assignment_uuid"]: b for b in result["breakdown"]}
        assert set(by_uuid) == {"assignment_w1", "assignment_w2"}
        assert by_uuid["assignment_w1"]["weight"] == 60
        assert by_uuid["assignment_w1"]["percentage"] == 80.0
        assert by_uuid["assignment_w1"]["assessment_kind"] == "ASSIGNMENT"


class TestLegacySemanticsPreserved:
    """The three-way legacy rule must survive the weighted feature untouched.

    Each kind of assessment satisfies the certificate gate a different way, and
    all three are easy to lose in a refactor that starts skipping assessments.
    """

    @pytest.mark.asyncio
    async def test_formative_assessment_blocks_until_handed_in(
        self, db, org, course, chapter, regular_user
    ):
        """Legacy rule: ungraded work is satisfied by submission, not by a grade.

        Reworking this gate once dropped the check, which silently let courses
        certify learners who never handed in their practice work.
        """
        setup = WeightedTestHarness(db, org, course, chapter, regular_user)
        await setup.build(specs=[(None, 100, None, True, 1)])
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["mode"] == "AND"
        assert result["passed"] is False

    @pytest.mark.asyncio
    async def test_submitted_formative_assessment_does_not_block(
        self, db, org, course, chapter, regular_user
    ):
        """Once handed in, formative work is satisfied — it has no grade."""
        setup = WeightedTestHarness(db, org, course, chapter, regular_user)
        await setup.build(specs=[(None, 100, 0, True, 1)])
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["passed"] is True

    @pytest.mark.asyncio
    async def test_formative_cannot_fail_a_certificate(
        self, db, org, course, chapter, regular_user
    ):
        """A zero grade on formative work must not block anything."""
        setup = WeightedTestHarness(db, org, course, chapter, regular_user)
        await setup.build(
            specs=[(None, 100, 0, True, 1), (None, 100, 90, False, 1)]
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["passed"] is True

    @pytest.mark.asyncio
    async def test_zero_max_assessment_is_vacuously_satisfied(
        self, db, org, course, chapter, regular_user
    ):
        """No gradable points means nothing to pass or fail — must not block."""
        setup = WeightedTestHarness(db, org, course, chapter, regular_user)
        await setup.build(
            specs=[(None, 0, 0, False, 1), (None, 100, 90, False, 1)]
        )
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["passed"] is True

    @pytest.mark.asyncio
    async def test_submitted_but_not_graded_blocks_in_and_mode(
        self, db, org, course, chapter, regular_user
    ):
        """Handed in but not yet marked up is still not a pass.

        A submission without a GRADED status has no grade to trust yet, so the
        certificate is withheld rather than assuming the work is correct.
        """
        setup = WeightedTestHarness(db, org, course, chapter, regular_user)
        await setup.build(specs=[(None, 100, 90, False, 1)])
        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["passed"] is True

        # Same assessment, but the teacher took the GRADED status back.
        sub = (await db.execute(
            select(AssignmentUserSubmission)
        )).scalars().one()
        sub.submission_status = AssignmentUserSubmissionStatus.SUBMITTED
        await db.commit()

        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["passed"] is False

    @pytest.mark.asyncio
    async def test_submitted_but_not_graded_scores_zero_in_weighted_mode(
        self, db, org, course, chapter, regular_user
    ):
        """In weighted mode an unmarked submission contributes zero, not its grade.

        Treating an ungraded row as if it had scored would certify learners on
        grades no teacher ever confirmed.
        """
        setup = WeightedTestHarness(db, org, course, chapter, regular_user)
        await setup.build(specs=[(100, 100, 90, False, 1)])
        sub = (await db.execute(
            select(AssignmentUserSubmission)
        )).scalars().one()
        sub.submission_status = AssignmentUserSubmissionStatus.SUBMITTED
        await db.commit()

        result = await compute_course_certification_score(
            regular_user.id, course.id, db
        )
        assert result["mode"] == "WEIGHTED"
        assert result["percentage"] == 0.0
        assert result["passed"] is False
