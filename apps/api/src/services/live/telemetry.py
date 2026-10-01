"""Structured logs for the live classroom.

One line per event, in the same shape as the rest of the API
(``auth.refresh``): a greppable ``event key=value …`` message plus the same
fields under ``extra`` for JSON/Sentry handlers.

Credentials never reach the log: any field whose name looks like a secret or a
token is replaced before formatting, so a careless call site cannot leak a
LiveKit secret or a participant's join token.
"""

import logging
import re
from typing import Any

logger = logging.getLogger("src.services.live.telemetry")

_SENSITIVE = re.compile(r"secret|token|password|authorization|credential|api_key|cookie", re.IGNORECASE)
_REDACTED = "[redacted]"


def _clean(value: Any) -> Any:
    if hasattr(value, "value") and not isinstance(value, (str, bytes)):
        value = value.value  # enums
    if isinstance(value, str) and len(value) > 200:
        return value[:200] + "…"
    return value


def scrub(fields: dict[str, Any]) -> dict[str, Any]:
    """Drop credential-looking fields and normalise values for logging."""
    return {
        key: (_REDACTED if _SENSITIVE.search(key) else _clean(value))
        for key, value in fields.items()
        if value is not None
    }


def log_event(event_name: str, level: int = logging.INFO, /, **fields: Any) -> None:
    """Log ``live.<event_name>`` with structured fields. Never raises.

    Positional-only, so a field may itself be called ``event`` or ``level``.
    """
    try:
        name = f"live.{event_name}"
        clean = scrub(fields)
        message = " ".join([name, *(f"{k}={v}" for k, v in clean.items())])
        logger.log(level, message, extra={"event": name, **{f"live_{k}": v for k, v in clean.items()}})
    except Exception:  # pragma: no cover - telemetry must never break a lesson
        pass
