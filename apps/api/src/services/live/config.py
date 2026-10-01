"""LiveKit connection settings and live-session tunables.

Credentials come only from the environment (``LIVEKIT_URL``,
``LIVEKIT_API_KEY``, ``LIVEKIT_API_SECRET``); the secret never leaves the API.
Read on every call rather than cached so tests and operators can change them
without a restart of the module state.
"""

import os
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class LiveKitSettings:
    # Public signalling URL handed to browsers (wss://...).
    url: str
    api_key: str
    api_secret: str
    # Server-side API base (https://...). Defaults to ``url`` with an http(s)
    # scheme; set LIVEKIT_API_URL to reach LiveKit over a private network.
    api_url: str


def _http_url(url: str) -> str:
    if url.startswith("wss://"):
        return "https://" + url[len("wss://"):]
    if url.startswith("ws://"):
        return "http://" + url[len("ws://"):]
    return url


def get_livekit_settings() -> Optional[LiveKitSettings]:
    """Return settings, or None when live classrooms are not configured."""
    url = os.environ.get("LIVEKIT_URL", "").strip()
    api_key = os.environ.get("LIVEKIT_API_KEY", "").strip()
    api_secret = os.environ.get("LIVEKIT_API_SECRET", "").strip()
    if not (url and api_key and api_secret):
        return None
    api_url = os.environ.get("LIVEKIT_API_URL", "").strip() or _http_url(url)
    return LiveKitSettings(
        url=url,
        api_key=api_key,
        api_secret=api_secret,
        api_url=api_url.rstrip("/"),
    )


def _int_env(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def token_ttl_seconds() -> int:
    """Join-token lifetime. Only checked at connect time — LiveKit refreshes
    tokens for connected clients — so it can stay short."""
    return _int_env("VALIDBRIDGE_LIVE_TOKEN_TTL_SECONDS", 600) or 600


def room_empty_timeout_seconds() -> int:
    return _int_env("VALIDBRIDGE_LIVE_ROOM_EMPTY_TIMEOUT_SECONDS", 600)


def room_max_participants() -> int:
    """0 means unlimited."""
    return _int_env("VALIDBRIDGE_LIVE_MAX_PARTICIPANTS", 0)


def ready_timeout_seconds() -> int:
    """How long a READY session waits for staff to connect before it expires."""
    return _int_env("VALIDBRIDGE_LIVE_READY_TIMEOUT_MINUTES", 60) * 60


def host_absent_grace_seconds() -> int:
    """How long a LIVE session survives with no instructor/moderator connected."""
    return _int_env("VALIDBRIDGE_LIVE_HOST_ABSENT_GRACE_MINUTES", 15) * 60


def max_duration_seconds() -> int:
    return _int_env("VALIDBRIDGE_LIVE_MAX_DURATION_HOURS", 8) * 3600


def processing_timeout_seconds() -> int:
    """How long an ended session may wait on its recording before completing."""
    return _int_env("VALIDBRIDGE_LIVE_PROCESSING_TIMEOUT_HOURS", 6) * 3600


def reconcile_interval_seconds() -> int:
    return _int_env("VALIDBRIDGE_LIVE_RECONCILE_INTERVAL_SECONDS", 30) or 30


# -- Attendance policy -------------------------------------------------------


def late_grace_seconds() -> int:
    """Arriving within this long after the lesson went live is on time."""
    return _int_env("VALIDBRIDGE_LIVE_LATE_GRACE_MINUTES", 5) * 60


def early_leave_grace_seconds() -> int:
    """Leaving within this long before the lesson ended is not "left early"."""
    return _int_env("VALIDBRIDGE_LIVE_EARLY_LEAVE_GRACE_MINUTES", 5) * 60


def present_threshold_percent() -> int:
    """Below this share of the lesson, attendance counts as partial."""
    return min(100, _int_env("VALIDBRIDGE_LIVE_PRESENT_THRESHOLD_PERCENT", 75))


# -- Recording -----------------------------------------------------------------


def recording_enabled_flag() -> bool:
    """Recording needs a LiveKit Egress service deployed next to LiveKit, so it
    is opt-in (VALIDBRIDGE_LIVE_RECORDING_ENABLED=true)."""
    return os.environ.get("VALIDBRIDGE_LIVE_RECORDING_ENABLED", "false").strip().lower() == "true"


def recording_layout() -> str:
    """LiveKit room-composite layout: "speaker" (default) or "grid"."""
    layout = os.environ.get("VALIDBRIDGE_LIVE_RECORDING_LAYOUT", "speaker").strip().lower()
    return layout if layout in ("speaker", "grid", "single-speaker") else "speaker"


def recording_finalize_timeout_seconds() -> int:
    """How long a finished recording may wait to appear in storage before it
    is marked failed."""
    return _int_env("VALIDBRIDGE_LIVE_RECORDING_FINALIZE_TIMEOUT_MINUTES", 60) * 60
