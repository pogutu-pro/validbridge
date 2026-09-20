"""Single-use SSO state token.

A browser round-trips through the identity provider carrying this opaque state,
so it must be unforgeable, short-lived, and single-use. We copy the
``magic_login`` pattern: a signed JWT with a random ``jti`` that is burned via a
Redis ``SETNX`` marker on consume. Payload carries the org slug, the requested
provider, the safe return URL, and any provider-specific artefacts (e.g. the
OIDC ``nonce``).
"""

from __future__ import annotations

import logging
import secrets
from datetime import timedelta
from typing import Any

from src.security.auth import create_access_token, decode_jwt

logger = logging.getLogger(__name__)

SSO_STATE_PURPOSE = "sso_state"
SSO_STATE_TTL = timedelta(minutes=10)


def _redis():  # pragma: no cover - thin import shim; patched out in tests
    try:
        from src.core.redis import get_redis_client

        return get_redis_client()
    except Exception:  # noqa: BLE001
        return None


def _burn_jti(jti: str) -> bool:
    r = _redis()
    if r is None:
        # Fail closed: without Redis we cannot guarantee single-use, so refuse.
        logger.error("SSO state: Redis unavailable, refusing to consume (fail closed)")
        return False
    try:
        ok = r.set(
            f"sso_state_used:{jti}",
            "1",
            nx=True,
            ex=int(SSO_STATE_TTL.total_seconds()) + 60,
        )
        return bool(ok)
    except Exception:
        logger.exception("SSO state: Redis error during single-use check")
        return False


def issue_state_token(
    *,
    org_slug: str,
    provider: str,
    return_url: str | None,
    state_extra: dict[str, Any] | None = None,
) -> str:
    payload: dict[str, Any] = {
        "sub": org_slug,
        "purpose": SSO_STATE_PURPOSE,
        "provider": provider,
        "jti": secrets.token_urlsafe(16),
    }
    if return_url:
        payload["return_url"] = return_url
    if state_extra:
        payload["extra"] = state_extra
    return create_access_token(data=payload, expires_delta=SSO_STATE_TTL)


def consume_state_token(token: str) -> dict[str, Any]:
    """Validate + burn a state token. Returns the decoded payload dict, or raises
    ``ValueError`` carrying one of the §8 error codes."""
    try:
        payload = decode_jwt(token)
    except Exception:  # noqa: BLE001 - decode_jwt swallows PyJWTError into None; any failure means invalid
        raise ValueError("state_invalid_or_expired") from None

    if not payload or payload.get("purpose") != SSO_STATE_PURPOSE:
        raise ValueError("invalid_state")

    jti = payload.get("jti")
    if not jti or not _burn_jti(jti):
        raise ValueError("state_invalid_or_expired")

    return payload
