"""Billing engine: subscription periods and purchase records

New tables rather than new columns, so deployments that build the schema with
``create_all`` (which never alters existing tables) get them too.

Revision ID: q3b4i5l6l7g8
Revises: p2l3a4n5i6d7
Create Date: 2026-09-29 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'q3b4i5l6l7g8'
down_revision: str | None = 'p2l3a4n5i6d7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), 'postgresql')


def _ts(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    op.create_table(
        'billing_subscription',
        sa.Column(
            'org_id', sa.BigInteger(),
            sa.ForeignKey('organization.id', ondelete='CASCADE'),
            primary_key=True, autoincrement=False,
        ),
        sa.Column('plan', sa.String(32), nullable=False),
        sa.Column('cycle', sa.String(16), nullable=False, server_default='monthly'),
        _ts('period_start'),
        _ts('period_end'),
        sa.Column('pending_plan', sa.String(32), nullable=True),
        sa.Column('pending_cycle', sa.String(16), nullable=True),
        _ts('learner_grace_started_at'),
        _ts('paused_at'),
        _ts('updated_at', nullable=False),
    )
    op.create_table(
        'billing_purchase',
        sa.Column(
            'reference', sa.String(100),
            sa.ForeignKey('payment_attempt.reference', ondelete='CASCADE'),
            primary_key=True,
        ),
        sa.Column(
            'org_id', sa.BigInteger(),
            sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('item', _JSON, nullable=False),
        sa.Column('description', sa.String(255), nullable=False),
        _ts('period_start'),
        _ts('covers_until'),
        sa.Column('checkout_url', sa.String(512), nullable=True),
        sa.Column('save_card', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            'invoice_id', sa.Integer(),
            sa.ForeignKey('invoice.id', ondelete='SET NULL'), nullable=True,
        ),
        _ts('created_at', nullable=False),
    )
    op.create_index('ix_billing_purchase_org_id', 'billing_purchase', ['org_id'])
    op.create_index('ix_billing_purchase_invoice_id', 'billing_purchase', ['invoice_id'])


def downgrade() -> None:
    op.drop_index('ix_billing_purchase_invoice_id', table_name='billing_purchase')
    op.drop_index('ix_billing_purchase_org_id', table_name='billing_purchase')
    op.drop_table('billing_purchase')
    op.drop_table('billing_subscription')
