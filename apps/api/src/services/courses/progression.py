"""Sequential chapter progression.

A course can require a learner to finish chapter N's assessments before chapter
N+1 opens. Everything here is built around one asymmetry:

    A bug in this module must let people through, never trap them.

A learner who cannot progress is a support incident with no self-service exit,
so every ambiguous input resolves to "unlocked":

* No policy configured            -> unlocked (the feature is opt-in).
* Instructor never placed work    -> unlocked (nothing to wait for).
* Assessment is a draft           -> unlocked (invisible to learners).
* Assessment has no activity      -> unlocked (cannot be submitted).
* Assessment has no gradable work -> unlocked (nothing to grade).
* We cannot determine the answer  -> unlocked, with a reason recorded.

`evaluate_course_progression` therefore never raises for authoring reasons. It
returns a per-chapter verdict the API can enforce and the UI can explain.
"""

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.assignments import (
    Assignment,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.courses import (
    UnlockRequirement,
)
from src.services.courses.activities.assignments import (
    _HANDED_IN_STATUSES,
    compute_assignment_grade,
)


@dataclass
class ResolvedProgressionPolicy:
    """The instructor's choices, with every default applied.

    Constructed via :func:`resolve_progression_policy` so that a malformed or
    partial config can never produce a half-applied policy.
    """

    enabled: bool = False
    require_pass: bool = False
    never_block: bool = False

    @property
    def requirement(self) -> UnlockRequirement:
        return (
            UnlockRequirement.PASSED
            if self.require_pass
            else UnlockRequirement.SUBMITTED
        )


def resolve_progression_policy(raw: Any) -> ResolvedProgressionPolicy:
    """
    Read an instructor's stored config defensively.

    Anything unrecognised resolves to the inert default. A typo in the stored
    JSON therefore disables gating rather than blocking every learner on the
    course, which is the only acceptable direction for this failure.
    """
    if not isinstance(raw, dict):
        return ResolvedProgressionPolicy()

    enabled = raw.get("enabled")
    if not isinstance(enabled, bool):
        return ResolvedProgressionPolicy()

    return ResolvedProgressionPolicy(
        enabled=enabled,
        require_pass=bool(raw.get("require_pass", False)),
        never_block=bool(raw.get("never_block", False)),
    )


@dataclass
class ChapterGate:
    """The verdict for one chapter, plus enough detail to explain it."""

    chapter_id: int
    locked: bool = False
    # Machine-readable cause, for the UI to pick an icon and message:
    #   None | "prerequisite_incomplete" | "prerequisite_failed"
    reason: str | None = None
    # Human-readable explanation, safe to show a learner.
    message: str | None = None
    # Titles of the assessments standing between this learner and the chapter.
    blocking: list[dict] = field(default_factory=list)
    # Chapters that must be finished first.
    prerequisite_chapter_ids: list[int] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "chapter_id": self.chapter_id,
            "locked": self.locked,
            "reason": self.reason,
            "message": self.message,
            "blocking": self.blocking,
            "prerequisite_chapter_ids": self.prerequisite_chapter_ids,
        }


def _is_truthy_status(status: Any) -> bool:
    return status in _HANDED_IN_STATUSES


async def _placed_assessments_by_chapter(
    course_id: int,
    chapter_ids: list[int],
    db_session: AsyncSession,
) -> dict[int, list[Assignment]]:
    """
    Published, actually-placed assessments per chapter.

    An assignment only counts when its activity is placed in that chapter AND is
    published. Anything else is an authoring state the learner cannot act on, so
    it must not be able to block them. Activities placed in two chapters are
    attributed to each, which is the pre-existing overlap behaviour.
    """
    if not chapter_ids:
        return {}

    rows = (await db_session.execute(
        select(Assignment, ChapterActivity.chapter_id)
        .join(Activity, Activity.id == Assignment.activity_id)
        .join(
            ChapterActivity,
            (ChapterActivity.activity_id == Assignment.activity_id)
            & (ChapterActivity.course_id == Assignment.course_id),
        )
        .where(
            Assignment.course_id == course_id,
            Assignment.activity_id.is_not(None),
            Activity.published == True,  # noqa: E712
            ChapterActivity.chapter_id.in_(chapter_ids),
        )
    )).all()

    out: dict[int, list[Assignment]] = {cid: [] for cid in chapter_ids}
    seen: set[tuple[int, int]] = set()
    for assignment, chapter_id in rows:
        key = (chapter_id, assignment.id)
        if key in seen:
            continue
        seen.add(key)
        out.setdefault(chapter_id, []).append(assignment)
    return out


async def _max_grades(
    assignments: list[Assignment],
    db_session: AsyncSession,
) -> dict[int, int]:
    if not assignments:
        return {}
    from sqlalchemy import func

    from src.db.courses.assignments import AssignmentTask

    ids = [a.id for a in assignments if a.id is not None]
    if not ids:
        return {}
    rows = (await db_session.execute(
        select(
            AssignmentTask.assignment_id,
            func.coalesce(func.sum(AssignmentTask.max_grade_value), 0),
        )
        .where(AssignmentTask.assignment_id.in_(ids))
        .group_by(AssignmentTask.assignment_id)
    )).all()
    return {aid: int(m or 0) for aid, m in rows}


async def _submissions(
    user_id: int,
    assignments: list[Assignment],
    db_session: AsyncSession,
) -> dict[int, AssignmentUserSubmission]:
    ids = [a.id for a in assignments if a.id is not None]
    if not ids:
        return {}
    rows = (await db_session.execute(
        select(AssignmentUserSubmission).where(
            AssignmentUserSubmission.user_id == user_id,
            AssignmentUserSubmission.assignment_id.in_(ids),
        )
    )).scalars().all()
    return {s.assignment_id: s for s in rows}


def _assess_state(
    assignment: Assignment,
    submission: AssignmentUserSubmission | None,
    max_grade: int,
    require_pass: bool,
) -> str:
    """One assessment's state: 'submitted', 'passed', 'failed' or 'pending'."""
    if submission is None or not _is_truthy_status(submission.submission_status):
        return "pending"

    if not require_pass:
        return "submitted"

    if submission.submission_status != AssignmentUserSubmissionStatus.GRADED:
        return "pending"
    if max_grade <= 0:
        # Nothing gradable to check against; do not punish the learner for it.
        return "submitted"
    computed = compute_assignment_grade(
        int(submission.grade or 0),
        max_grade,
        assignment.grading_type,
        pass_threshold_percentage=assignment.pass_threshold_percentage,
    )
    return "passed" if computed.get("passed") else "failed"


async def evaluate_course_progression(
    course_id: int,
    user_id: int | None,
    db_session: AsyncSession,
    policy: Any = None,
) -> dict[int, ChapterGate]:
    """
    Per-chapter lock state for one learner.

    ``policy`` is the raw ``course.progression_config``; it is read here rather
    than fetched so callers that already hold the course do not re-query, and so
    tests can exercise the engine without a Course row.

    Returns a map of chapter_id -> ChapterGate covering every chapter of the
    course. When gating is off, every chapter comes back unlocked with no
    blocking detail, so callers can use the result unconditionally.
    """
    from src.db.courses.chapters import Chapter

    resolved = resolve_progression_policy(policy)

    chapters = list((await db_session.execute(
        select(Chapter)
        .where(Chapter.course_id == course_id)
        .order_by(Chapter.id)
    )).scalars().all())

    gates: dict[int, ChapterGate] = {
        c.id: ChapterGate(chapter_id=c.id) for c in chapters if c.id is not None
    }
    if not resolved.enabled or user_id is None:
        return gates

    ordered_ids = [c.id for c in chapters if c.id is not None]
    placed = await _placed_assessments_by_chapter(course_id, ordered_ids, db_session)
    everything = [a for group in placed.values() for a in group]
    maxes = await _max_grades(everything, db_session)
    subs = await _submissions(user_id, everything, db_session)

    # An assessment with no gradable points has no submission to wait for and no
    # grade to fail, so it is dropped from gating entirely rather than left to
    # sit outstanding forever. This mirrors the certification gate, which treats
    # the same case as vacuously satisfied.
    #
    # Before this filter an author who added a placeholder assessment with no
    # tasks locked every later chapter for every learner, permanently, with no
    # action that could clear it.
    gateable = {
        cid: [a for a in group if maxes.get(a.id, 0) > 0]
        for cid, group in placed.items()
    }

    # Chapter order is by id, which is the order they were authored. The first
    # chapter is always open: gating it would leave a learner with no way in.
    for index, chapter_id in enumerate(ordered_ids):
        if index == 0:
            continue

        gate = gates[chapter_id]
        prerequisite_ids = [ordered_ids[i] for i in range(index)]

        outstanding: list[dict] = []
        failed = False
        for prereq_id in prerequisite_ids:
            for assignment in gateable.get(prereq_id, []):
                state = _assess_state(
                    assignment,
                    subs.get(assignment.id),
                    maxes.get(assignment.id, 0),
                    resolved.require_pass,
                )
                if state in ("submitted", "passed"):
                    continue
                failed = failed or state == "failed"
                outstanding.append({
                    "assignment_uuid": assignment.assignment_uuid,
                    "title": assignment.title,
                    "chapter_id": prereq_id,
                    "state": state,
                })

        if not outstanding:
            # Fail open: nothing placed, or everything already done.
            gate.prerequisite_chapter_ids = prerequisite_ids
            continue

        gate.blocking = outstanding
        gate.prerequisite_chapter_ids = prerequisite_ids

        if resolved.never_block:
            # Instructor chose warnings over gates. Report what is outstanding so
            # the UI can still nudge, but never withhold the chapter.
            gate.reason = "prerequisite_incomplete"
            gate.message = (
                "Finish the earlier assessments to earn full credit, but you "
                "can continue."
            )
            continue

        gate.locked = True
        if failed:
            gate.reason = "prerequisite_failed"
            gate.message = (
                "An earlier assessment was not passed. Retry it, or ask your "
                "instructor to unlock this chapter."
            )
        else:
            gate.reason = "prerequisite_incomplete"
            gate.message = (
                "Finish the earlier assessments to unlock this chapter."
            )

    return gates


async def is_chapter_unlocked(
    course_id: int,
    chapter_id: int,
    user_id: int | None,
    db_session: AsyncSession,
    policy: Any = None,
) -> bool:
    """
    The single question an enforcing endpoint needs to ask.

    Anything other than a definite "yes, this learner is missing a prerequisite"
    returns True. Only an explicit lock blocks.
    """
    gates = await evaluate_course_progression(
        course_id, user_id, db_session, policy=policy
    )
    gate = gates.get(chapter_id)
    if gate is None:
        return True
    return not gate.locked
