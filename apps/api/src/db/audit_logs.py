from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    """Timezone-aware UTC now. Audit rows need a real timestamp."""
    return datetime.now(UTC)


class AuditLog(SQLModel, table=True):
    """Org-wide request audit log (the ``/ee/audit_logs`` viewer's source).

    One append-only row per audited HTTP request, written by the audit
    middleware (``src/core/middleware/audit_log.py``). Rows are never updated or
    deleted in normal operation; writers are best-effort and must never block or
    fail the request they describe.

    Backward-compatible with the original platform's ``auditlog`` table (see the
    committed Alembic migrations ``v1w2x3y4z5a6`` / ``d3e4f5a6b7c8``): same
    name, ``org_id`` / ``user_id`` both ``ON DELETE SET NULL``, and the
    ``ix_auditlog_org_id`` index those migrations already create.
    """

    __tablename__ = "auditlog"
    __table_args__ = (
        Index("ix_auditlog_org_id", "org_id"),
        Index("ix_auditlog_org_user_id", "org_id", "user_id"),
        Index("ix_auditlog_org_created", "org_id", "created_at"),
        Index("ix_auditlog_org_status", "org_id", "status_code"),
    )

    id: int | None = Field(default=None, primary_key=True)

    # Nullable: platform-level or anonymous requests carry no org. Derived
    # best-effort from the request (query string / path), never authoritative.
    # SET NULL keeps the request row after its org is deleted — audit history
    # must survive its subject.
    org_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("organization.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Nullable: anonymous requests have no actor. SET NULL keeps the request row
    # after a user is deleted while pointing at nothing.
    user_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("user.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Denormalized snapshot resolved by the writer — survives renames and
    # deletions, keeps CSV exports self-contained.
    username: str | None = Field(
        default=None, sa_column=Column(String(64), nullable=True)
    )

    method: str = Field(sa_column=Column(String(10), nullable=False))
    path: str | None = Field(
        default=None, sa_column=Column(String(512), nullable=True)
    )
    # Derived stable label, e.g. "course.create"; fallback "POST /path".
    action: str | None = Field(
        default=None, sa_column=Column(String(256), nullable=True)
    )
    # Canonical category: user / course / org / other (UI filter values).
    resource: str | None = Field(
        default=None, sa_column=Column(String(32), nullable=True)
    )
    resource_id: str | None = Field(
        default=None, sa_column=Column(String(128), nullable=True)
    )

    ip_address: str | None = Field(
        default=None, sa_column=Column(String(64), nullable=True)
    )
    user_agent: str | None = Field(
        default=None, sa_column=Column(Text, nullable=True)
    )
    status_code: int | None = Field(
        default=None, sa_column=Column(Integer, nullable=True)
    )

    # Redacted request-body snapshot (JSON mutating requests only).
    payload: dict | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )

    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )