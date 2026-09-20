"""Single sign-on backend: provider registry, state handling, provisioning."""

from src.services.sso.providers import (
    get_adapter,
    get_provider_info_dicts,
    get_provider_infos,
)
from src.services.sso.state import consume_state_token, issue_state_token

__all__ = [
    "consume_state_token",
    "get_adapter",
    "get_provider_info_dicts",
    "get_provider_infos",
    "issue_state_token",
]
