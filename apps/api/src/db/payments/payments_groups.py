from typing import Optional
from datetime import datetime

from sqlalchemy import BigInteger, Column, ForeignKey
from sqlmodel import Field, SQLModel


class PaymentsGroup(SQLModel, table=True):
    """A named bundle of resources an org can sell via an offer.

    ``usergroup_id`` links the group to its sync target: a usergroup that
    mirrors the group's buyers and resources so paid members get access through
    the platform's standard usergroup machinery (see services/payments/group_sync.py).
    """

    __tablename__ = "payments_groups"

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    name: str
    description: Optional[str] = None
    usergroup_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("usergroup.id", ondelete="SET NULL")),
    )
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsGroupResource(SQLModel, table=True):
    """Links a resource (course, podcast, …) to a payments group."""

    __tablename__ = "payments_group_resources"

    id: Optional[int] = Field(default=None, primary_key=True)
    payments_group_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("payments_groups.id", ondelete="CASCADE"), index=True)
    )
    resource_uuid: str
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsOfferResource(SQLModel, table=True):
    """Links an individual resource directly to an offer (no group needed)."""

    __tablename__ = "payments_offer_resources"

    id: Optional[int] = Field(default=None, primary_key=True)
    offer_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("payments_offers.id", ondelete="CASCADE"), index=True)
    )
    resource_uuid: str
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsGroupRead(SQLModel):
    id: int
    org_id: int
    name: str
    description: Optional[str]
    usergroup_id: Optional[int] = None
