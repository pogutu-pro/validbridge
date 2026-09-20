"""SSO configuration model for orgs.

One ``sso_config`` row per ``(org_id, provider)`` pair. ``provider_config``
stores ONLY non-secret values (public endpoints, issuer, display overrides);
provider credentials live in ``config.yaml`` / environment variables and never
touch the database (see the SSO implementation plan §2.2).
"""

from datetime import UTC, datetime
from enum import Enum

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

SSO_PROVIDER_IDS = (
    "workos",
    "keycloak",
    "okta",
    "auth0",
    "custom_saml",
    "custom_oidc",
)


class SSOErrorCode(str, Enum):
    """Structured error codes returned to the frontend.

    The web client's ``getErrorMessage`` translates exactly these strings —
    never invent new codes. Status codes are applied at the router boundary.
    """

    SSO_NOT_ENABLED = "sso_not_enabled"
    DOMAIN_NOT_ALLOWED = "domain_not_allowed"
    EMAIL_DOMAIN_REJECTED = "email_domain_rejected"
    USER_CREATION_FAILED = "user_creation_failed"
    TOKEN_EXCHANGE_FAILED = "token_exchange_failed"
    INVALID_STATE = "invalid_state"
    MISSING_PARAMS = "missing_params"
    STATE_INVALID_OR_EXPIRED = "state_invalid_or_expired"
    AUTO_PROVISION_DISABLED = "auto_provision_disabled"
    SSO_MISCONFIGURED = "sso_misconfigured"
    CALLBACK_FAILED = "callback_failed"


def _utcnow() -> datetime:
    return datetime.now(UTC)


class SSOConfig(SQLModel, table=True):
    __tablename__ = "sso_config"
    __table_args__ = (
        UniqueConstraint("org_id", "provider", name="uq_sso_config_org_provider"),
    )

    id: int | None = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    provider: str = Field(sa_column=Column(String(32), nullable=False))
    enabled: bool = Field(default=False)
    # Email domains allowed for this SSO provider. Stored lowercased, without a
    # leading "@" or "www.".
    domains: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    auto_provision_users: bool = Field(default=False)
    # Fallback role for auto-provisioned users. Nullable: on role deletion the
    # row survives and provisioning falls back to the org's default role.
    default_role_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("role.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    provider_config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class SSOConfigRead(SQLModel):
    id: int
    org_id: int
    provider: str
    enabled: bool
    domains: list[str]
    auto_provision_users: bool
    default_role_id: int | None
    provider_config: dict
    created_at: datetime
    updated_at: datetime


class SSOConfigCreate(SQLModel):
    provider: str
    enabled: bool = False
    domains: list[str] = Field(default_factory=list)
    auto_provision_users: bool = False
    default_role_id: int | None = None
    provider_config: dict = Field(default_factory=dict)


class SSOConfigUpdate(SQLModel):
    provider: str | None = None
    enabled: bool | None = None
    domains: list[str] | None = None
    auto_provision_users: bool | None = None
    default_role_id: int | None = None
    provider_config: dict | None = None