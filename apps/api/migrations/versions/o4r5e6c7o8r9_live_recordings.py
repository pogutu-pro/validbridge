"""Live recordings, recording policy, stage focus and hand-raise counts

Revision ID: o4r5e6c7o8r9
Revises: n3q4u5i6z7a8
Create Date: 2026-09-24 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'o4r5e6c7o8r9'
down_revision: Union[str, None] = 'n3q4u5i6z7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'live_session',
        sa.Column('stage_focus', sa.String(length=16), nullable=False, server_default='presentation'),
    )
    op.add_column(
        'live_session',
        sa.Column('record_automatically', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.add_column(
        'live_session',
        sa.Column('publish_recordings', sa.Boolean(), nullable=False, server_default=sa.text('true')),
    )
    op.add_column(
        'live_session_participant',
        sa.Column('hand_raises', sa.Integer(), nullable=False, server_default='0'),
    )

    op.create_table(
        'live_recording',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('recording_uuid', sa.String(length=64), nullable=False),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('live_session.id', ondelete='CASCADE'), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('started_by_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('egress_id', sa.String(length=64), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('activity_uuid', sa.String(length=64), nullable=False),
        sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='SET NULL'), nullable=True),
        sa.Column('storage_key', sa.String(length=500), nullable=False),
        sa.Column('file_size', sa.BigInteger(), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column('error', sa.String(length=64), nullable=True),
        sa.Column('finalize_attempts', sa.Integer(), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ready_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('egress_id', name='live_recording_egress_id_key'),
    )
    op.create_index('ix_live_recording_recording_uuid', 'live_recording', ['recording_uuid'], unique=True)
    op.create_index('ix_live_recording_status', 'live_recording', ['status'])
    op.create_index('ix_live_recording_session_created', 'live_recording', ['session_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_live_recording_session_created', table_name='live_recording')
    op.drop_index('ix_live_recording_status', table_name='live_recording')
    op.drop_index('ix_live_recording_recording_uuid', table_name='live_recording')
    op.drop_table('live_recording')
    op.drop_column('live_session_participant', 'hand_raises')
    op.drop_column('live_session', 'publish_recordings')
    op.drop_column('live_session', 'record_automatically')
    op.drop_column('live_session', 'stage_focus')
