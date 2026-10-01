"""Cloudflare for SaaS: HTTPS certificates for organizations' own domains.

When an organization verifies ``learn.school.ac.ke``, the domain is registered
as a *custom hostname* on the platform's Cloudflare zone. Cloudflare then
issues and renews its certificate and proxies it to the same origin as
``{slug}.validbridge.co.ke``; the web proxy maps the Host to the organization.

Off unless configured (self-hosted installs terminate TLS some other way):

- ``VALIDBRIDGE_CLOUDFLARE_API_TOKEN`` — zone-scoped token with
  *SSL and Certificates: Edit* on the platform zone. Server-side only.
- ``VALIDBRIDGE_CLOUDFLARE_ZONE_ID`` — the platform zone's id.
- ``VALIDBRIDGE_CUSTOM_DOMAIN_CNAME_TARGET`` *(optional)* — what customers
  point their CNAME at (the zone's fallback origin, e.g.
  ``domains.validbridge.co.ke``). Defaults to the org's own subdomain.

Every call is best effort: a Cloudflare outage must never block verifying or
deleting a domain, so failures are logged and surfaced as a status instead.
"""

import logging
import os
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_API = "https://api.cloudflare.com/client/v4"
_TIMEOUT_SECONDS = 10.0

# Cloudflare SSL states that mean "on its way" rather than broken.
_PENDING_SSL = {
    "initializing",
    "pending_validation",
    "pending_issuance",
    "pending_deployment",
    "pending_cleanup",
    "backup_issued",
}


class CloudflareError(Exception):
    """A Cloudflare API call failed (network, auth or API error)."""


@dataclass(frozen=True)
class CloudflareSettings:
    api_token: str
    zone_id: str


@dataclass(frozen=True)
class HostnameStatus:
    """What the organization's Domains page needs to know."""

    status: str  # active | provisioning | failed | missing
    message: str
    ssl_status: Optional[str] = None


def get_settings() -> Optional[CloudflareSettings]:
    token = (os.getenv("VALIDBRIDGE_CLOUDFLARE_API_TOKEN") or "").strip()
    zone = (os.getenv("VALIDBRIDGE_CLOUDFLARE_ZONE_ID") or "").strip()
    if not token or not zone:
        return None
    return CloudflareSettings(api_token=token, zone_id=zone)


def cname_target() -> Optional[str]:
    value = (os.getenv("VALIDBRIDGE_CUSTOM_DOMAIN_CNAME_TARGET") or "").strip().rstrip(".")
    return value or None


async def _request(settings: CloudflareSettings, method: str, path: str, **kwargs) -> dict:
    url = f"{_API}/zones/{settings.zone_id}/custom_hostnames{path}"
    headers = {"Authorization": f"Bearer {settings.api_token}"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.request(method, url, headers=headers, **kwargs)
    except httpx.HTTPError as exc:
        raise CloudflareError(f"Cloudflare unreachable: {type(exc).__name__}") from exc
    try:
        body = resp.json()
    except ValueError:
        body = {}
    if resp.status_code >= 400 or not body.get("success", False):
        # Error messages never contain the token; keep them short for logs.
        errors = "; ".join(str(e.get("message", "")) for e in body.get("errors", []) if isinstance(e, dict))
        raise CloudflareError(f"Cloudflare {method} custom_hostnames failed ({resp.status_code}): {errors[:200]}")
    return body


async def find_hostname(settings: CloudflareSettings, hostname: str) -> Optional[dict]:
    body = await _request(settings, "GET", "", params={"hostname": hostname})
    for item in body.get("result") or []:
        if str(item.get("hostname", "")).lower() == hostname.lower():
            return item
    return None


async def register_hostname(settings: CloudflareSettings, hostname: str) -> dict:
    """Create the custom hostname (idempotent: returns the existing one)."""
    existing = await find_hostname(settings, hostname)
    if existing is not None:
        return existing
    body = await _request(
        settings,
        "POST",
        "",
        json={
            "hostname": hostname,
            # HTTP validation works as soon as the customer's CNAME points at
            # the zone, with no extra DNS record for them to add.
            "ssl": {"method": "http", "type": "dv", "settings": {"min_tls_version": "1.2"}},
        },
    )
    logger.info("Cloudflare custom hostname registered: %s", hostname)
    return body.get("result") or {}


async def remove_hostname(settings: CloudflareSettings, hostname: str) -> bool:
    existing = await find_hostname(settings, hostname)
    if existing is None:
        return False
    await _request(settings, "DELETE", f"/{existing['id']}")
    logger.info("Cloudflare custom hostname removed: %s", hostname)
    return True


def describe(item: Optional[dict]) -> HostnameStatus:
    if not item:
        return HostnameStatus("missing", "The certificate has not been requested yet.")
    ssl_status = str((item.get("ssl") or {}).get("status") or "")
    if ssl_status == "active":
        return HostnameStatus("active", "SSL certificate is active.", ssl_status)
    if ssl_status in _PENDING_SSL or not ssl_status:
        return HostnameStatus(
            "provisioning",
            "SSL certificate is being issued. This usually takes a few minutes once your CNAME record is in place.",
            ssl_status or None,
        )
    return HostnameStatus(
        "failed",
        "The SSL certificate could not be issued. Check that the CNAME record points to ValidBridge, then verify again.",
        ssl_status,
    )


async def ensure_hostname(hostname: str) -> Optional[HostnameStatus]:
    """Register ``hostname`` if needed and report its certificate state.

    Returns None when Cloudflare for SaaS is not configured.
    """
    settings = get_settings()
    if settings is None:
        return None
    try:
        return describe(await register_hostname(settings, hostname))
    except CloudflareError as exc:
        logger.warning("Cloudflare register failed for %s: %s", hostname, exc)
        return HostnameStatus("failed", "Could not request the SSL certificate right now. Try again in a few minutes.")


async def hostname_status(hostname: str) -> Optional[HostnameStatus]:
    """Current certificate state, registering the hostname if it is missing."""
    settings = get_settings()
    if settings is None:
        return None
    try:
        item = await find_hostname(settings, hostname)
        if item is None:
            item = await register_hostname(settings, hostname)
        return describe(item)
    except CloudflareError as exc:
        logger.warning("Cloudflare status failed for %s: %s", hostname, exc)
        return HostnameStatus("unknown", "Could not check the SSL certificate right now.")


async def release_hostname(hostname: str) -> None:
    settings = get_settings()
    if settings is None:
        return
    try:
        await remove_hostname(settings, hostname)
    except CloudflareError as exc:
        # The domain row is deleted regardless; an orphaned custom hostname
        # only costs a certificate slot and can be removed in the dashboard.
        logger.warning("Cloudflare remove failed for %s: %s", hostname, exc)
