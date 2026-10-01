"""Money records: append-only ledger, invoices, payment attempts, webhooks.

All amounts are integer KES cents.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from src.db.billing._common import JSONVariant, utcnow

LEDGER_KINDS = ("topup", "charge", "grant", "refund", "adjustment")
INVOICE_STATUSES = ("draft", "open", "paid", "void", "failed")


class LedgerEntry(SQLModel, table=True):
    """Append-only wallet ledger. Never updated or deleted; corrections are
    new entries. The wallet balance is derived from these rows."""

    __tablename__ = "ledger_entry"
    __table_args__ = (Index("ix_ledger_entry_org_created", "org_id", "created_at"),)

    id: int | None = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    amount_cents: int = Field(sa_column=Column(BigInteger, nullable=False))  # signed
    kind: str = Field(sa_column=Column(String(16), nullable=False))
    ref_type: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    ref_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    balance_after_cents: int = Field(sa_column=Column(BigInteger, nullable=False))
    actor_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
        ),
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Invoice(SQLModel, table=True):
    """Monthly (or one-off) invoice. ``lines`` snapshot unit prices and
    ``catalog_version`` records which catalogue priced it."""

    __tablename__ = "invoice"
    __table_args__ = (Index("ix_invoice_org_period", "org_id", "period"),)

    id: int | None = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    number: str = Field(sa_column=Column(String(32), nullable=False, unique=True))
    period: str = Field(sa_column=Column(String(7), nullable=False))  # YYYY-MM
    lines: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSONVariant, nullable=False)
    )
    subtotal_cents: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    tax_cents: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    total_cents: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    status: str = Field(default="draft", sa_column=Column(String(16), nullable=False))
    paid_via: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    catalog_version: int = Field(sa_column=Column(Integer, nullable=False))
    etims_ref: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class PaymentAttempt(SQLModel, table=True):
    """Every Paystack initialize or charge. ``reference`` is unique."""

    __tablename__ = "payment_attempt"
    __table_args__ = (
        UniqueConstraint(
            "org_id", "idempotency_key", name="uq_payment_attempt_org_idempotency"
        ),
        Index("ix_payment_attempt_status_created", "status", "created_at"),
    )

    id: int | None = Field(default=None, primary_key=True)
    reference: str = Field(sa_column=Column(String(100), nullable=False, unique=True))
    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    purpose: str = Field(sa_column=Column(String(32), nullable=False))
    amount_cents: int = Field(sa_column=Column(BigInteger, nullable=False))
    currency: str = Field(
        default="KES", sa_column=Column(String(3), nullable=False, server_default="KES")
    )
    status: str = Field(default="pending", sa_column=Column(String(16), nullable=False))
    paystack_status: str | None = Field(
        default=None, sa_column=Column(String(32), nullable=True)
    )
    # Client-supplied key for purchase requests; null for system charges.
    idempotency_key: str | None = Field(
        default=None, sa_column=Column(String(128), nullable=True)
    )
    created_by: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
        ),
    )
    raw_hash: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class PaystackEvent(SQLModel, table=True):
    """Webhook idempotency: one row per Paystack event id."""

    __tablename__ = "paystack_event"

    id: int | None = Field(default=None, primary_key=True)
    event_id: str = Field(sa_column=Column(String(128), nullable=False, unique=True))
    type: str = Field(sa_column=Column(String(64), nullable=False))
    reference: str | None = Field(
        default=None, sa_column=Column(String(100), nullable=True, index=True)
    )
    received_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    processed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
