"""Generic OpenID Connect (OIDC) SSO provider adapter.

Follows the standard authorization-code flow:

1. ``build_authorization_url`` — optionally run OIDC discovery (https only)
   against ``issuer``, then build the authorization URL with a ``nonce``
   stashed in the single-use state token.
2. ``exchange_code`` — POST the code to the token endpoint, verify the
   ``id_token`` signature (``iss``/``aud``/``nonce``) against the provider's
   JWKS, then fetch ``userinfo``.

Credentials come from platform config (``VALIDBRIDGE_OIDC_*``). The
DB-backed ``SSOConfig.provider_config`` may override the *public* endpoints and
issuer (discovery values are public by definition); the client secret never
comes from the DB.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
import jwt as pyjwt
from fastapi import Request

from src.db.sso import SSOConfig
from src.security.secret_crypto import resolve_secret
from src.services.sso.providers.base import (
    ConfigField,
    Identity,
    ProviderInfo,
    SSOProviderAdapter,
)

logger = logging.getLogger(__name__)

_SCOPES = "openid email profile"


def _oidc_config():
    from config.config import get_validbridge_config

    return get_validbridge_config().sso.oidc


def _is_local(host: str) -> bool:
    return host in ("localhost", "127.0.0.1", "::1") or host.startswith("127.")


def _assert_https_or_local(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http" and _is_local(parsed.hostname or ""):
        return
    raise ValueError(f"SSO endpoint must be https (or localhost for tests): {url}")


class OIDCAdapter(SSOProviderAdapter):
    provider_id = "custom_oidc"

    def __init__(self, transport: Any | None = None):
        # Injectable HTTP transport so tests can point the adapter at a fake
        # IdP without a live socket (``httpx.MockTransport``).
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=10, transport=self._transport)

    def _resolve_client(
        self, provider_config: dict[str, Any] | None = None
    ) -> tuple[str, str, str]:
        """(client_id, client_secret, scopes), org-first then platform.

        An org may bring its own OIDC application (BYOK); its credentials take
        precedence over the platform ``VALIDBRIDGE_OIDC_*`` fallback.
        """
        platform = _oidc_config()
        pc = provider_config or {}
        client_id = pc.get("client_id") or platform.client_id or ""
        client_secret = resolve_secret(pc.get("client_secret")) or platform.client_secret or ""
        scopes = (pc.get("scopes") or "").strip() or _SCOPES
        return client_id, client_secret, scopes

    def available(self, provider_config: dict[str, Any] | None = None) -> bool:
        client_id, client_secret, _ = self._resolve_client(provider_config)
        return bool(client_id and client_secret)

    def provider_info(self) -> ProviderInfo:
        return ProviderInfo(
            id="custom_oidc",
            name="Custom OIDC",
            description=(
                "Connect any OpenID Connect provider (Keycloak, Okta, Auth0, "
                "Authentik, …) using your own client credentials."
            ),
            has_setup_portal=False,
            # BYOK: selectable even when the platform has no OIDC client — the
            # organization supplies its own.
            available=True,
            config_fields=[
                ConfigField(
                    name="issuer_url",
                    type="string",
                    required=False,
                    description="OIDC issuer URL (enables automatic discovery).",
                ),
                ConfigField(
                    name="client_id",
                    type="string",
                    required=True,
                    description="Client ID from your OIDC provider.",
                ),
                ConfigField(
                    name="client_secret",
                    type="string",
                    required=True,
                    description="Client secret from your OIDC provider.",
                    hidden=True,
                ),
                ConfigField(
                    name="scopes",
                    type="string",
                    required=False,
                    description="Space-separated scopes (default: openid email profile).",
                ),
            ],
        )

    # -- endpoint resolution -------------------------------------------------

    def _endpoint(
        self,
        config: SSOConfig,
        key: str,
        discovered: dict[str, Any] | None,
        platform_value: str | None,
    ) -> str:
        pc = config.provider_config or {}
        return pc.get(key) or (discovered or {}).get(key) or platform_value or ""

    async def _discover(self, issuer: str) -> dict[str, Any] | None:
        if not issuer:
            return None
        _assert_https_or_local(issuer)
        url = issuer.rstrip("/") + "/.well-known/openid-configuration"
        try:
            async with self._client() as client:
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning("OIDC discovery failed for %s: %s", issuer, exc)
            return None

    async def _resolve(
        self, config: SSOConfig
    ) -> tuple[str, str, str, str, str]:
        """Return (authorization_endpoint, token_endpoint, userinfo_endpoint,
        issuer, jwks_uri)."""
        cfg = _oidc_config()
        pc = config.provider_config or {}
        issuer = pc.get("issuer_url") or pc.get("issuer") or cfg.issuer or ""
        discovered = await self._discover(issuer)

        authz = self._endpoint(config, "authorization_endpoint", discovered, cfg.authorization_endpoint)
        token = self._endpoint(config, "token_endpoint", discovered, cfg.token_endpoint)
        userinfo = self._endpoint(config, "userinfo_endpoint", discovered, cfg.userinfo_endpoint)
        jwks_uri = (discovered or {}).get("jwks_uri") or (issuer.rstrip("/") + "/.well-known/jwks.json" if issuer else "")
        if not token:
            raise ValueError("OIDC token_endpoint could not be resolved")
        if not authz:
            raise ValueError("OIDC authorization_endpoint could not be resolved")
        return authz, token, userinfo, issuer, jwks_uri

    # -- flow ----------------------------------------------------------------

    async def build_authorization_url(
        self,
        *,
        redirect_uri: str,
        state: str,
        config: SSOConfig,
        request: Request,
    ) -> tuple[str, dict[str, Any]]:
        client_id, _client_secret, scopes = self._resolve_client(config.provider_config)
        authz, _token, _userinfo, _issuer, _jwks = await self._resolve(config)
        nonce = secrets.token_urlsafe(16)
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scopes,
            "state": state,
            "nonce": nonce,
        }
        sep = "&" if "?" in authz else "?"
        url = f"{authz}{sep}{urlencode(params)}"
        # Carry the redirect_uri into the state so the token exchange uses the
        # exact value sent in the authorization request (they must match).
        return url, {"nonce": nonce, "redirect_uri": redirect_uri}

    async def exchange_code(
        self,
        *,
        code: str,
        state_extra: dict[str, Any],
        config: SSOConfig,
        request: Request,
    ) -> Identity:
        cfg = _oidc_config()
        client_id, client_secret, _scopes = self._resolve_client(config.provider_config)
        _authz, token, userinfo, issuer, jwks_uri = await self._resolve(config)
        redirect_uri = (state_extra or {}).get("redirect_uri") or cfg.redirect_uri or ""

        # Token exchange
        try:
            async with self._client() as client:
                resp = await client.post(
                    token,
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "redirect_uri": redirect_uri,
                        "client_id": client_id,
                        "client_secret": client_secret,
                    },
                )
                resp.raise_for_status()
                token_data = resp.json()
        except Exception as exc:
            logger.warning("OIDC token exchange failed: %s", exc)
            raise ValueError("token exchange failed") from exc

        id_token = token_data.get("id_token")
        access_token = token_data.get("access_token")
        if not access_token:
            raise ValueError("no access_token in OIDC token response")

        email = ""
        verified = False
        name = ""

        # Verify id_token (iss / aud / nonce) when present.
        if id_token:
            claims = await self._verify_id_token(
                id_token,
                issuer=issuer,
                audience=client_id,
                nonce=(state_extra or {}).get("nonce"),
                jwks_uri=jwks_uri,
            )
            email = (claims.get("email") or "").strip().lower()
            verified = bool(claims.get("email_verified", False))
            name = claims.get("name") or claims.get("preferred_username") or ""

        # Fill gaps via userinfo.
        if userinfo and access_token and (not email or not name):
            try:
                async with self._client() as client:
                    resp = await client.get(
                        userinfo,
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                    resp.raise_for_status()
                    info = resp.json()
                email = (info.get("email") or email).strip().lower()
                verified = verified or bool(info.get("email_verified", False))
                name = info.get("name") or info.get("preferred_username") or name
            except Exception as exc:  # noqa: BLE001
                logger.warning("OIDC userinfo fetch failed: %s", exc)

        if not email:
            raise ValueError("OIDC identity did not provide an email")

        return Identity(
            email=email,
            email_verified=verified,
            name=name or email,
            provider=self.provider_id,
            raw_id=claims.get("sub", "") if id_token else "",
        )

    # -- id_token verification ----------------------------------------------

    async def _verify_id_token(
        self,
        id_token: str,
        *,
        issuer: str,
        audience: str,
        nonce: str | None,
        jwks_uri: str,
    ) -> dict[str, Any]:
        keys = await self._fetch_jwks(jwks_uri) if jwks_uri else None
        if not keys:
            raise ValueError("no JWKS available to verify id_token")

        last_err: Exception | None = None
        for key in keys:
            try:
                return pyjwt.decode(
                    id_token,
                    key=key,
                    algorithms=["RS256"],
                    audience=audience,
                    issuer=issuer or None,
                    options={"verify_exp": True},
                )
            except pyjwt.InvalidTokenError as exc:
                last_err = exc
                continue
        raise ValueError(f"id_token signature invalid: {last_err}")

    async def _fetch_jwks(self, jwks_uri: str) -> list:
        _assert_https_or_local(jwks_uri)
        try:
            async with self._client() as client:
                resp = await client.get(jwks_uri)
                resp.raise_for_status()
                return [pyjwt.PyJWK(j).key for j in resp.json().get("keys", [])]
        except Exception as exc:  # noqa: BLE001
            logger.warning("JWKS fetch failed for %s: %s", jwks_uri, exc)
            return []
