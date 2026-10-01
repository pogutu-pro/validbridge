"""Paystack payments schema

Upgrades the pre-existing ``paymentsconfig`` table (created by the legacy
Stripe-era migration ``0314ec7791e1``) to the provider-neutral Paystack model,
and relies on ``SQLModel.metadata.create_all`` at startup to create the NEW
tables (payments_offers, payments_enrollments, payments_groups,
payments_group_resources, payments_offer_resources, payments_events) — the same
bootstrap path the rest of this build uses (see src/core/events/database.py).

Idempotent: every statement is guarded so it is a no-op on a database that was
already created fresh by ``create_all``.

Revision ID: a1p2a3y4s5t6
Revises: s8t9u0v1w2x3
Create Date: 2026-09-16
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'a1p2a3y4s5t6'
down_revision: Union[str, None] = 's8t9u0v1w2x3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add the Paystack / demo provider values to the legacy enum (which only
    # knew STRIPE). Guarded so a fresh create_all-created type is a no-op.
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paymentproviderenum') THEN
            ALTER TYPE paymentproviderenum ADD VALUE IF NOT EXISTS 'paystack';
            ALTER TYPE paymentproviderenum ADD VALUE IF NOT EXISTS 'custom';
          END IF;
        END $$;
        """
    )
    # Strip the Stripe-Connect-specific columns/type that the new model drops.
    op.execute("ALTER TABLE paymentsconfig DROP COLUMN IF EXISTS mode")
    op.execute("ALTER TABLE paymentsconfig DROP COLUMN IF EXISTS provider_specific_id")
    op.execute("DROP TYPE IF EXISTS paymentsmodeenum")
    # Soft-archive flag for offers: archiving must not cascade-delete paid
    # enrollment history (guarded for databases created fresh by create_all).
    op.execute(
        "ALTER TABLE IF EXISTS payments_offers "
        "ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE"
    )
    # Subscription cadence (Paystack plan interval) for subscription offers.
    op.execute(
        "ALTER TABLE IF EXISTS payments_offers "
        "ADD COLUMN IF NOT EXISTS interval VARCHAR"
    )
    # Subscription identity columns: renewal/disable webhooks carry only the
    # Paystack subscription_code, so it must be queryable on the enrollment.
    op.execute(
        "ALTER TABLE IF EXISTS payments_enrollments "
        "ADD COLUMN IF NOT EXISTS subscription_code VARCHAR"
    )
    op.execute(
        "ALTER TABLE IF EXISTS payments_enrollments "
        "ADD COLUMN IF NOT EXISTS email_token VARCHAR"
    )


def downgrade() -> None:
    # No data-safe downgrade; the legacy columns/type are intentionally gone.
    pass
