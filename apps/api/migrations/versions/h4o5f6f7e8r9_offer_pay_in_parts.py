"""Let a customer-choice offer be paid in parts

Adds payments_offers.total_amount (the full price) and
payments_enrollments.amount_paid (running total paid).

Revision ID: h4o5f6f7e8r9
Revises: g3s4t5a6f7f8
Create Date: 2026-10-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'h4o5f6f7e8r9'
down_revision: Union[str, None] = 'g3s4t5a6f7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if 'total_amount' not in _columns('payments_offers'):
        op.add_column('payments_offers', sa.Column('total_amount', sa.Float(), nullable=True))
    if 'amount_paid' not in _columns('payments_enrollments'):
        op.add_column(
            'payments_enrollments',
            sa.Column('amount_paid', sa.Float(), nullable=False, server_default='0'),
        )


def downgrade() -> None:
    op.drop_column('payments_enrollments', 'amount_paid')
    op.drop_column('payments_offers', 'total_amount')
