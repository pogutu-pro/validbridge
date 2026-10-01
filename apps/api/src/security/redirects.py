"""
Return-URL validation for flows that send the browser somewhere we name,
such as the page Paystack returns the payer to after checkout.

A return URL taken from the request is attacker-influenced. Handed to a
payment provider unchecked, it becomes an open redirect on the payment flow:
the payer finishes paying on the genuine Paystack page, then lands on a page
the attacker controls ("payment failed, re-enter your card"). So a return URL
must point at the platform itself, one of its org subdomains, or a verified
custom domain — the same origins the CSRF middleware accepts.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_validbridge_config


def _host_of(value: str) -> str:
    value = (value or "").strip()
    if "://" not in value:
        value = f"//{value}"
    return (urlparse(value).hostname or "").lower()


def _static_origin_allowed(scheme: str, host: str, port: int | None) -> bool:
    config = get_validbridge_config()
    hosting = config.hosting_config
    origin = f"{scheme}://{host}" + (f":{port}" if port else "")

    if origin in (hosting.allowed_origins or []):
        return True
    if hosting.allowed_regexp:
        try:
            if re.fullmatch(hosting.allowed_regexp, origin):
                return True
        except re.error:
            pass

    for configured in (hosting.frontend_domain, hosting.domain):
        base = _host_of(configured)
        if base and (host == base or host.endswith(f".{base}")):
            return True

    if config.general_config.development_mode and host in ("localhost", "127.0.0.1"):
        return True
    return False


async def _is_verified_custom_domain(host: str, db_session: AsyncSession) -> bool:
    try:
        from src.db.custom_domains import CustomDomain
    except ImportError:  # pragma: no cover - custom domains always ship
        return False
    row = (
        await db_session.execute(
            select(CustomDomain.id).where(
                CustomDomain.domain == host, CustomDomain.status == "verified"
            )
        )
    ).scalars().first()
    return row is not None


async def is_allowed_return_url(url: str | None, db_session: AsyncSession) -> bool:
    """True when ``url`` is an absolute http(s) URL on an origin we serve."""
    if not url or len(url) > 2048:
        return False
    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    if parsed.username or parsed.password:
        return False
    host = parsed.hostname.lower()
    if _static_origin_allowed(parsed.scheme, host, port):
        return True
    return await _is_verified_custom_domain(host, db_session)
