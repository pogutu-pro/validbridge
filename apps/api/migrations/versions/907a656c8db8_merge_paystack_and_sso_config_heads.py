"""merge Paystack payments and SSO config heads

Revision ID: 907a656c8db8
Revises: b5c6d7e8f9a1, c0d1e2f3a4b5
Create Date: 2026-09-20 17:41:28.076773

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = '907a656c8db8'
down_revision: Union[str, None] = ('b5c6d7e8f9a1', 'c0d1e2f3a4b5')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
