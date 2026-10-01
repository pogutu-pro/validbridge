"""Per-org billing account, saved payment methods and bring-your-own email."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlmodel import Field, SQLModel

from src.db.billing._common import JSONVariant, utcnow

BILLING_STATUSES = ("active", "past_due", "paused")
BILLING_CYCLES = ("monthly", "yearly")


class BillingAccount(SQLModel, table=True):
    """One per org. ``exempt`` = never billed or limited (demo, comped)."""

    __tablename__ = "billing_account"

    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            primary_key=True,
            autoincrement=False,
        )
    )
    billing_email: str | None = Field(
        default=None, sa_column=Column(String(320), nullable=True)
    )
    status: str = Field(
        default="active",
        sa_column=Column(String(16), nullable=False, server_default="active"),
    )
    cycle: str = Field(
        default="monthly",
        sa_column=Column(String(16), nullable=False, server_default="monthly"),
    )
    period_start: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    # None = no school-set spending limit.
    spending_limit_cents: int | None = Field(
        default=None, sa_column=Column(BigInteger, nullable=True)
    )
    auto_add_seats: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    paystack_customer_code: str | None = Field(
        default=None, sa_column=Column(String(64), nullable=True)
    )
    exempt: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    # Per-org enforcement mode per metric, e.g. {"storage": "enforce"}.
    # Overrides the global enforcement_flag row for this org only.
    enforcement_overrides: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONVariant, nullable=False, server_default=text("'{}'")),
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class PaymentMethod(SQLModel, table=True):
    """A reusable Paystack card authorization. Card numbers are never stored:
    only the encrypted ``authorization_code`` plus display metadata."""

    __tablename__ = "payment_method"
    __table_args__ = (
        UniqueConstraint("org_id", "signature", name="uq_payment_method_org_signature"),
    )

    id: int | None = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    auth_code_enc: str = Field(sa_column=Column(Text, nullable=False))
    signature: str = Field(sa_column=Column(String(128), nullable=False))
    brand: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    last4: str | None = Field(default=None, sa_column=Column(String(4), nullable=True))
    exp_month: int | None = Field(default=None, sa_column=Column(Integer, nullable=True))
    exp_year: int | None = Field(default=None, sa_column=Column(Integer, nullable=True))
    bank: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    channel: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    reusable: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, server_default=text("true")),
    )
    is_default: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    created_by: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
        ),
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class OrgEmailConfig(SQLModel, table=True):
    """Bring-your-own email provider for engagement mail (W6)."""

    __tablename__ = "org_email_config"

    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            primary_key=True,
            autoincrement=False,
        )
    )
    provider: str = Field(sa_column=Column(String(16), nullable=False))  # resend | smtp
    secret_enc: str = Field(sa_column=Column(Text, nullable=False))
    from_address: str | None = Field(
        default=None, sa_column=Column(String(320), nullable=True)
    )
    verified_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
