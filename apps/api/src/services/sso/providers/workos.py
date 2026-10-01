"""WorkOS SSO provider adapter.

WorkOS fronts any SAML/OIDC/Google-OAuth connection behind a single API, so it
is the universal path for the providers ValidBridge does not natively
implement (Keycloak, Okta, Auth0, custom SAML) — they all ride on ``workos``.
Credentials come from platform config only (``VALIDBRIDGE_WORKOS_*``); the
DB-backed ``SSOConfig.provider_config`` may hold at most a WorkOS organization
id (a non-secret routing hint).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request

from src.db.sso import SSOConfig
from src.services.sso.providers.base import (
    ConfigField,
    Identity,
    ProviderInfo,
    SSOProviderAdapter,
)

logger = logging.getLogger(__name__)


def _workos_config():
    from config.config import get_validbridge_config

    return get_validbridge_config().sso.workos


class WorkOSAdapter(SSOProviderAdapter):
    provider_id = "workos"

    def available(self, provider_config: dict[str, Any] | None = None) -> bool:
        cfg = _workos_config()
        return bool(cfg.client_id and cfg.client_secret)

    def provider_info(self) -> ProviderInfo:
        return ProviderInfo(
            id="workos",
            name="WorkOS",
            description=(
                "Connect any identity provider (SAML, OIDC, Google OAuth, Okta, "
                "Auth0, Keycloak, …) through WorkOS. Configure your "
                "organization's connection from the WorkOS admin portal."
            ),
            has_setup_portal=True,
            available=self.available(),
            config_fields=[
                ConfigField(
                    name="organization_id",
                    type="string",
                    required=False,
                    description=(
                        "Your WorkOS organization ID (org_…). Leave blank to use "
                        "the connection's default organization."
                    ),
                ),
            ],
        )

    def _client(self):
        from workos import WorkOSClient

        cfg = _workos_config()
        return WorkOSClient(api_key=cfg.client_secret, client_id=cfg.client_id)

    async def build_authorization_url(
        self,
        *,
        redirect_uri: str,
        state: str,
        config: SSOConfig,
        request: Request,
    ) -> tuple[str, dict[str, Any]]:
        client = self._client()
        organization = (config.provider_config or {}).get("organization_id")
        url = client.sso.get_authorization_url(
            redirect_uri=redirect_uri,
            state=state,
            organization=organization or None,
        )
        return url, {}

    async def exchange_code(
        self,
        *,
        code: str,
        state_extra: dict[str, Any],
        config: SSOConfig,
        request: Request,
    ) -> Identity:
        client = self._client()
        resp = client.sso.get_profile_and_token(code=code)
        profile = resp.profile
        name = (profile.name or " ".join(filter(None, [profile.first_name, profile.last_name]))).strip()
        return Identity(
            email=(profile.email or "").strip().lower(),
            email_verified=True,
            name=name,
            provider=self.provider_id,
            raw_id=profile.idp_id or profile.id,
        )

    async def get_setup_portal_url(
        self,
        *,
        config: SSOConfig,
        return_url: str | None,
        request: Request,
    ) -> str | None:
        if not self.available():
            return None
        organization = (config.provider_config or {}).get("organization_id")
        if not organization:
            return None
        client = self._client()
        link = client.admin_portal.generate_link(
            organization=organization,
            intent="sso",
            return_url=return_url,
        )
        return getattr(link, "link", None)
