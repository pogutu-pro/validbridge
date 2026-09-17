from typing import Optional
from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, BigInteger, Column, ForeignKey, String
from sqlmodel import Field, SQLModel


class EnrollmentStatusEnum(str, Enum):
    pending = "pending"
    completed = "completed"
    active = "active"
    cancelled = "cancelled"
    failed = "failed"
    refunded = "refunded"


class PaymentsEnrollment(SQLModel, table=True):
    """A user's paid access to an offer.

    ``provider_specific_data`` holds the provider's transaction/subscription
    reference (e.g. Paystack ``reference`` + ``authorization_code``). Idempotency
    for webhook-driven grants is enforced via the ``payments_events`` ledger
    (unique event_id) plus a service-level existing-enrollment guard, so a
    duplicate webhook never double-grants.
    """

    __tablename__ = "payments_enrollments"

    id: Optional[int] = Field(default=None, primary_key=True)
    enrollment_uuid: str = Field(unique=True, index=True)
    offer_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("payments_offers.id", ondelete="CASCADE"), index=True)
    )
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("user.id", ondelete="CASCADE"), index=True)
    )
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    status: EnrollmentStatusEnum = Field(default=EnrollmentStatusEnum.pending)
    subscription_code: Optional[str] = Field(
        default=None, sa_column=Column(String, nullable=True, index=True)
    )
    email_token: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    provider_specific_data: dict = Field(default_factory=dict, sa_column=Column(JSON))
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsEnrollmentRead(SQLModel):
    enrollment_id: int
    enrollment_uuid: str
    offer_id: int
    user_id: int
    org_id: int
    status: str
    creation_date: datetime
    update_date: datetime
