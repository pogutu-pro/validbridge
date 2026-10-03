"""Add integrity constraints to the assessment tables

Two latent defects that the code could not defend against on its own:

1. `assignment.activity_id` had no uniqueness. One activity is one assessment —
   the read path, the submit path and the certificate gate all resolve an
   assignment from its activity and assume a single row. A second row silently
   split grading: the certificate gate saw one of them, the learner saw the
   other.

2. `assignmenttask.max_grade_value` accepted negatives. `compute_assignment_grade`
   clamps the *raw* grade into [0, max] but reads max directly, so a negative max
   made the percentage negative and `passed` unreachably false — a course with one
   mis-typed task could never certify, and no error surfaced anywhere.

Both are checked before the constraint is added so a database that already
carries the defect fails loudly with a readable message instead of an opaque
IntegrityError, and both are guarded so a partially-applied database is safe to
re-run.

Revision ID: z1a2b3c4d5e6
Revises: q3b4i5l6l7g8
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'z1a2b3c4d5e6'
down_revision: Union[str, None] = 'q3b4i5l6l7g8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_UQ_ASSIGNMENT_ACTIVITY = 'uq_assignment_activity_id'
_CK_TASK_MAX_GRADE = 'ck_assignmenttask_max_grade_non_negative'


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'assignment' in tables:
        existing_uq = {
            uc['name'] for uc in inspector.get_unique_constraints('assignment')
        }
        if _UQ_ASSIGNMENT_ACTIVITY not in existing_uq:
            # Refuse rather than silently delete: two rows for one activity means
            # learners have already been graded against an ambiguous set of
            # tasks, and which row to keep is a decision only an author can make.
            duplicates = bind.execute(
                sa.text(
                    """
                    SELECT activity_id, count(*) AS n
                    FROM assignment
                    WHERE activity_id IS NOT NULL
                    GROUP BY activity_id
                    HAVING count(*) > 1
                    ORDER BY n DESC, activity_id
                    LIMIT 10
                    """
                )
            ).fetchall()
            if duplicates:
                detail = ", ".join(
                    f"activity_id={row[0]} (x{row[1]})" for row in duplicates
                )
                raise RuntimeError(
                    "Cannot add uq_assignment_activity_id: these activities have "
                    f"more than one assignment row: {detail}. Resolve the duplicates "
                    "in the admin UI (or run scripts/audit_assessments.py) and "
                    "re-run this migration."
                )
            op.create_unique_constraint(
                _UQ_ASSIGNMENT_ACTIVITY, 'assignment', ['activity_id']
            )

    if 'assignmenttask' in tables:
        existing_ck = {
            ck['name']
            for ck in inspector.get_check_constraints('assignmenttask')
            if ck.get('name')
        }
        if _CK_TASK_MAX_GRADE not in existing_ck:
            bad = bind.execute(
                sa.text(
                    "SELECT count(*) FROM assignmenttask "
                    "WHERE max_grade_value < 0"
                )
            ).scalar_one()
            if bad:
                raise RuntimeError(
                    "Cannot add ck_assignmenttask_max_grade_non_negative: "
                    f"{bad} assignment task(s) have a negative max_grade_value. "
                    "Fix them in the assignment editor and re-run this migration."
                )
            # NOT VALID first: on a large table this skips the full-table scan,
            # and VALIDATE below confirms it. The two-step keeps the lock short
            # on a hot table while still refusing to leave the constraint
            # unverified.
            op.create_check_constraint(
                _CK_TASK_MAX_GRADE,
                'assignmenttask',
                'max_grade_value >= 0',
                postgresql_not_valid=True,
            )
            op.execute(
                sa.text(
                    f"ALTER TABLE assignmenttask VALIDATE CONSTRAINT {_CK_TASK_MAX_GRADE}"
                )
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'assignment' in tables:
        existing_uq = {
            uc['name'] for uc in inspector.get_unique_constraints('assignment')
        }
        if _UQ_ASSIGNMENT_ACTIVITY in existing_uq:
            op.drop_constraint(
                _UQ_ASSIGNMENT_ACTIVITY, 'assignment', type_='unique'
            )

    if 'assignmenttask' in tables:
        existing_ck = {
            ck['name']
            for ck in inspector.get_check_constraints('assignmenttask')
            if ck.get('name')
        }
        if _CK_TASK_MAX_GRADE in existing_ck:
            op.drop_constraint(
                _CK_TASK_MAX_GRADE, 'assignmenttask', type_='check'
            )