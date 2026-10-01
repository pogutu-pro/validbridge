"""Live classroom interaction: messages, polls, participant moderation state

Revision ID: m2c3l4a5s6r7
Revises: l1v2e3s4s5n6
Create Date: 2026-09-23 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'm2c3l4a5s6r7'
down_revision: Union[str, None] = 'l1v2e3s4s5n6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'live_session_participant',
        sa.Column('media_allowed', sa.Boolean(), nullable=False, server_default=sa.text('true')),
    )
    op.add_column(
        'live_session_participant',
        sa.Column('removed_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        'live_session_message',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('message_uuid', sa.String(length=64), nullable=False),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('live_session.id', ondelete='CASCADE'), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=True),
        sa.Column('answered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_live_session_message_message_uuid', 'live_session_message', ['message_uuid'], unique=True)
    op.create_index(
        'ix_live_message_session_kind_created', 'live_session_message', ['session_id', 'kind', 'created_at']
    )

    op.create_table(
        'live_poll',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('poll_uuid', sa.String(length=64), nullable=False),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('live_session.id', ondelete='CASCADE'), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('question', sa.String(length=300), nullable=False),
        sa.Column('options', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_live_poll_poll_uuid', 'live_poll', ['poll_uuid'], unique=True)
    op.create_index('ix_live_poll_session_created', 'live_poll', ['session_id', 'created_at'])

    op.create_table(
        'live_poll_vote',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('poll_id', sa.Integer(), sa.ForeignKey('live_poll.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('option_index', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('poll_id', 'user_id', name='uq_live_poll_vote_poll_user'),
    )


def downgrade() -> None:
    op.drop_table('live_poll_vote')
    op.drop_index('ix_live_poll_session_created', table_name='live_poll')
    op.drop_index('ix_live_poll_poll_uuid', table_name='live_poll')
    op.drop_table('live_poll')
    op.drop_index('ix_live_message_session_kind_created', table_name='live_session_message')
    op.drop_index('ix_live_session_message_message_uuid', table_name='live_session_message')
    op.drop_table('live_session_message')
    op.drop_column('live_session_participant', 'removed_at')
    op.drop_column('live_session_participant', 'media_allowed')
