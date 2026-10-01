"""
Audit rows for AI-assisted write actions (Phase 5).

Every executed write action leaves a record here, so an incident can be
traced back to the prompt that proposed it, the plan that was confirmed, and
the user who confirmed it.

The model is deliberately separate from ``AIGeneration`` (which records
artifacts like images and quizzes): an action audit row is a security record,
not a creative artifact, and needs different fields and retention.
"""

from enum import Enum
from typing import Optional

from sqlalchemy import JSON, Column, ForeignKey, Index, Text
from sqlmodel import Field, SQLModel


class AIActionStatus(str, Enum):
    """The lifecycle of a proposed AI action."""

    PROPOSED = "PROPOSED"
    CONFIRMED = "CONFIRMED"
    REJECTED = "REJECTED"
    FAILED = "FAILED"


class AIActionAuditBase(SQLModel):
    """Common fields for an AI action audit record."""

    # The action kind, e.g. "create_course". Namespaced so a single table can
    # hold every action type without a schema change per action.
    action: str
    # The prompt that led the model to propose this action.
    prompt: str = Field(default="", sa_column=Column(Text))
    # The fully-resolved plan the user confirmed: exact target, exact diff.
    plan: dict = Field(default_factory=dict, sa_column=Column(JSON))
    # The one-time confirmation token that was presented to the user.
    confirmation_token: str = Field(default="", index=True)
    status: AIActionStatus = AIActionStatus.PROPOSED
    # Set when the action executes: what actually happened.
    result: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    # Set when the action fails: the error message.
    error: Optional[str] = Field(default=None)


class AIActionAuditCreate(AIActionAuditBase):
    """Model for creating an AI action audit record."""

    org_id: int
    user_id: int


class AIActionAuditRead(AIActionAuditBase):
    """Model for reading an AI action audit record."""

    id: int
    ai_action_audit_uuid: str
    org_id: int
    user_id: int
    creation_date: Optional[str] = None
    update_date: Optional[str] = None


class AIActionAudit(AIActionAuditBase, table=True):
    """A durable record of an AI-proposed write action and its outcome."""

    __table_args__ = (
        Index("ix_aiactionaudit_org_id", "org_id"),
        Index("ix_aiactionaudit_user_id", "user_id"),
        Index("ix_aiactionaudit_action", "action"),
        Index("ix_aiactionaudit_status", "status"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    ai_action_audit_uuid: str = Field(default="", index=True)
    creation_date: Optional[str] = None
    update_date: Optional[str] = None

    org_id: int = Field(
        sa_column=Column("org_id", ForeignKey("organization.id", ondelete="CASCADE"))
    )
    user_id: int = Field(
        sa_column=Column("user_id", ForeignKey("user.id", ondelete="CASCADE"))
    )
