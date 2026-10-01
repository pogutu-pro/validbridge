"""SSO provider registry.

Presents all six provider cards the admin UI expects, but only ``workos`` and
``custom_oidc`` have real adapters behind them. The other four are presented as
"configure via WorkOS" (they ride the WorkOS adapter when a WorkOS connection
exists) and report ``available: False`` unless backend config exists.

Config is read lazily (never at import time) so tests can patch env/config
cleanly.
"""

from __future__ import annotations

from src.services.sso.providers.base import ConfigField, ProviderInfo
from src.services.sso.providers.oidc import OIDCAdapter
from src.services.sso.providers.workos import WorkOSAdapter

_WORKOS_ONLY_DESCRIPTION = (
    "Connect {name} through WorkOS. Create a {name} connection in the WorkOS "
    "admin portal for your organization."
)


def _adapters() -> dict[str, object]:
    return {
        "workos": WorkOSAdapter(),
        "custom_oidc": OIDCAdapter(),
    }


def get_adapter(provider_id: str):
    """Return the adapter for ``provider_id``, or None if it has no native
    adapter (Keycloak/Okta/Auth0/custom_saml are WorkOS-only)."""
    return _adapters().get(provider_id)


def _workos_available() -> bool:
    return WorkOSAdapter().available()


def get_provider_infos() -> list[ProviderInfo]:
    workos_available = _workos_available()
    workos_desc = (
        WorkOSAdapter().provider_info().description
        if workos_available
        else "Single sign-on for any identity provider (SAML, OIDC, Google OAuth) "
        "via WorkOS. Not configured — set VALIDBRIDGE_WORKOS_CLIENT_ID/SECRET to enable."
    )
    infos = [
        ProviderInfo(
            id="workos",
            name="WorkOS",
            description=workos_desc,
            has_setup_portal=True,
            available=workos_available,
            config_fields=[
                ConfigField(
                    name="organization_id",
                    type="string",
                    required=False,
                    description="Your WorkOS organization ID (org_…).",
                ),
            ],
        ),
    ]

    # The four WorkOS-only providers.
    for pid, name in (
        ("keycloak", "Keycloak"),
        ("okta", "Okta"),
        ("auth0", "Auth0"),
        ("custom_saml", "Custom SAML"),
    ):
        infos.append(
            ProviderInfo(
                id=pid,
                name=name,
                description=_WORKOS_ONLY_DESCRIPTION.format(name=name),
                has_setup_portal=True,
                available=workos_available,
                config_fields=[],
            )
        )

    oidc_adapter = OIDCAdapter()
    infos.append(oidc_adapter.provider_info())
    return infos


def get_provider_info_dicts() -> list[dict]:
    return [info.as_dict() for info in get_provider_infos()]
