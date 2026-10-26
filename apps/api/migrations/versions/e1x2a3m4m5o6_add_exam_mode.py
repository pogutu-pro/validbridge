"""Add exam mode: settings, per-student sessions, and the supervision event log

Revision ID: e1x2a3m4m5o6
Revises: c3d4e5f6a7b8
Create Date: 2026-10-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e1x2a3m4m5o6'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tz(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if 'exam_settings' not in tables:
        op.create_table(
            'exam_settings',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('assignment_id', sa.Integer(), sa.ForeignKey('assignment.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('duration_minutes', sa.Integer(), nullable=False, server_default='60'),
            _tz('opens_at'),
            _tz('closes_at'),
            sa.Column('require_camera', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('require_screen_share', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('require_fullscreen', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('watermark', sa.Boolean(), nullable=False, server_default='true'),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
            sa.UniqueConstraint('assignment_id', name='uq_exam_settings_assignment'),
        )
        op.create_index('ix_exam_settings_course_id', 'exam_settings', ['course_id'])

    if 'exam_session' not in tables:
        op.create_table(
            'exam_session',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('assignment_id', sa.Integer(), sa.ForeignKey('assignment.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('status', sa.String(16), nullable=False),
            _tz('started_at', nullable=False),
            _tz('deadline_at', nullable=False),
            _tz('submitted_at'),
            sa.Column('auto_submitted', sa.Boolean(), nullable=False, server_default='false'),
            _tz('last_seen_at'),
            sa.Column('camera_on', sa.Boolean(), nullable=True),
            sa.Column('screen_shared', sa.Boolean(), nullable=True),
            sa.Column('fullscreen', sa.Boolean(), nullable=True),
            sa.Column('violation_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('resume_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('active_client', sa.String(64), nullable=True),
            _tz('created_at', nullable=False),
            sa.UniqueConstraint('assignment_id', 'user_id', name='uq_exam_session_assignment_user'),
        )
        op.create_index('ix_exam_session_assignment', 'exam_session', ['assignment_id'])
        op.create_index('ix_exam_session_user_id', 'exam_session', ['user_id'])

    if 'exam_event' not in tables:
        op.create_table(
            'exam_event',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('session_id', sa.Integer(), sa.ForeignKey('exam_session.id', ondelete='CASCADE'), nullable=False),
            sa.Column('kind', sa.String(40), nullable=False),
            sa.Column('detail', sa.String(300), nullable=True),
            sa.Column('is_violation', sa.Boolean(), nullable=False, server_default='false'),
            _tz('created_at', nullable=False),
        )
        op.create_index('ix_exam_event_session', 'exam_event', ['session_id', 'id'])


def downgrade() -> None:
    op.drop_table('exam_event')
    op.drop_table('exam_session')
    op.drop_table('exam_settings')
