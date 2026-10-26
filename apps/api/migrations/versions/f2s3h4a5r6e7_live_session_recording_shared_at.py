"""Remember when a lesson's recording was sent to the students who missed it

Revision ID: f2s3h4a5r6e7
Revises: e1x2a3m4m5o6
Create Date: 2026-10-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f2s3h4a5r6e7'
down_revision: Union[str, None] = 'e1x2a3m4m5o6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('live_session')}
    if 'recording_shared_at' not in columns:
        op.add_column('live_session', sa.Column('recording_shared_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('live_session', 'recording_shared_at')
