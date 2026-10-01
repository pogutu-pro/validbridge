"""Shared column helpers for the billing models."""

from datetime import UTC, datetime

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

# JSONB on Postgres, plain JSON elsewhere (the test suite runs on SQLite).
JSONVariant = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(UTC)


def current_period(now: datetime | None = None) -> str:
    """Billing/usage period key ``YYYY-MM`` (UTC)."""
    now = now or utcnow()
    return f"{now.year:04d}-{now.month:02d}"
