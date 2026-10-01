"""SSO endpoints.

Mounts at ``/auth/sso`` (mirrors ``auth.py``'s mount, but lives in its own
module per the implementation plan). Admin endpoints (E1–E6) require a real
session (no API tokens) and org-admin role. Public endpoints (E7–E9) are
anonymous and rate-limited with the existing login limiter.

The callback (E9) reuses the existing session machinery
(``issue_session_or_challenge`` + ``set_auth_cookies``) so MFA and the
auth-method/session-sharing policies apply to SSO exactly as to password login.
"""

import logging
from datetime import UTC, datetime
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.sso import (
    SSO_PROVIDER_IDS,
    SSOConfig,
    SSOConfigCreate,
    SSOConfigRead,
    SSOConfigUpdate,
)
from src.db.users import AnonymousUser, APITokenUser
from src.routers.auth import (
    get_token_expiry_ms,
    is_request_secure,
    set_auth_cookies,
)
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import require_org_admin
from src.security.secret_crypto import encrypt_secret
from src.services.demo.guards import is_demo_org
from src.services.sso import (
    consume_state_token,
    get_adapter,
    get_provider_info_dicts,
    issue_state_token,
)
from src.services.sso.provision import (
    SSOProvisionError,
    email_domain_allowed,
    find_or_provision_user,
    normalize_domain,
    resolve_org_by_slug,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_PROVIDER_SET = frozenset(SSO_PROVIDER_IDS)


# ---------------------------------------------------------------------------
# Error contract (§8) — the frontend translates these exact codes.
# ---------------------------------------------------------------------------

def _sso_error(
    code: str,
    description: str,
    *,
    http_status: int = 400,
    provider: str | None = None,
    details: dict | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=http_status,
        detail={
            "error": code,
            "error_code": code,
            "error_description": description,
            **({"provider": provider} if provider else {}),
            **({"details": details} if details else {}),
        },
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mask_provider_config(provider_config: dict | None) -> dict:
    """Never echo a stored secret back to the client."""
    masked = dict(provider_config or {})
    masked.pop("client_secret", None)
    return masked


def _seal_provider_config(provider_config: dict | None) -> dict:
    """Encrypt a provider client secret before it is persisted (never plaintext)."""
    sealed = dict(provider_config or {})
    secret = sealed.get("client_secret")
    if secret:
        sealed["client_secret"] = encrypt_secret(secret)
    return sealed


def _merge_provider_config(existing: dict | None, incoming: dict | None) -> dict:
    """Merge an incoming provider_config over the stored one.

    An empty/omitted ``client_secret`` keeps the stored secret (it is never
    echoed back, so the admin cannot re-submit it); a new secret is encrypted.
    """
    merged = dict(existing or {})
    new = dict(incoming or {})
    if not new.get("client_secret"):
        new.pop("client_secret", None)
    else:
        new["client_secret"] = encrypt_secret(new["client_secret"])
    merged.update(new)
    return merged


def _serialize_config(config: SSOConfig) -> dict:
    return SSOConfigRead(
        id=config.id or 0,
        org_id=config.org_id,
        provider=config.provider,
        enabled=config.enabled,
        domains=list(config.domains or []),
        auto_provision_users=config.auto_provision_users,
        default_role_id=config.default_role_id,
        provider_config=_mask_provider_config(config.provider_config),
        created_at=config.created_at,
        updated_at=config.updated_at,
    ).model_dump(mode="json")


def _callback_url(request: Request) -> str:
    scheme = "https" if is_request_secure(request) else "http"
    host = request.headers.get("host") or request.url.netloc
    return f"{scheme}://{host}/api/v1/auth/sso/callback"


def _safe_redirect_url(value: str | None) -> str:
    """Return a same-origin relative path for the callback redirect, or ""."""
    if not value:
        return ""
    value = (value or "").strip()
    if not value.startswith("/"):
        return ""
    if len(value) >= 2 and value[1] in ("/", "\\"):
        return ""
    parts = urlsplit(value.replace("\\", "/"))
    if parts.scheme or parts.netloc:
        return ""
    return value


async def _get_config(
    db_session: AsyncSession, org_id: int
) -> SSOConfig | None:
    rows = (
        await db_session.execute(
            select(SSOConfig)
            .where(SSOConfig.org_id == org_id, SSOConfig.enabled == True)
            .order_by(SSOConfig.updated_at.desc())
        )
    ).scalars().all()
    if rows:
        return rows[0]
    # No enabled config: fall back to any config for admin reads.
    rows = (
        await db_session.execute(
            select(SSOConfig).where(SSOConfig.org_id == org_id)
        )
    ).scalars().all()
    return rows[0] if rows else None


async def _require_admin(
    current_user, org_id: int, db_session: AsyncSession
) -> int:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    if isinstance(current_user, APITokenUser):
        raise HTTPException(status_code=403, detail="API tokens cannot manage SSO")
    acting_id = resolve_acting_user_id(current_user)
    await require_org_admin(acting_id, org_id, db_session)
    return acting_id


def _normalize_domains(domains: list[str] | None) -> list[str]:
    return sorted({normalize_domain(d) for d in (domains or []) if normalize_domain(d)})


async def _check_enable_rules(
    *,
    provider: str,
    enabled: bool,
    domains: list[str],
    auto_provision_users: bool,
    default_role_id: int | None,
    db_session: AsyncSession,
    org_id: int,
    provider_config: dict | None = None,
) -> None:
    """Validate the plan's create/update rules.

    * provider must be known;
    * enabling a provider with no backend config → ``sso_misconfigured``;
    * ``auto_provision_users`` requires non-empty ``domains``;
    * ``default_role_id`` must belong to the org.
    """
    if provider not in _PROVIDER_SET:
        raise _sso_error("sso_misconfigured", "Unknown SSO provider")

    adapter = get_adapter(provider)
    if enabled and adapter is not None and not adapter.available(provider_config):
        raise _sso_error(
            "sso_misconfigured",
            "This SSO provider is not configured on the server.",
        )

    if auto_provision_users and not domains:
        raise _sso_error(
            "sso_misconfigured",
            "domains must be non-empty when auto_provision_users is enabled",
        )

    if default_role_id is not None:
        from src.db.roles import Role

        role = (
            await db_session.execute(
                select(Role).where(Role.id == default_role_id, Role.org_id == org_id)
            )
        ).scalars().first()
        if role is None:
            raise _sso_error(
                "sso_misconfigured",
                "default_role_id must be a role belonging to this organization",
            )


# ---------------------------------------------------------------------------
# E1 — list providers
# ---------------------------------------------------------------------------

@router.get("/providers")
async def list_providers(
    org_id: int = Query(...),
    current_user=Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _require_admin(current_user, org_id, db_session)
    return get_provider_info_dicts()


# ---------------------------------------------------------------------------
# E2 — read config (404 → client treats as null)
# ---------------------------------------------------------------------------

@router.get("/{org_id}/config")
async def read_config(
    org_id: int,
    current_user=Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _require_admin(current_user, org_id, db_session)
    config = await _get_config(db_session, org_id)
    if config is None:
        raise HTTPException(status_code=404, detail="SSO configuration not found")
    return _serialize_config(config)


# ---------------------------------------------------------------------------
# E3 — create config
# ---------------------------------------------------------------------------

@router.post("/{org_id}/config", status_code=status.HTTP_201_CREATED)
async def create_config(
    org_id: int,
    payload: SSOConfigCreate,
    current_user=Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _require_admin(current_user, org_id, db_session)

    domains = _normalize_domains(payload.domains)
    final_provider_config = _seal_provider_config(payload.provider_config)
    await _check_enable_rules(
        provider=payload.provider,
        enabled=payload.enabled,
        domains=domains,
        auto_provision_users=payload.auto_provision_users,
        default_role_id=payload.default_role_id,
        db_session=db_session,
        org_id=org_id,
        provider_config=final_provider_config,
    )

    existing = (
        await db_session.execute(
            select(SSOConfig).where(
                SSOConfig.org_id == org_id, SSOConfig.provider == payload.provider
            )
        )
    ).scalars().first()
    if existing is not None:
        raise _sso_error(
            "sso_misconfigured",
            "An SSO configuration for this provider already exists",
        )

    config = SSOConfig(
        org_id=org_id,
        provider=payload.provider,
        enabled=bool(payload.enabled),
        domains=domains,
        auto_provision_users=bool(payload.auto_provision_users),
        default_role_id=payload.default_role_id,
        provider_config=final_provider_config,
    )
    db_session.add(config)
    await db_session.commit()
    await db_session.refresh(config)
    return _serialize_config(config)


# ---------------------------------------------------------------------------
# E4 — update config
# ---------------------------------------------------------------------------

@router.put("/{org_id}/config")
async def update_config(
    org_id: int,
    payload: SSOConfigUpdate,
    current_user=Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _require_admin(current_user, org_id, db_session)

    config = await _get_config(db_session, org_id)
    if config is None:
        raise HTTPException(status_code=404, detail="SSO configuration not found")

    provider = payload.provider or config.provider
    domains = _normalize_domains(payload.domains) if payload.domains is not None else list(config.domains or [])
    enabled = config.enabled if payload.enabled is None else bool(payload.enabled)
    auto_provision = (
        config.auto_provision_users
        if payload.auto_provision_users is None
        else bool(payload.auto_provision_users)
    )
    default_role_id = (
        config.default_role_id
        if payload.default_role_id is None
        else payload.default_role_id
    )

    # Merge provider config: an empty/omitted client_secret from the form keeps
    # the stored one (it is never echoed back, so the admin cannot re-submit it);
    # a new secret is encrypted before it touches the database.
    final_provider_config = _merge_provider_config(
        config.provider_config, payload.provider_config
    )

    await _check_enable_rules(
        provider=provider,
        enabled=enabled,
        domains=domains,
        auto_provision_users=auto_provision,
        default_role_id=default_role_id,
        db_session=db_session,
        org_id=org_id,
        provider_config=final_provider_config,
    )

    if payload.provider is not None:
        config.provider = payload.provider
    config.enabled = enabled
    config.domains = domains
    config.auto_provision_users = auto_provision
    config.default_role_id = default_role_id
    config.provider_config = final_provider_config
    config.updated_at = datetime.now(UTC)

    db_session.add(config)
    await db_session.commit()
    await db_session.refresh(config)
    return _serialize_config(config)


# ---------------------------------------------------------------------------
# E5 — delete config
# ---------------------------------------------------------------------------

@router.delete("/{org_id}/config", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config(
    org_id: int,
    current_user=Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _require_admin(current_user, org_id, db_session)
    config = await _get_config(db_session, org_id)
    if config is None:
        raise HTTPException(status_code=404, detail="SSO configuration not found")
    await db_session.delete(config)
    await db_session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# E6 — setup URL
# ---------------------------------------------------------------------------

@router.get("/{org_id}/setup-url")
async def setup_url(
    request: Request,
    org_id: int,
    return_url: str | None = Query(None),
    current_user=Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _require_admin(current_user, org_id, db_session)
    config = await _get_config(db_session, org_id)
    if config is None:
        return {"setup_url": None}

    adapter = get_adapter(config.provider)
    if adapter is None or not adapter.available(config.provider_config):
        return {"setup_url": None}

    url = await adapter.get_setup_portal_url(
        config=config,
        return_url=_safe_redirect_url(return_url) or None,
        request=request,
    )
    return {"setup_url": url}


# ---------------------------------------------------------------------------
# E7 — check SSO enabled
# ---------------------------------------------------------------------------

@router.get("/check")
async def check_sso(
    org_slug: str = Query(...),
    db_session: AsyncSession = Depends(get_db_session),
):
    org = await resolve_org_by_slug(db_session, org_slug)
    if org is None:
        return {"sso_enabled": False, "provider": None}

    if await is_demo_org(org.id, db_session):
        return {"sso_enabled": False, "provider": None}

    config = await _get_config(db_session, org.id)
    if config is None or not config.enabled:
        return {"sso_enabled": False, "provider": None}

    adapter = get_adapter(config.provider)
    if adapter is None or not adapter.available(config.provider_config):
        return {"sso_enabled": False, "provider": None}

    return {"sso_enabled": True, "provider": config.provider}


# ---------------------------------------------------------------------------
# E8 — authorize (start login)
# ---------------------------------------------------------------------------

@router.get("/authorize")
async def authorize(
    request: Request,
    org_slug: str = Query(...),
    return_url: str | None = Query(None),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.security.rate_limiting import check_login_rate_limit

    allowed, retry_after = check_login_rate_limit(request)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "error_code": "rate_limited",
                "error_description": f"Too many requests. Retry in {retry_after // 60} minutes.",
                "retry_after": retry_after,
            },
        )

    org = await resolve_org_by_slug(db_session, org_slug)
    if org is None or await is_demo_org(org.id, db_session):
        raise _sso_error("sso_not_enabled", "SSO is not enabled for this organization")

    config = await _get_config(db_session, org.id)
    if config is None or not config.enabled:
        raise _sso_error("sso_not_enabled", "SSO is not enabled for this organization")

    adapter = get_adapter(config.provider)
    if adapter is None or not adapter.available(config.provider_config):
        raise _sso_error("sso_misconfigured", "SSO is not configured correctly")

    state = issue_state_token(
        org_slug=org_slug,
        provider=config.provider,
        return_url=_safe_redirect_url(return_url),
    )

    try:
        authz_url, state_extra = await adapter.build_authorization_url(
            redirect_uri=_callback_url(request),
            state=state,
            config=config,
            request=request,
        )
    except Exception as exc:
        logger.exception("Failed to build SSO authorization URL for %s", org_slug)
        raise _sso_error("sso_misconfigured", "SSO is not configured correctly") from exc

    if state_extra:
        state = issue_state_token(
            org_slug=org_slug,
            provider=config.provider,
            return_url=_safe_redirect_url(return_url),
            state_extra=state_extra,
        )

    return {"authorization_url": authz_url, "state": state}


# ---------------------------------------------------------------------------
# E9 — callback (complete login)
# ---------------------------------------------------------------------------

@router.get("/callback")
@router.post("/callback")
async def callback(
    request: Request,
    response: Response,
    code: str | None = Query(None),
    state: str | None = Query(None),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.security.rate_limiting import check_login_rate_limit

    allowed, retry_after = check_login_rate_limit(request)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "error_code": "rate_limited",
                "error_description": f"Too many requests. Retry in {retry_after // 60} minutes.",
                "retry_after": retry_after,
            },
        )

    if not code or not state:
        raise _sso_error("missing_params", "Missing required parameters")

    try:
        state_payload = consume_state_token(state)
    except ValueError as exc:
        raise _sso_error(str(exc), "Your SSO session is invalid or has expired")

    org_slug = state_payload.get("sub")
    provider = state_payload.get("provider")
    return_url = state_payload.get("return_url", "")
    state_extra = state_payload.get("extra") or {}

    org = await resolve_org_by_slug(db_session, org_slug)
    if org is None or await is_demo_org(org.id, db_session):
        raise _sso_error("sso_not_enabled", "SSO is not enabled for this organization")

    config = await _get_config(db_session, org.id)
    if config is None or not config.enabled:
        raise _sso_error("sso_not_enabled", "SSO is not enabled for this organization")

    adapter = get_adapter(provider)
    if adapter is None or not adapter.available(config.provider_config):
        raise _sso_error("sso_misconfigured", "SSO is not configured correctly")

    try:
        identity = await adapter.exchange_code(
            code=code,
            state_extra=state_extra,
            config=config,
            request=request,
        )
    except Exception as exc:
        logger.exception("SSO token exchange failed for org %s", org.id)
        raise _sso_error(
            "token_exchange_failed",
            "Failed to authenticate with the identity provider",
            provider=provider,
        ) from exc

    # Domain check.
    if not email_domain_allowed(identity.email, config.domains or []):
        raise _sso_error(
            "email_domain_rejected",
            "Your email domain is not allowed for this organization",
            http_status=403,
            provider=provider,
        )

    # Reconcile / provision.
    try:
        user, created = await find_or_provision_user(
            identity=identity,
            org=org,
            config=config,
            request=request,
            db_session=db_session,
        )
    except SSOProvisionError as exc:
        raise _sso_error(
            exc.code,
            exc.message,
            http_status=403 if exc.code == "auto_provision_disabled" else 400,
            provider=provider,
        ) from exc

    # Issue session via the existing machinery (handles MFA challenge).
    from src.services.auth.session import issue_session_or_challenge

    issue = await issue_session_or_challenge(
        db_session, user, amr="sso", org_id=org.id
    )
    if issue.mfa_required:
        return {"mfa_required": True, "mfa_token": issue.mfa_token}

    set_auth_cookies(response, issue.access_token, issue.refresh_token, request)

    from src.db.user_audit_events import UserAuditEventType
    from src.db.users import UserRead
    from src.services.audit.audit import record_audit_event
    from src.services.security.rate_limiting import get_client_ip

    await record_audit_event(
        event_type=UserAuditEventType.LOGIN,
        user_id=user.id or 0,
        ip=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"method": "sso", "provider": provider, "created": created},
    )

    return {
        "user": UserRead.model_validate(user).model_dump(mode="json"),
        "tokens": {
            "access_token": issue.access_token,
            "refresh_token": issue.refresh_token,
            "expiry": get_token_expiry_ms(),
        },
        "redirect_url": _safe_redirect_url(return_url),
        "org_slug": org_slug,
    }
