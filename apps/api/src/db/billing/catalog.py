"""Versioned price catalogue (superadmin-editable; invoices snapshot a version)."""

from datetime import datetime
from typing import Any

from sqlalchemy import Column, DateTime, ForeignKey, Integer
from sqlmodel import Field, SQLModel

from src.db.billing._common import JSONVariant, utcnow


class PriceCatalog(SQLModel, table=True):
    """One row per catalogue version. Never edited once effective.

    ``items`` holds the structured catalogue (see
    ``src/services/billing/catalog_defaults.build_default_catalog``): plans,
    packs, add-ons, storage overage and the yearly discount. All money values
    are integer KES cents.
    """

    __tablename__ = "price_catalog"

    id: int | None = Field(default=None, primary_key=True)
    version: int = Field(sa_column=Column(Integer, nullable=False, unique=True))
    effective_from: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    items: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSONVariant, nullable=False)
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
