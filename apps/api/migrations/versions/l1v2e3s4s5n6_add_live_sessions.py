"""Add live classroom sessions, participants and events

Revision ID: l1v2e3s4s5n6
Revises: 907a656c8db8
Create Date: 2026-09-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'l1v2e3s4s5n6'
down_revision: Union[str, None] = '907a656c8db8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_STATUS = ('SCHEDULED', 'READY', 'LIVE', 'ENDED', 'PROCESSING', 'COMPLETED')
_RECORDING = ('NONE', 'RECORDING', 'PROCESSING', 'READY', 'FAILED')
_ROLE = ('INSTRUCTOR', 'MODERATOR', 'LEARNER')


def upgrade() -> None:
    op.create_table(
        'live_session',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('session_uuid', sa.String(length=64), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
        sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='SET NULL'), nullable=True),
        sa.Column('instructor_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.Enum(*_STATUS, name='live_session_status'), nullable=False),
        sa.Column('recording_status', sa.Enum(*_RECORDING, name='live_recording_status'), nullable=False),
        sa.Column('livekit_room_name', sa.String(length=128), nullable=False),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ready_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('livekit_room_name', name='live_session_livekit_room_name_key'),
    )
    op.create_index('ix_live_session_session_uuid', 'live_session', ['session_uuid'], unique=True)
    op.create_index('ix_live_session_org_id', 'live_session', ['org_id'])
    op.create_index('ix_live_session_activity_id', 'live_session', ['activity_id'])
    op.create_index('ix_live_session_instructor_id', 'live_session', ['instructor_id'])
    op.create_index('ix_live_session_course_scheduled', 'live_session', ['course_id', 'scheduled_at'])
    op.create_index('ix_live_session_status', 'live_session', ['status'])

    op.create_table(
        'live_session_participant',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('live_session.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.Enum(*_ROLE, name='live_participant_role'), nullable=False),
        sa.Column('joined_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('left_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=False),
        sa.Column('connection_count', sa.Integer(), nullable=False),
        sa.Column('is_connected', sa.Boolean(), nullable=False),
        sa.Column('connected_since', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('session_id', 'user_id', name='uq_live_participant_session_user'),
    )
    op.create_index('ix_live_session_participant_user_id', 'live_session_participant', ['user_id'])

    op.create_table(
        'live_session_event',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('live_session.id', ondelete='CASCADE'), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('event_type', sa.String(length=40), nullable=False),
        sa.Column('participant_sid', sa.String(length=64), nullable=True),
        sa.Column('source', sa.String(length=16), nullable=False),
        sa.Column('external_id', sa.String(length=128), nullable=True),
        sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('external_id', name='live_session_event_external_id_key'),
    )
    op.create_index(
        'ix_live_event_session_user_type',
        'live_session_event',
        ['session_id', 'user_id', 'event_type'],
    )


def downgrade() -> None:
    op.drop_index('ix_live_event_session_user_type', table_name='live_session_event')
    op.drop_table('live_session_event')
    op.drop_index('ix_live_session_participant_user_id', table_name='live_session_participant')
    op.drop_table('live_session_participant')
    for name in (
        'ix_live_session_status',
        'ix_live_session_course_scheduled',
        'ix_live_session_instructor_id',
        'ix_live_session_activity_id',
        'ix_live_session_org_id',
        'ix_live_session_session_uuid',
    ):
        op.drop_index(name, table_name='live_session')
    op.drop_table('live_session')
    sa.Enum(name='live_participant_role').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='live_recording_status').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='live_session_status').drop(op.get_bind(), checkfirst=True)
