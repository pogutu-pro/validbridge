"""Add-ons, pack balances, usage counters, storage snapshots, enforcement flags."""

from datetime import datetime

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

from src.db.billing._common import utcnow

ADDON_KINDS = ("live_unlimited", "managed_email", "remove_badge", "extra_seat", "sso")
PACK_KINDS = ("ai_credits", "live_seconds", "code_runs")


class OrgAddon(SQLModel, table=True):
    """A monthly add-on held by an org. Active while ``ends_at`` is null or in
    the future."""

    __tablename__ = "org_addon"
    __table_args__ = (Index("ix_org_addon_org_addon", "org_id", "addon"),)

    id: int | None = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    addon: str = Field(sa_column=Column(String(32), nullable=False))
    quantity: int = Field(
        default=1, sa_column=Column(Integer, nullable=False, server_default="1")
    )
    started_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    ends_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )


class PackBalance(SQLModel, table=True):
    """Purchased, non-expiring balance per pack kind."""

    __tablename__ = "pack_balance"
    __table_args__ = (UniqueConstraint("org_id", "kind", name="uq_pack_balance_org_kind"),)

    id: int | None = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    kind: str = Field(sa_column=Column(String(32), nullable=False))
    remaining: int = Field(
        default=0, sa_column=Column(BigInteger, nullable=False, server_default="0")
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class UsageCounter(SQLModel, table=True):
    """Monthly usage per metric. ``period`` is ``YYYY-MM`` (UTC)."""

    __tablename__ = "usage_counter"
    __table_args__ = (
        UniqueConstraint(
            "org_id", "metric", "period", name="uq_usage_counter_org_metric_period"
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    metric: str = Field(sa_column=Column(String(32), nullable=False))
    period: str = Field(sa_column=Column(String(7), nullable=False))
    used: int = Field(
        default=0, sa_column=Column(BigInteger, nullable=False, server_default="0")
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class StorageSnapshot(SQLModel, table=True):
    """Result of a storage scan (nightly truth for the storage meter)."""

    __tablename__ = "storage_snapshot"
    __table_args__ = (
        Index("ix_storage_snapshot_org_measured", "org_id", "measured_at"),
    )

    id: int | None = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    measured_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    source: str = Field(
        default="scan",
        sa_column=Column(String(32), nullable=False, server_default="scan"),
    )


class EnforcementFlag(SQLModel, table=True):
    """Global enforcement mode per metric (``off | shadow | enforce``).
    Per-org overrides live in ``billing_account.enforcement_overrides``."""

    __tablename__ = "enforcement_flag"

    metric: str = Field(sa_column=Column(String(32), primary_key=True))
    mode: str = Field(
        default="shadow",
        sa_column=Column(String(16), nullable=False, server_default="shadow"),
    )
    updated_by: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
        ),
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
