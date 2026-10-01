"""Live quizzes, timed polls and lecturer answers to questions

Revision ID: n3q4u5i6z7a8
Revises: m2c3l4a5s6r7
Create Date: 2026-09-23 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'n3q4u5i6z7a8'
down_revision: Union[str, None] = 'm2c3l4a5s6r7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('live_session_message', sa.Column('answer_body', sa.Text(), nullable=True))
    op.add_column(
        'live_session_message',
        sa.Column('answered_by_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
    )
    op.add_column('live_poll', sa.Column('duration_seconds', sa.Integer(), nullable=True))
    op.add_column('live_poll', sa.Column('closes_at', sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        'live_quiz',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('quiz_uuid', sa.String(length=64), nullable=False),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('live_session.id', ondelete='CASCADE'), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('source_type', sa.String(length=32), nullable=False),
        sa.Column('source_ref', sa.String(length=200), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('questions', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('grading_mode', sa.String(length=32), nullable=False),
        sa.Column('seconds_per_question', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('current_index', sa.Integer(), nullable=False),
        sa.Column('question_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('question_deadline', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_live_quiz_quiz_uuid', 'live_quiz', ['quiz_uuid'], unique=True)
    op.create_index('ix_live_quiz_session_created', 'live_quiz', ['session_id', 'created_at'])

    op.create_table(
        'live_quiz_answer',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('quiz_id', sa.Integer(), sa.ForeignKey('live_quiz.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('question_index', sa.Integer(), nullable=False),
        sa.Column('selected', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('score', sa.Float(), nullable=False),
        sa.Column('is_correct', sa.Boolean(), nullable=False),
        sa.Column('answered_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('quiz_id', 'user_id', 'question_index', name='uq_live_quiz_answer'),
    )
    op.create_index('ix_live_quiz_answer_user_id', 'live_quiz_answer', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_live_quiz_answer_user_id', table_name='live_quiz_answer')
    op.drop_table('live_quiz_answer')
    op.drop_index('ix_live_quiz_session_created', table_name='live_quiz')
    op.drop_index('ix_live_quiz_quiz_uuid', table_name='live_quiz')
    op.drop_table('live_quiz')
    op.drop_column('live_poll', 'closes_at')
    op.drop_column('live_poll', 'duration_seconds')
    op.drop_column('live_session_message', 'answered_by_id')
    op.drop_column('live_session_message', 'answer_body')
