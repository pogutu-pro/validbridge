"""Add SSO config table

Revision ID: c0d1e2f3a4b5
Revises: b5c6d7e8f9a1
Create Date: 2026-09-18 12:00:00.000000

Chains onto the committed migration head (b1c2d3e4f5a6) so the graph keeps a
single head.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'c0d1e2f3a4b5'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'sso_config',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'org_id',
            sa.Integer(),
            sa.ForeignKey('organization.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('provider', sa.String(length=32), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        # Email domains allowed for SSO login; stored lowercased, no leading "@".
        sa.Column('domains', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column(
            'auto_provision_users', sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            'default_role_id',
            sa.Integer(),
            sa.ForeignKey('role.id', ondelete='SET NULL'),
            nullable=True,
        ),
        # Non-secret provider values only (secrets live in config/env).
        sa.Column('provider_config', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # One config per provider per org.
    op.create_unique_constraint(
        'uq_sso_config_org_provider', 'sso_config', ['org_id', 'provider']
    )
    op.create_index('ix_sso_config_org_id', 'sso_config', ['org_id'])


def downgrade() -> None:
    op.drop_index('ix_sso_config_org_id', table_name='sso_config')
    op.drop_constraint('uq_sso_config_org_provider', 'sso_config', type_='unique')
    op.drop_table('sso_config')