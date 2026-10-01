"""Platform-level suspension of an organization (superadmin action).

A row means the org is suspended: members lose access, nothing is deleted,
and removing the row restores everything. Its own table so deployments that
build the schema with ``create_all`` get it without a migration step.
"""

from datetime import UTC, datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, Text
from sqlmodel import Field, SQLModel


class OrgSuspension(SQLModel, table=True):
    __tablename__ = "org_suspension"

    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            primary_key=True,
            autoincrement=False,
        )
    )
    reason: str = Field(sa_column=Column(Text, nullable=False))
    # Shown to the org's members while suspended (optional).
    message: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    suspended_by: int | None = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    suspended_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
