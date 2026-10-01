"""SSO account reconciliation + auto-provisioning.

Pure-ish helpers, heavily unit-tested, plus the provisioning step that reuses
``services.users.users.create_user`` (OAuth path) so every security gate —
RBAC, conflict checks, usage limits, welcome email, audit/analytics — applies to
SSO-provisioned accounts exactly as it does to Google/email signups.
"""

from __future__ import annotations

import logging

from fastapi import Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.sso import SSOConfig
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, User
from src.services.sso.providers.base import Identity

logger = logging.getLogger(__name__)


async def resolve_org_by_slug(
    db_session: AsyncSession, org_slug: str | None
) -> Organization | None:
    if not org_slug:
        return None
    return (
        await db_session.execute(
            select(Organization).where(Organization.slug == org_slug)
        )
    ).scalars().first()


def normalize_domain(domain: str) -> str:
    """Lowercase and strip a leading ``@`` and ``www.`` prefix."""
    d = (domain or "").strip().lower()
    d = d.removeprefix("@")
    d = d.removeprefix("www.")
    return d


def email_domain_allowed(email: str, domains: list[str]) -> bool:
    if not domains:
        return False
    email = (email or "").strip().lower()
    if "@" not in email:
        return False
    domain = email.rsplit("@", 1)[1]
    return domain in {normalize_domain(d) for d in domains}


async def find_user_in_org(
    db_session: AsyncSession, email: str, org_id: int
) -> User | None:
    statement = (
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .where(User.email == email, UserOrganization.org_id == org_id)
    )
    return (await db_session.execute(statement)).scalars().first()


async def resolve_default_role_id(
    db_session: AsyncSession, org_id: int, config: SSOConfig
) -> int | None:
    """Return the role id to assign a provisioned user: ``config.default_role_id``
    when it is a real role belonging to ``org_id``, else None (caller falls back
    to ``create_user``'s built-in default member role)."""
    candidate = config.default_role_id
    if candidate is None:
        return None
    from src.db.roles import Role

    role = (
        await db_session.execute(
            select(Role).where(Role.id == candidate, Role.org_id == org_id)
        )
    ).scalars().first()
    if role is None:
        return None
    return candidate


async def find_or_provision_user(
    *,
    identity: Identity,
    org: Organization,
    config: SSOConfig,
    request: Request,
    db_session: AsyncSession,
) -> tuple[User, bool]:
    """Return ``(user, created)`` for ``identity``.

    * existing user in the org → matched (created=False);
    * unknown user + ``auto_provision_users`` → created via the OAuth user path
      (created=True);
    * unknown user + provisioning off → raises ``SSOProvisionError`` with code
      ``auto_provision_disabled``.

    ``created`` lets the caller record an audit event for the auto-provision.
    """
    existing = await find_user_in_org(db_session, identity.email, org.id)
    if existing is not None:
        return existing, False

    if not config.auto_provision_users:
        raise SSOProvisionError("auto_provision_disabled", "Auto-provisioning is disabled for this organization")

    from src.db.users import UserCreate
    from src.services.users.users import create_user

    username = identity.email.split("@", 1)[0]
    name_parts = (identity.name or "").split(" ", 1)
    first_name = name_parts[0] if name_parts else ""
    last_name = name_parts[1] if len(name_parts) > 1 else ""

    user_object = UserCreate(
        username=username,
        first_name=first_name,
        last_name=last_name,
        email=identity.email,
        password="",
    )

    try:
        await create_user(
            request,
            db_session,
            AnonymousUser(),
            user_object,
            org.id,
            is_oauth=True,
            signup_provider=identity.provider,
        )
    except SSOProvisionError:
        raise
    except Exception as exc:
        logger.exception("SSO auto-provision failed for %s in org %s", identity.email, org.id)
        raise SSOProvisionError("user_creation_failed", "Failed to create user account") from exc

    user = await find_user_in_org(db_session, identity.email, org.id)
    if user is None:
        raise SSOProvisionError("user_creation_failed", "Failed to create user account")

    # Respect a configured default role for the provisioned membership.
    role_id = await resolve_default_role_id(db_session, org.id, config)
    if role_id is not None:
        uo = (
            await db_session.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == user.id,
                    UserOrganization.org_id == org.id,
                )
            )
        ).scalars().first()
        if uo is not None:
            uo.role_id = role_id
            db_session.add(uo)
            await db_session.commit()

    return user, True


class SSOProvisionError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message
