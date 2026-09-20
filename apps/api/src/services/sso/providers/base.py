"""SSO provider abstraction.

Each provider (WorkOS, custom OIDC, …) is an adapter that knows how to build an
authorization URL and exchange the resulting code for an :class:`Identity`.
Adapters resolve credentials from the org's ``SSOConfig.provider_config`` (BYOK)
first, falling back to platform config (``config.yaml`` / env). Secrets are
encrypted at rest and are never returned to clients.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import Request


@dataclass
class ConfigField:
    """One editable field advertised to the admin UI (matches ``ConfigField`` in
    ``apps/web/services/auth/sso.ts``)."""

    name: str
    type: str
    required: bool
    description: str
    placeholder: str | None = None
    hidden: bool = False

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "name": self.name,
            "type": self.type,
            "required": self.required,
            "description": self.description,
        }
        if self.placeholder is not None:
            out["placeholder"] = self.placeholder
        if self.hidden:
            out["hidden"] = True
        return out


@dataclass
class ProviderInfo:
    """Matches ``SSOProviderInfo`` in ``apps/web/services/auth/sso.ts``."""

    id: str
    name: str
    description: str
    has_setup_portal: bool
    available: bool
    config_fields: list = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "has_setup_portal": self.has_setup_portal,
            "available": self.available,
            "config_fields": [f.as_dict() for f in self.config_fields],
        }


@dataclass
class Identity:
    """Normalised user identity returned by a provider after code exchange."""

    email: str
    email_verified: bool
    name: str
    provider: str
    raw_id: str


class SSOProviderAdapter:
    """Base class for SSO provider adapters."""

    provider_id: str = ""

    def available(self, provider_config: dict[str, Any] | None = None) -> bool:
        """Whether this provider can be used.

        ``provider_config`` is the org's SSOConfig blob when the check is for a
        specific org (so BYOK providers can report availability from the org's
        own credentials); it is omitted when advertising the provider list.
        """
        return False

    def provider_info(self) -> ProviderInfo:
        raise NotImplementedError

    async def build_authorization_url(
        self,
        *,
        redirect_uri: str,
        state: str,
        config: Any,
        request: Request,
    ) -> tuple[str, dict[str, Any]]:
        """Return ``(authorization_url, state_extra)``.

        ``state_extra`` is folded into the single-use state token so the
        callback can verify protocol artefacts (e.g. the OIDC ``nonce``).
        """
        raise NotImplementedError

    async def exchange_code(
        self,
        *,
        code: str,
        state_extra: dict[str, Any],
        config: Any,
        request: Request,
    ) -> Identity:
        raise NotImplementedError

    async def get_setup_portal_url(
        self,
        *,
        config: Any,
        return_url: str | None,
        request: Request,
    ) -> str | None:
        return None
