"""Org-wide request audit logging middleware.

Appends one durable row to the ``auditlog`` table per audited request. The
reader surface is ``src/routers/audit_logs.py`` (``/ee/audit_logs``).

Design rules (matching the existing ``record_audit_event`` philosophy):

- Audit must NEVER block, slow down, or fail the request it describes. Captured
  rows go to a bounded in-process queue drained by a single background writer; a
  full queue DROPS rows (logged loudly) instead of awaiting a slot.
- Only mutating requests (POST/PUT/PATCH/DELETE) are captured; GETs are not.
  Auth endpoints are captured even when anonymous because failed logins are the
  security signal.
- Request bodies are buffered only for JSON mutating requests, capped at 64 KiB,
  and secrets are redacted before anything is stored. Authorization/Cookie
  headers are never stored.

Implemented as a pure-ASGI middleware on purpose: ``BaseHTTPMiddleware`` buffers
streaming responses, which this app uses for AI and video endpoints.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_MAX_QUEUE_SIZE = 2000
_BATCH_SIZE = 50
_WRITER_SHUTDOWN_TIMEOUT_SECONDS = 5.0

# Bodies larger than this are not logged at all (the truncation breaks JSON
# parsing anyway, and huge bodies are uploads, not actions we want recorded).
_MAX_BODY_BYTES = 65536

_AUDIT_METHODS = ("POST", "PUT", "PATCH", "DELETE")

# Whitelisted paths (exact match) are never captured — health probes, instance
# metadata, monitoring, dev-only surfaces, docs, or raw content delivery.
_NON_AUDITED_EXACT = {
    "/",
    "/health",
    "/api/v1/health",
    "/api/v1/instance/info",
    "/api/v1/demo/status",
    "/docs",
    "/redoc",
    "/openapi.json",
}
# Prefix-skipped regardless of trailing segments.
_NON_AUDITED_PREFIXES = (
    "/api/v1/monitoring",
    "/api/v1/dev/",
    "/content/",
)

# Redaction: if any of these substrings appears in a (lowercased) JSON key, the
# value is replaced at capture time. Deliberately broad — for an audit log,
# over-redaction is the safe failure mode. "key"/"authorization"/"cookie" bare
# words are excluded to avoid mangling benign keys that merely contain them.
_SECRET_KEY_MARKERS = (
    "password",
    "passwd",
    "secret",
    "token",
    "authorization",
    "api_key",
    "apikey",
    "client_secret",
    "access_token",
    "refresh",
    "cookie",
)

_UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

# path-prefix → resource category. Order matters (most specific first).
_RESOURCE_RULES = [
    (
        (
            "/api/v1/courses",
            "/api/v1/chapters",
            "/api/v1/activities",
            "/api/v1/assignments",
            "/api/v1/certifications",
            "/api/v1/communities",
        ),
        "course",
    ),
    (
        ("/api/v1/users", "/api/v1/usergroups"),
        "user",
    ),
    (
        ("/api/v1/orgs",),
        "org",
    ),
]

_VERB_BY_METHOD = {
    "POST": "create",
    "PUT": "update",
    "PATCH": "update",
    "DELETE": "delete",
}


# ---------------------------------------------------------------------------
# Pure helpers (unit-testable)
# ---------------------------------------------------------------------------

def _should_audit(method: str, path: str) -> bool:
    """True when a request should produce an audit row."""
    if method not in _AUDIT_METHODS:
        return False
    if path in _NON_AUDITED_EXACT:
        return False
    return not path.startswith(_NON_AUDITED_PREFIXES)


def _is_json_request(scope: dict) -> bool:
    for key, value in scope.get("headers", []):
        if key.lower() == b"content-type":
            return b"application/json" in value.lower()
    return False


def _header_value(scope: dict, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key.lower() == name:
            return value.decode("latin-1")
    return None


def _client_ip(scope: dict) -> str | None:
    """Best-effort client IP honoring the same trusted-proxy rule as rate
    limiting: forwarded headers are only trusted when the direct peer is a
    loopback/private address."""
    client = scope.get("client")
    direct_ip = client[0] if client else None
    if not direct_ip:
        return None
    try:
        addr = ipaddress.ip_address(direct_ip)
        trusted_proxy = addr.is_loopback or addr.is_private
    except ValueError:
        trusted_proxy = False
    if trusted_proxy:
        forwarded = _header_value(scope, b"x-forwarded-for")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            try:
                ipaddress.ip_address(first)
                return first
            except ValueError:
                pass
    return direct_ip


def _is_secret_key(key: str) -> bool:
    lowered = key.lower()
    return any(marker in lowered for marker in _SECRET_KEY_MARKERS)


def _redact(value: Any, depth: int = 0) -> Any:
    if depth > 6:
        return value
    if isinstance(value, dict):
        return {
            k: ("[REDACTED]" if _is_secret_key(str(k)) else _redact(v, depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_redact(v, depth + 1) for v in value]
    return value


def _parse_payload(body: bytes | None) -> dict | None:
    """Redacted JSON body snapshot, or None when there is no body / it is not a
    JSON object / it exceeds the capture cap (truncated bodies fail to parse)."""
    if not body:
        return None
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    return _redact(value)


def _resource_from_path(method: str, path: str) -> tuple[str | None, str | None, str]:
    """Derive ``(resource, resource_id, action)`` from path + method.

    Best-effort and lossless: nothing here is authoritative for access control,
    only for display/search convenience.
    """
    resource = None
    for prefixes, category in _RESOURCE_RULES:
        if path.startswith(prefixes):
            resource = category
            break
    if resource is None:
        resource = "org"

    resource_id = None
    for segment in reversed(path.split("/")):
        seg = segment.strip()
        if not seg:
            continue
        if seg.isdigit() or _UUID_PATTERN.fullmatch(seg):
            resource_id = seg
            break

    verb = _VERB_BY_METHOD.get(method, method.lower())
    action = f"{resource}.{verb}"
    return resource, resource_id, action


def _extract_org_id(method: str, path: str, query_string: bytes) -> int | None:
    """Best-effort org id from ``?org_id=`` or an ``/orgs/{id}/...`` path."""
    if query_string:
        try:
            params = {}
            for pair in query_string.decode("latin-1").split("&"):
                if "=" in pair:
                    k, _, v = pair.partition("=")
                    params[k] = v
            raw = params.get("org_id")
            if raw and raw.isdigit():
                return int(raw)
        except Exception:
            logger.debug("Audit org_id query parse failed", exc_info=True)
    parts = path.split("/")
    try:
        idx = parts.index("orgs")
        if idx + 1 < len(parts) and parts[idx + 1].isdigit():
            return int(parts[idx + 1])
    except ValueError:
        pass
    return None


# ---------------------------------------------------------------------------
# Queue + background writer
# ---------------------------------------------------------------------------

_queue: asyncio.Queue = asyncio.Queue(maxsize=_MAX_QUEUE_SIZE)
_worker: asyncio.Task | None = None
_dropped = 0


def _enqueue_record(record: dict) -> None:
    global _dropped
    try:
        _queue.put_nowait(record)
    except asyncio.QueueFull:
        _dropped += 1
        logger.warning(
            "Audit log queue full — dropping audit row (total dropped: %s)",
            _dropped,
        )


def start_audit_log_worker() -> None:
    global _worker
    if _worker is None or _worker.done():
        _worker = asyncio.get_running_loop().create_task(_writer_loop())


async def stop_audit_log_worker() -> None:
    """Drain remaining rows (bounded) and stop the writer."""
    global _worker
    task = _worker
    _worker = None
    if task is None or task.done():
        return
    try:
        _queue.put_nowait(None)  # sentinel
    except asyncio.QueueFull:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, RuntimeError):
            pass
        return
    try:
        await asyncio.wait_for(task, timeout=_WRITER_SHUTDOWN_TIMEOUT_SECONDS)
    except (TimeoutError, asyncio.CancelledError):
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, RuntimeError):
            pass


async def _writer_loop() -> None:
    batch: list[dict] = []
    while True:
        record = await _queue.get()
        try:
            if record is None:
                if batch:
                    await _write_batch(batch)
                    batch = []
                return
            batch.append(record)
            if len(batch) >= _BATCH_SIZE:
                await _write_batch(batch)
                batch = []
        finally:
            _queue.task_done()


async def _write_batch(records: list[dict]) -> None:
    """Insert a batch in isolated sessions. Never raises to the writer loop
    caller beyond the guard in the middleware enqueue path."""
    # Lazy imports keep this module importable without booting the engine.
    from sqlmodel import select

    from src.core.events.database import _async_session_factory
    from src.db.audit_logs import AuditLog
    from src.db.users import User

    user_ids = sorted({int(r["user_id"]) for r in records if r.get("user_id")})
    names: dict[int, str | None] = {}
    if user_ids:
        try:
            async with _async_session_factory() as session:
                rows = (
                    await session.execute(
                        select(User.id, User.username).where(User.id.in_(user_ids))
                    )
                ).all()
                names = {int(uid): uname for uid, uname in rows}
        except Exception:
            logger.warning("Audit log username resolution failed", exc_info=True)

    try:
        async with _async_session_factory() as session:
            for rec in records:
                uid = rec.get("user_id")
                session.add(
                    AuditLog(
                        org_id=rec.get("org_id"),
                        user_id=uid,
                        username=names.get(uid) if uid else None,
                        method=rec.get("method") or "",
                        path=rec.get("path"),
                        action=rec.get("action"),
                        resource=rec.get("resource"),
                        resource_id=rec.get("resource_id"),
                        ip_address=rec.get("ip_address"),
                        user_agent=rec.get("user_agent"),
                        status_code=rec.get("status_code"),
                        payload=rec.get("payload"),
                    )
                )
            await session.commit()
    except Exception:
        logger.exception("Failed to persist audit log batch (%s rows) — audit rows lost", len(records))


# ---------------------------------------------------------------------------
# ASGI middleware
# ---------------------------------------------------------------------------

class AuditLogMiddleware:
    """Pure-ASGI middleware; wraps the downstream app and enqueues an audit row
    after the response completes. Never raises into the request path."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        path = scope.get("path", "/")
        audit = _should_audit(method, path)
        capture_body = audit and _is_json_request(scope)

        status_code: int | None = None
        chunks = bytearray() if capture_body else None
        buffered = 0

        async def wrapped_receive():
            nonlocal buffered
            message = await receive()
            if capture_body and message["type"] == "http.request":
                chunk = message.get("body") or b""
                if buffered < _MAX_BODY_BYTES:
                    take = min(len(chunk), _MAX_BODY_BYTES - buffered)
                    chunks.extend(chunk[:take])  # type: ignore[union-attr]
                buffered += len(chunk)
            return message

        async def wrapped_send(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, wrapped_receive, wrapped_send)
        finally:
            if audit:
                try:
                    record = _build_record(
                        scope,
                        status_code,
                        bytes(chunks) if capture_body else None,
                    )
                    _enqueue_record(record)
                except Exception:
                    logger.exception(
                        "Audit log capture failed for %s %s", method, path
                    )


def _build_record(scope: dict, status_code: int | None, body: bytes | None) -> dict:
    method = scope.get("method", "")
    path = scope.get("path", "/")
    resource, resource_id, action = _resource_from_path(method, path)

    state = scope.get("state") or {}
    user = state.get("user")
    user_id: int | None = None
    if user is not None:
        created_by = getattr(user, "created_by_user_id", None)
        if created_by:
            user_id = int(created_by)
        elif getattr(user, "id", None):
            user_id = int(user.id)

    return {
        "method": method,
        "path": path,
        "action": action,
        "resource": resource,
        "resource_id": resource_id,
        "user_id": user_id,
        "org_id": _extract_org_id(method, path, scope.get("query_string") or b""),
        "ip_address": _client_ip(scope),
        "user_agent": _header_value(scope, b"user-agent"),
        "status_code": status_code,
        "payload": _parse_payload(body),
    }