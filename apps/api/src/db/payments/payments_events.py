from typing import Optional
from datetime import datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class PaymentsEvent(SQLModel, table=True):
    """Ledger of processed provider webhook events (idempotency).

    ``event_id`` is unique; the webhook handler inserts-first and treats a
    conflict as "already processed". Enrollment creation happens in the same
    transaction so a crash cannot record an event as processed without also
    granting access (and vice-versa).
    """

    __tablename__ = "payments_events"

    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: str = Field(unique=True, index=True)
    event_type: str
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))
    processed_at: datetime = Field(default_factory=datetime.now)
