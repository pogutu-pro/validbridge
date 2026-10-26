"""Add user.platform_role for limited platform staff (support, finance)

Revision ID: g3s4t5a6f7f8
Revises: f2s3h4a5r6e7
Create Date: 2026-10-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'g3s4t5a6f7f8'
down_revision: Union[str, None] = 'f2s3h4a5r6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('user')}
    if 'platform_role' not in columns:
        op.add_column('user', sa.Column('platform_role', sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column('user', 'platform_role')
