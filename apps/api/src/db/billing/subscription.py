"""Platform subscription state and purchase records.

Kept in their own tables rather than as new columns on ``billing_account`` /
``payment_attempt``: deployments build the schema with ``create_all``, which
creates new tables but never alters existing ones.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String
from sqlmodel import Field, SQLModel

from src.db.billing._common import JSONVariant, utcnow


class BillingSubscription(SQLModel, table=True):
    """The org's paid plan period.

    ``period_start``/``period_end`` bound the base plan already paid for.
    Monthly periods end on the 1st (the monthly bill date); yearly periods
    run twelve months. A downgrade is recorded as ``pending_plan`` and applied
    at ``period_end`` so nothing already paid for is taken away early.
    """

    __tablename__ = "billing_subscription"

    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            primary_key=True,
            autoincrement=False,
        )
    )
    plan: str = Field(sa_column=Column(String(32), nullable=False))
    cycle: str = Field(
        default="monthly",
        sa_column=Column(String(16), nullable=False, server_default="monthly"),
    )
    period_start: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    period_end: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    pending_plan: str | None = Field(
        default=None, sa_column=Column(String(32), nullable=True)
    )
    pending_cycle: str | None = Field(
        default=None, sa_column=Column(String(16), nullable=True)
    )
    # First moment the org was seen over its active-learner allowance; cleared
    # when it is back under. New learners are refused once the grace runs out.
    learner_grace_started_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    paused_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class BillingPurchase(SQLModel, table=True):
    """What a payment attempt is for, so the grant can be applied exactly as
    priced when the payment completes (by redirect, webhook or reconciler)."""

    __tablename__ = "billing_purchase"

    reference: str = Field(
        sa_column=Column(
            String(100),
            ForeignKey("payment_attempt.reference", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    # The priced item, e.g. {"type": "plan", "plan": "growth", "cycle": "monthly"}.
    item: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONVariant, nullable=False)
    )
    description: str = Field(sa_column=Column(String(255), nullable=False))
    # Period the charge covers (plan/add-on), for the grant to reuse. A plan
    # that starts a new period records its start: the payment may complete
    # minutes after the quote, but it paid for the period quoted.
    period_start: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    covers_until: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    # Paystack's hosted page, returned again for a retried checkout request.
    checkout_url: str | None = Field(
        default=None, sa_column=Column(String(512), nullable=True)
    )
    save_card: bool = Field(default=False)
    invoice_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("invoice.id", ondelete="SET NULL"), nullable=True, index=True
        ),
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
