"""Sequential chapter progression (opt-in, fail-open)

Adds a single nullable JSONB column, `course.progression_config`, holding the
instructor's sequential-gating choices.

Why one JSONB column rather than three booleans/enums:

* The whole feature is OFF unless this column is present AND says so. A NULL
  column is the "off" state, which means the feature cannot affect any course
  that has not been explicitly configured. That is deliberate: the failure mode
  of a progression gate is a learner who cannot get out, so the default state has
  to be the inert one.
* The three choices move together and are always read as a set, so splitting
  them across columns would invite half-configured states (a gate with no
  lockout policy) that have no sensible interpretation.

Shape (every key optional, absent = default):

    {
      "enabled": true,
      "require_pass": false,     # false: hand-in unlocks. true: must also pass.
      "never_block": false       # true: warn instead of locking (escape hatch)
    }

There is deliberately no database default and no NOT NULL: existing rows stay
NULL and stay ungated.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMN = 'progression_config'
_TABLE = 'course'


def _columns(inspector) -> set:
    return {c['name'] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _TABLE not in inspector.get_table_names():
        return
    if _COLUMN in _columns(inspector):
        return

    op.add_column(
        _TABLE,
        sa.Column(_COLUMN, sa.dialects.postgresql.JSONB(astext_type=sa.Text())),
    )
    # Nullable with no default: existing courses read as "not configured" and
    # therefore ungated, without a data backfill.


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _TABLE not in inspector.get_table_names():
        return
    if _COLUMN not in _columns(inspector):
        return

    op.drop_column(_TABLE, _COLUMN)
