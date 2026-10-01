from typing import Optional
from datetime import datetime
from enum import Enum

from sqlalchemy import BigInteger, Column, Float, ForeignKey, String
from sqlmodel import Field, SQLModel


class OfferTypeEnum(str, Enum):
    subscription = "subscription"
    one_time = "one_time"


class OfferPriceTypeEnum(str, Enum):
    fixed_price = "fixed_price"
    customer_choice = "customer_choice"


class SubscriptionIntervalEnum(str, Enum):
    """Billing cadence for subscription offers (Paystack plan intervals)."""

    monthly = "monthly"
    yearly = "yearly"


class PaymentsOffer(SQLModel, table=True):
    """A sellable offer (course or bundle) owned by an organization.

    Provider-neutral: ``provider_product_id`` holds the provider's plan code
    (Paystack plan code for subscriptions; unused in the one-time-only v1).
    ``payments_group_id`` links the offer to a bundle; individual resources are
    linked via ``PaymentsOfferResource``.
    """

    __tablename__ = "payments_offers"

    id: Optional[int] = Field(default=None, primary_key=True)
    offer_uuid: str = Field(unique=True, index=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    payments_config_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("paymentsconfig.id", ondelete="CASCADE")),
    )
    payments_group_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("payments_groups.id", ondelete="SET NULL")),
    )
    name: str
    description: Optional[str] = None
    offer_type: OfferTypeEnum = Field(default=OfferTypeEnum.one_time)
    price_type: OfferPriceTypeEnum = Field(default=OfferPriceTypeEnum.fixed_price)
    interval: Optional[SubscriptionIntervalEnum] = Field(
        default=None, sa_column=Column(String, nullable=True)
    )
    amount: float = Field(sa_column=Column(Float, nullable=False, default=0.0))
    currency: str = Field(default="KES")
    benefits: Optional[str] = None
    is_publicly_listed: bool = Field(default=False)
    is_archived: bool = Field(default=False)
    external_checkout_url: Optional[str] = None
    provider_product_id: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsOfferRead(SQLModel):
    id: int
    offer_uuid: str
    org_id: int
    name: str
    description: Optional[str]
    offer_type: str
    price_type: str
    interval: Optional[str]
    amount: float
    currency: str
    benefits: Optional[str]
    is_publicly_listed: bool
    payments_group_id: Optional[int]
