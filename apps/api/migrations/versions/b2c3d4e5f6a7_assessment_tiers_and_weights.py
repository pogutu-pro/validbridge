"""Assessment tiers: kind, weight and human-review flag

Adds the three fields that turn a single "assignment" into a three-tier
assessment system, plus a course-level certification threshold.

All three assessment columns are nullable and NULL means "not opted in":

- `assessment_kind` NULL is a legacy/unclassified assessment. It is NOT
  ASSIGNMENT. Every assignment that existed before this migration keeps NULL, so
  no existing course changes behaviour, and an author can classify some
  assessments and leave the rest alone without the unclassified ones silently
  becoming assignments.
- `weight` NULL means "not weighted". The certification gate uses a weighted
  aggregate only when every assessment in the course has a weight summing to
  100 (+/-0.01); anything else falls back to the legacy all-must-pass rule.
- `requires_human_review` NULL means auto-grading finalises normally.

`ck_assignment_weight_range` bounds the weight to 0-100. Zero is legal and
means something different from NULL (unscored-but-present vs not weighted).

`pass_threshold_percentage` on Certifications is the course-level passing line
for the weighted aggregate, so an author can set it without editing every
assessment. Nullable, and ignored in legacy AND-mode where each assessment keeps
using its own threshold.

Revision ID: b2c3d4e5f6a7
Revises: d5e6f7a8b9c0
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_WEIGHT_CHECK = 'ck_assignment_weight_range'


def _columns(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignment' in inspector.get_table_names():
        cols = _columns(inspector, 'assignment')

        if 'assessment_kind' not in cols:
            op.add_column(
                'assignment',
                sa.Column('assessment_kind', sa.String(length=32), nullable=True),
            )

        if 'weight' not in cols:
            op.add_column(
                'assignment',
                sa.Column('weight', sa.Float(), nullable=True),
            )

        if 'requires_human_review' not in cols:
            op.add_column(
                'assignment',
                sa.Column('requires_human_review', sa.Boolean(), nullable=True),
            )

        if _WEIGHT_CHECK not in {
            cc['name'] for cc in inspector.get_check_constraints('assignment')
        }:
            # Pre-flight rather than let the ALTER fail opaquely: an
            # out-of-range weight can only exist if something wrote around the
            # schema, so surface exactly which rows are at fault.
            offenders = bind.execute(
                sa.text(
                    """
                    SELECT id, assignment_uuid, weight
                    FROM assignment
                    WHERE weight IS NOT NULL AND (weight < 0 OR weight > 100)
                    ORDER BY id
                    LIMIT 10
                    """
                )
            ).fetchall()
            if offenders:
                detail = ", ".join(
                    f"id={row[0]} ({row[1]}) weight={row[2]}" for row in offenders
                )
                raise RuntimeError(
                    f"Cannot add {_WEIGHT_CHECK}: these assignments have a weight "
                    f"outside 0-100: {detail}. Weights are a percentage share of "
                    "the final grade; set them to NULL (unweighted) or a value "
                    "in range, then re-run this migration."
                )
            op.create_check_constraint(
                _WEIGHT_CHECK, 'assignment',
                'weight IS NULL OR (weight >= 0 AND weight <= 100)',
            )

    if 'certifications' in inspector.get_table_names():
        cols = _columns(inspector, 'certifications')
        if 'pass_threshold_percentage' not in cols:
            op.add_column(
                'certifications',
                sa.Column(
                    'pass_threshold_percentage',
                    sa.Float(),
                    nullable=True,
                ),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'certifications' in inspector.get_table_names():
        if 'pass_threshold_percentage' in _columns(inspector, 'certifications'):
            op.drop_column('certifications', 'pass_threshold_percentage')

    if 'assignment' in inspector.get_table_names():
        checks = {cc['name'] for cc in inspector.get_check_constraints('assignment')}
        if _WEIGHT_CHECK in checks:
            op.drop_constraint(_WEIGHT_CHECK, 'assignment', type_='check')

        cols = _columns(inspector, 'assignment')
        for column in ('requires_human_review', 'weight', 'assessment_kind'):
            if column in cols:
                op.drop_column('assignment', column)
