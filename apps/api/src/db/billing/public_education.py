"""Public Education verification applications (W7)."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlmodel import Field, SQLModel

from src.db.billing._common import utcnow

PUBLIC_ED_STATUSES = ("pending", "approved", "rejected", "expired")


class PublicEdApplication(SQLModel, table=True):
    __tablename__ = "public_ed_application"
    __table_args__ = (Index("ix_public_ed_application_org_status", "org_id", "status"),)

    id: int | None = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    institution: str = Field(sa_column=Column(String(255), nullable=False))
    type: str = Field(sa_column=Column(String(64), nullable=False))
    reg_number: str | None = Field(
        default=None, sa_column=Column(String(128), nullable=True)
    )
    email_domain: str | None = Field(
        default=None, sa_column=Column(String(255), nullable=True)
    )
    # Storage key under a PRIVATE prefix; never served publicly.
    document_key: str | None = Field(
        default=None, sa_column=Column(String(500), nullable=True)
    )
    status: str = Field(
        default="pending",
        sa_column=Column(String(16), nullable=False, server_default="pending"),
    )
    review_note: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    reviewed_by: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
        ),
    )
    reviewed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    expires_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    agreement_version: str | None = Field(
        default=None, sa_column=Column(String(32), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
