"""In-repo fake OpenID Connect identity provider for CI-testable SSO.

Not a live server — it is an ``httpx.MockTransport`` handler that answers the
OIDC discovery / token / userinfo / JWKS endpoints deterministically. Tests
point an :class:`OIDCAdapter` (whose transport is injectable) at these URLs so
the full E8→E9 round trip runs without a real IdP.
"""

from __future__ import annotations

import json
import secrets
import time
from typing import Any

import httpx
import jwt as pyjwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ISSUER = "https://fake-idp.test"


class FakeOIDC:
    """A minimal OIDC provider backed by an in-memory code store + RSA key."""

    def __init__(
        self,
        *,
        email: str = "sso.user@example.com",
        email_verified: bool = True,
        name: str = "SSO User",
    ):
        self.email = email
        self.email_verified = email_verified
        self.name = name
        self._key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self._codes: dict[str, str] = {}
        self._nonces: dict[str, str] = {}

    # -- endpoints -----------------------------------------------------------

    @property
    def issuer(self) -> str:
        return ISSUER

    @property
    def discovery_url(self) -> str:
        return f"{ISSUER}/.well-known/openid-configuration"

    @property
    def jwks_url(self) -> str:
        return f"{ISSUER}/.well-known/jwks.json"

    @property
    def token_url(self) -> str:
        return f"{ISSUER}/token"

    @property
    def userinfo_url(self) -> str:
        return f"{ISSUER}/userinfo"

    # -- internals -----------------------------------------------------------

    def _jwk(self) -> dict[str, Any]:
        pub = self._key.public_key().public_numbers()
        import base64

        def b64url(x: bytes) -> str:
            return base64.urlsafe_b64encode(x).rstrip(b"=").decode()

        return {
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": "test-key",
            "n": b64url(pub.n.to_bytes((pub.n.bit_length() + 7) // 8, "big")),
            "e": b64url(pub.e.to_bytes((pub.e.bit_length() + 7) // 8, "big")),
        }

    def _id_token(self, nonce: str | None) -> str:
        now = int(time.time())
        claims = {
            "iss": ISSUER,
            "aud": "test-client-id",
            "sub": "fake-subject",
            "email": self.email,
            "email_verified": self.email_verified,
            "name": self.name,
            "iat": now,
            "exp": now + 3600,
        }
        if nonce:
            claims["nonce"] = nonce
        key_pem = self._key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        return pyjwt.encode(claims, key_pem, algorithm="RS256", headers={"kid": "test-key"})

    # -- transport -----------------------------------------------------------

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.startswith(self.discovery_url):
            body = {
                "issuer": ISSUER,
                "authorization_endpoint": f"{ISSUER}/authorize",
                "token_endpoint": self.token_url,
                "userinfo_endpoint": self.userinfo_url,
                "jwks_uri": self.jwks_url,
            }
            return httpx.Response(200, json=body)
        if url.startswith(self.jwks_url):
            return httpx.Response(200, json={"keys": [self._jwk()]})
        if url.startswith(self.token_url):
            data: dict[str, Any] = {}
            if request.content:
                try:
                    data = dict(json.loads(request.content))
                except (json.JSONDecodeError, ValueError):
                    from urllib.parse import parse_qs

                    data = {
                        k: (v[0] if v else "")
                        for k, v in parse_qs(request.content.decode()).items()
                    }
            code = data.get("code")
            if not code or code not in self._codes:
                return httpx.Response(400, json={"error": "invalid_grant"})
            nonce = self._nonces.pop(code, None)
            return httpx.Response(
                200,
                json={
                    "access_token": secrets.token_urlsafe(16),
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "id_token": self._id_token(nonce),
                },
            )
        if url.startswith(self.userinfo_url):
            return httpx.Response(
                200,
                json={
                    "sub": "fake-subject",
                    "email": self.email,
                    "email_verified": self.email_verified,
                    "name": self.name,
                },
            )
        if url.startswith(f"{ISSUER}/authorize"):
            return httpx.Response(302, headers={"Location": "/callback?code=abc"})
        return httpx.Response(404)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    # -- test helpers --------------------------------------------------------

    def issue_code(self, nonce: str | None = None) -> str:
        code = secrets.token_urlsafe(16)
        self._codes[code] = code
        if nonce:
            self._nonces[code] = nonce
        return code
