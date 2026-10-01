"""Organization suspension and superadmin deletion.

Suspending cuts members off (every membership check and loading the org
fail) while superadmins keep full access; unsuspending restores everything.

Deletion is irreversible, so it is gated several ways: the org must already
be suspended, the caller must be a signed-in superadmin session, a short-lived
confirmation token from a separate "prepare" step must match this org and
this superadmin, and the org's exact slug must be typed. The demo org and the
platform's default org can never be deleted.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.org_suspensions import OrgSuspension

logger = logging.getLogger(__name__)

CONFIRM_TTL_SECONDS = 10 * 60


async def get_suspension(org_id: int, db: AsyncSession) -> OrgSuspension | None:
    try:
        row = await db.get(OrgSuspension, org_id)
        return row if isinstance(row, OrgSuspension) else None
    except Exception:
        # Table missing on an un-migrated test DB etc.: fail open for reads.
        logger.debug("suspension lookup failed", exc_info=True)
        return None


async def is_org_suspended(org_id: int, db: AsyncSession) -> bool:
    return await get_suspension(org_id, db) is not None


def suspended_error(suspension: OrgSuspension) -> HTTPException:
    return HTTPException(
        status_code=423,
        detail={
            "error_code": "org_suspended",
            "message": suspension.message
            or "This organization is suspended. Please contact ValidBridge support.",
        },
    )


def _secret() -> bytes:
    from config.config import get_validbridge_config

    key = get_validbridge_config().security_config.auth_jwt_secret_key
    return f"org-delete:{key}".encode()


def make_delete_token(org_id: int, actor_id: int, now: float | None = None) -> str:
    """Token proving a superadmin asked to delete this org within the last
    10 minutes. Bound to the org and the superadmin."""
    expires = int((now or time.time()) + CONFIRM_TTL_SECONDS)
    payload = f"{org_id}:{actor_id}:{expires}"
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{expires}.{sig}"


def check_delete_token(token: str, org_id: int, actor_id: int, now: float | None = None) -> bool:
    try:
        expires_s, sig = token.split(".", 1)
        expires = int(expires_s)
    except (AttributeError, ValueError):
        return False
    if expires < (now or time.time()):
        return False
    payload = f"{org_id}:{actor_id}:{expires}"
    expected = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


async def assert_deletable(org, db: AsyncSession) -> None:
    """Refuse orgs that must never be deleted, and orgs not yet suspended."""
    if getattr(org, "is_demo", False):
        raise HTTPException(status_code=403, detail="The demo organization cannot be deleted.")
    from config.config import get_validbridge_config

    hosting = get_validbridge_config().hosting_config
    if hosting.tenancy == "single" or hosting.use_default_org:
        first = (
            await db.execute(select(type(org).id).order_by(type(org).id).limit(1))
        ).scalars().first()
        if first == org.id:
            raise HTTPException(
                status_code=403, detail="The platform's default organization cannot be deleted."
            )
    if not await is_org_suspended(org.id, db):
        raise HTTPException(
            status_code=409, detail="Suspend the organization before deleting it."
        )
