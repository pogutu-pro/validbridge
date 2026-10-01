"""Billing foundation: price catalogue, wallet, usage metering tables

Creates every table from pricing-implementation.md §4.2 and seeds
``price_catalog`` version 1 from ``src/services/billing/catalog_defaults.py``
(the single source for the v1 numbers). Money columns are integer KES cents.

Revision ID: p1r2i3c4i5n6
Revises: o4r5e6c7o8r9
Create Date: 2026-09-25 09:00:00.000000

"""
import json
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'p1r2i3c4i5n6'
down_revision: str | None = 'o4r5e6c7o8r9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _org_fk(primary_key: bool = False) -> sa.Column:
    return sa.Column(
        'org_id', sa.BigInteger(),
        sa.ForeignKey('organization.id', ondelete='CASCADE'),
        nullable=False, primary_key=primary_key, autoincrement=False,
    )


def _user_fk(name: str) -> sa.Column:
    return sa.Column(
        name, sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True,
    )


def _ts(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    op.create_table(
        'price_catalog',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('version', sa.Integer(), nullable=False),
        _ts('effective_from'),
        sa.Column('items', postgresql.JSONB(), nullable=False),
        _user_fk('created_by'),
        _ts('created_at'),
        sa.UniqueConstraint('version', name='price_catalog_version_key'),
    )

    op.create_table(
        'billing_account',
        _org_fk(primary_key=True),
        sa.Column('billing_email', sa.String(length=320), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='active'),
        sa.Column('cycle', sa.String(length=16), nullable=False, server_default='monthly'),
        _ts('period_start', nullable=True),
        sa.Column('spending_limit_cents', sa.BigInteger(), nullable=True),
        sa.Column('auto_add_seats', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('paystack_customer_code', sa.String(length=64), nullable=True),
        sa.Column('exempt', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column(
            'enforcement_overrides', postgresql.JSONB(), nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        _ts('created_at'),
        _ts('updated_at'),
    )

    op.create_table(
        'payment_method',
        sa.Column('id', sa.Integer(), primary_key=True),
        _org_fk(),
        sa.Column('auth_code_enc', sa.Text(), nullable=False),
        sa.Column('signature', sa.String(length=128), nullable=False),
        sa.Column('brand', sa.String(length=32), nullable=True),
        sa.Column('last4', sa.String(length=4), nullable=True),
        sa.Column('exp_month', sa.Integer(), nullable=True),
        sa.Column('exp_year', sa.Integer(), nullable=True),
        sa.Column('bank', sa.String(length=128), nullable=True),
        sa.Column('channel', sa.String(length=32), nullable=True),
        sa.Column('reusable', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        _user_fk('created_by'),
        _ts('created_at'),
        sa.UniqueConstraint('org_id', 'signature', name='uq_payment_method_org_signature'),
    )
    op.create_index('ix_payment_method_org_id', 'payment_method', ['org_id'])

    op.create_table(
        'ledger_entry',
        sa.Column('id', sa.Integer(), primary_key=True),
        _org_fk(),
        sa.Column('amount_cents', sa.BigInteger(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('ref_type', sa.String(length=32), nullable=True),
        sa.Column('ref_id', sa.String(length=128), nullable=True),
        sa.Column('balance_after_cents', sa.BigInteger(), nullable=False),
        _user_fk('actor_id'),
        _ts('created_at'),
    )
    op.create_index('ix_ledger_entry_org_created', 'ledger_entry', ['org_id', 'created_at'])

    op.create_table(
        'invoice',
        sa.Column('id', sa.Integer(), primary_key=True),
        _org_fk(),
        sa.Column('number', sa.String(length=32), nullable=False),
        sa.Column('period', sa.String(length=7), nullable=False),
        sa.Column('lines', postgresql.JSONB(), nullable=False),
        sa.Column('subtotal_cents', sa.BigInteger(), nullable=False),
        sa.Column('tax_cents', sa.BigInteger(), nullable=False),
        sa.Column('total_cents', sa.BigInteger(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('paid_via', sa.String(length=32), nullable=True),
        sa.Column('catalog_version', sa.Integer(), nullable=False),
        sa.Column('etims_ref', sa.String(length=128), nullable=True),
        _ts('created_at'),
        _ts('updated_at'),
        sa.UniqueConstraint('number', name='invoice_number_key'),
    )
    op.create_index('ix_invoice_org_period', 'invoice', ['org_id', 'period'])

    op.create_table(
        'payment_attempt',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('reference', sa.String(length=100), nullable=False),
        _org_fk(),
        sa.Column('purpose', sa.String(length=32), nullable=False),
        sa.Column('amount_cents', sa.BigInteger(), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False, server_default='KES'),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('paystack_status', sa.String(length=32), nullable=True),
        sa.Column('idempotency_key', sa.String(length=128), nullable=True),
        _user_fk('created_by'),
        sa.Column('raw_hash', sa.String(length=128), nullable=True),
        _ts('created_at'),
        _ts('updated_at'),
        sa.UniqueConstraint('reference', name='payment_attempt_reference_key'),
        sa.UniqueConstraint(
            'org_id', 'idempotency_key', name='uq_payment_attempt_org_idempotency'
        ),
    )
    op.create_index('ix_payment_attempt_org_id', 'payment_attempt', ['org_id'])
    op.create_index(
        'ix_payment_attempt_status_created', 'payment_attempt', ['status', 'created_at']
    )

    op.create_table(
        'paystack_event',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('event_id', sa.String(length=128), nullable=False),
        sa.Column('type', sa.String(length=64), nullable=False),
        sa.Column('reference', sa.String(length=100), nullable=True),
        _ts('received_at'),
        _ts('processed_at', nullable=True),
        sa.UniqueConstraint('event_id', name='paystack_event_event_id_key'),
    )
    op.create_index('ix_paystack_event_reference', 'paystack_event', ['reference'])

    op.create_table(
        'org_addon',
        sa.Column('id', sa.Integer(), primary_key=True),
        _org_fk(),
        sa.Column('addon', sa.String(length=32), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'),
        _ts('started_at'),
        _ts('ends_at', nullable=True),
    )
    op.create_index('ix_org_addon_org_addon', 'org_addon', ['org_id', 'addon'])

    op.create_table(
        'pack_balance',
        sa.Column('id', sa.Integer(), primary_key=True),
        _org_fk(),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('remaining', sa.BigInteger(), nullable=False, server_default='0'),
        _ts('updated_at'),
        sa.UniqueConstraint('org_id', 'kind', name='uq_pack_balance_org_kind'),
    )

    op.create_table(
        'usage_counter',
        sa.Column('id', sa.Integer(), primary_key=True),
        _org_fk(),
        sa.Column('metric', sa.String(length=32), nullable=False),
        sa.Column('period', sa.String(length=7), nullable=False),
        sa.Column('used', sa.BigInteger(), nullable=False, server_default='0'),
        _ts('updated_at'),
        sa.UniqueConstraint(
            'org_id', 'metric', 'period', name='uq_usage_counter_org_metric_period'
        ),
    )

    op.create_table(
        'storage_snapshot',
        sa.Column('id', sa.Integer(), primary_key=True),
        _org_fk(),
        sa.Column('bytes', sa.BigInteger(), nullable=False),
        _ts('measured_at'),
        sa.Column('source', sa.String(length=32), nullable=False, server_default='scan'),
    )
    op.create_index(
        'ix_storage_snapshot_org_measured', 'storage_snapshot', ['org_id', 'measured_at']
    )

    op.create_table(
        'public_ed_application',
        sa.Column('id', sa.Integer(), primary_key=True),
        _org_fk(),
        sa.Column('institution', sa.String(length=255), nullable=False),
        sa.Column('type', sa.String(length=64), nullable=False),
        sa.Column('reg_number', sa.String(length=128), nullable=True),
        sa.Column('email_domain', sa.String(length=255), nullable=True),
        sa.Column('document_key', sa.String(length=500), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='pending'),
        sa.Column('review_note', sa.Text(), nullable=True),
        _user_fk('reviewed_by'),
        _ts('reviewed_at', nullable=True),
        _ts('expires_at', nullable=True),
        sa.Column('agreement_version', sa.String(length=32), nullable=True),
        _ts('created_at'),
        _ts('updated_at'),
    )
    op.create_index(
        'ix_public_ed_application_org_status', 'public_ed_application', ['org_id', 'status']
    )

    op.create_table(
        'org_email_config',
        _org_fk(primary_key=True),
        sa.Column('provider', sa.String(length=16), nullable=False),
        sa.Column('secret_enc', sa.Text(), nullable=False),
        sa.Column('from_address', sa.String(length=320), nullable=True),
        _ts('verified_at', nullable=True),
        _ts('created_at'),
        _ts('updated_at'),
    )

    op.create_table(
        'enforcement_flag',
        sa.Column('metric', sa.String(length=32), primary_key=True),
        sa.Column('mode', sa.String(length=16), nullable=False, server_default='shadow'),
        _user_fk('updated_by'),
        _ts('updated_at'),
    )

    # Seed price catalogue v1 (single source: catalog_defaults.py).
    from src.services.billing.catalog_defaults import (
        CATALOG_VERSION,
        build_default_catalog,
    )

    now = datetime.now(UTC)
    op.get_bind().execute(
        sa.text(
            "INSERT INTO price_catalog (version, effective_from, items, created_at) "
            "VALUES (:version, :effective_from, CAST(:items AS JSONB), :created_at) "
            "ON CONFLICT (version) DO NOTHING"
        ),
        {
            "version": CATALOG_VERSION,
            "effective_from": now,
            "items": json.dumps(build_default_catalog()),
            "created_at": now,
        },
    )


def downgrade() -> None:
    op.drop_table('enforcement_flag')
    op.drop_table('org_email_config')
    op.drop_index('ix_public_ed_application_org_status', table_name='public_ed_application')
    op.drop_table('public_ed_application')
    op.drop_index('ix_storage_snapshot_org_measured', table_name='storage_snapshot')
    op.drop_table('storage_snapshot')
    op.drop_table('usage_counter')
    op.drop_table('pack_balance')
    op.drop_index('ix_org_addon_org_addon', table_name='org_addon')
    op.drop_table('org_addon')
    op.drop_index('ix_paystack_event_reference', table_name='paystack_event')
    op.drop_table('paystack_event')
    op.drop_index('ix_payment_attempt_status_created', table_name='payment_attempt')
    op.drop_index('ix_payment_attempt_org_id', table_name='payment_attempt')
    op.drop_table('payment_attempt')
    op.drop_index('ix_invoice_org_period', table_name='invoice')
    op.drop_table('invoice')
    op.drop_index('ix_ledger_entry_org_created', table_name='ledger_entry')
    op.drop_table('ledger_entry')
    op.drop_index('ix_payment_method_org_id', table_name='payment_method')
    op.drop_table('payment_method')
    op.drop_table('billing_account')
    op.drop_table('price_catalog')
