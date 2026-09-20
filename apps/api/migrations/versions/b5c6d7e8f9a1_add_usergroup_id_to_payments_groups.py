"""Add usergroup_id to payments_groups

Links each payments group to the usergroup that mirrors its buyers and
resources (the ``payments → user group`` sync target). Guarded so it is a
no-op on databases already created fresh by ``create_all`` (the same bootstrap
path the rest of this build uses — see src/core/events/database.py).

Revision ID: b5c6d7e8f9a1
Revises: a1p2a3y4s5t6
Create Date: 2026-09-18
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b5c6d7e8f9a1'
down_revision: Union[str, None] = 'a1p2a3y4s5t6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE IF EXISTS payments_groups "
        "ADD COLUMN IF NOT EXISTS usergroup_id BIGINT"
    )


def downgrade() -> None:
    # No data-safe downgrade: dropping the column would orphan the usergroups
    # that already mirror buyers.
    pass