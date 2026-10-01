"""Structured audit rows for platform-superadmin actions.

The request audit middleware (``src/core/middleware/audit_log.py``) already
records every mutating HTTP request, but only as "who called which path with
which body". For superadmin actions — plan changes, config and limit edits,
credit grants and, later, every money action — we also need *what changed*:
the value before, the value after, and the operator's stated reason.

``record_superadmin_action`` writes that as one more row in the existing
``auditlog`` table (no schema change): ``resource="superadmin"``,
``action="superadmin.<action>"``, and ``payload`` holding
``{"reason", "before", "after"}`` with secrets redacted by the same rules the
middleware uses.

Callers invoke it AFTER the change has been committed, so the audit row never
describes something that rolled back. By default a failed audit write is
logged and swallowed (it must not undo an action that already happened); pass
``strict=True`` for money actions that must not proceed un-audited.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.audit_logs import AuditLog

logger = logging.getLogger(__name__)

SUPERADMIN_AUDIT_RESOURCE = "superadmin"

# Column caps from ``AuditLog`` (String(256) / String(512) / String(64)).
_ACTION_MAX = 256
_PATH_MAX = 512
_IP_MAX = 64
_REASON_MAX = 1000


def _changed_only(before: Any, after: Any) -> tuple[Any, Any]:
    """For two dicts keep only the top-level keys whose value changed.

    Org configs are large; storing the whole document twice per edit buries the
    actual change. Anything that is not a pair of dicts is stored as given.
    """
    if not isinstance(before, dict) or not isinstance(after, dict):
        return before, after
    keys = [k for k in {*before.keys(), *after.keys()} if before.get(k) != after.get(k)]
    keys.sort(key=str)
    return (
        {k: before[k] for k in keys if k in before},
        {k: after[k] for k in keys if k in after},
    )


def _redact(value: Any) -> Any:
    from src.core.middleware.audit_log import _redact as middleware_redact

    return middleware_redact(value)


def _request_context(request: Optional[Request]) -> tuple[str, Optional[str], Optional[str], Optional[str]]:
    if request is None:
        return "SYSTEM", None, None, None
    from src.services.audit.audit import extract_request_context

    ip, user_agent = extract_request_context(request)
    try:
        method = (request.method or "SYSTEM")[:10]
        path = str(request.url.path)[:_PATH_MAX]
    except Exception:
        method, path = "SYSTEM", None
    return method, path, (str(ip)[:_IP_MAX] if ip else None), user_agent


async def record_superadmin_action(
    db_session: AsyncSession,
    actor_id: Optional[int],
    action: str,
    org_id: Optional[int] = None,
    reason: Optional[str] = None,
    before: Any = None,
    after: Any = None,
    *,
    request: Optional[Request] = None,
    resource_id: Optional[str] = None,
    diff_only: bool = True,
    strict: bool = False,
) -> Optional[AuditLog]:
    """Append one audit row describing a superadmin change.

    Args:
        db_session: session used for the write (committed here).
        actor_id: the real user behind the action (for a ``vb_sa_`` token, the
            user who minted it).
        action: short dotted label, stored as ``superadmin.<action>``.
        org_id: the organization affected, or None for platform-level actions.
        reason: free-text justification supplied by the operator.
        before / after: JSON-serialisable snapshots. When both are dicts and
            ``diff_only`` is true only changed top-level keys are kept.
        request: the HTTP request, for method/path/IP/user agent.
        resource_id: optional id of the thing changed (defaults to org_id).
        strict: re-raise a failed write instead of logging it.

    Returns the persisted row, or None if the write failed (non-strict).
    """
    if diff_only:
        before, after = _changed_only(before, after)

    method, path, ip, user_agent = _request_context(request)
    label = action if action.startswith("superadmin.") else f"superadmin.{action}"
    clean_reason = (reason or "").strip()[:_REASON_MAX] or None

    username: Optional[str] = None
    if actor_id:
        try:
            from sqlmodel import select

            from src.db.users import User

            username = (
                await db_session.execute(select(User.username).where(User.id == actor_id))
            ).scalars().first()
        except Exception:
            logger.debug("Superadmin audit username lookup failed", exc_info=True)

    row = AuditLog(
        org_id=org_id,
        user_id=actor_id or None,
        username=username,
        method=method,
        path=path,
        action=label[:_ACTION_MAX],
        resource=SUPERADMIN_AUDIT_RESOURCE,
        resource_id=str(resource_id if resource_id is not None else org_id or "")[:128] or None,
        ip_address=ip,
        user_agent=user_agent,
        status_code=None,
        payload={
            "reason": clean_reason,
            "before": _redact(before),
            "after": _redact(after),
        },
    )

    try:
        db_session.add(row)
        await db_session.commit()
        return row
    except Exception:
        try:
            await db_session.rollback()
        except Exception:  # pragma: no cover - rollback best-effort
            pass
        logger.error(
            "Failed to record superadmin audit action %s by user %s (org %s)",
            label,
            actor_id,
            org_id,
            exc_info=True,
        )
        if strict:
            raise
        return None
