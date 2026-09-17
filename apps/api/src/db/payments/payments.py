from typing import Optional
from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, BigInteger, Column, ForeignKey
from sqlmodel import Field, SQLModel


class PaymentProviderEnum(str, Enum):
    """Supported payment providers.

    ``paystack`` is the single live provider. ``custom`` exists so the demo
    storefront can render without credentials (see demo/sync.py) and so an
    operator can stub a provider in development.
    """

    paystack = "paystack"
    custom = "custom"


class PaymentsConfig(SQLModel, table=True):
    """Per-organization payment provider configuration.

    One row per org. The org owns its own merchant credentials: for
    ``paystack`` these live in ``provider_config`` (the org admin's own keys —
    funds settle directly to that org's Paystack account). ``active`` is the
    single "connected & usable" flag the UI keys off.
    """

    __tablename__ = "paymentsconfig"

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    enabled: bool = Field(default=True)
    active: bool = Field(default=False)
    provider: PaymentProviderEnum = Field(default=PaymentProviderEnum.paystack)
    provider_config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsConfigRead(SQLModel):
    id: int
    org_id: int
    enabled: bool
    active: bool
    provider: str
    creation_date: datetime
    update_date: datetime
