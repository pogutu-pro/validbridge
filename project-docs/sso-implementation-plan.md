# ValidBridge — SSO Backend Implementation Plan

> Status: **spec / ready to implement**
> Purpose: a complete, self-contained build plan. An AI engineer with repo access
> can implement from this doc alone. Nothing here is exploratory — every file
> path, function anchor and contract below already exists or is prescribed.

---

## 0. Summary

Build the full **SSO backend** that the frontend already expects, so org admin
users can enable single sign-on (WorkOS + custom OIDC first, SAML deferred), and
end users can sign in to their org via their identity provider.

- **What ships:** DB model + Alembic migration, provider registry (WorkOS, OIDC,
  provider-info for Keycloak/Okta/Auth0/custom-SAML), state/token handling, an
  auth router with the exact 10 endpoints the frontend calls, account
  reconciliation + auto-provisioning, session issuance reusing the existing
  auth service, and full tests (a fake OIDC provider makes it CI-testable).
- **What does NOT ship:** native Keycloak / Okta / Auth0 / custom-SAML protocol
  adapters (deferred) and any frontend changes (already complete).
- **Effort estimate:** 2–3 days. Difficulty ~6/10; the risk is protocol
  correctness and real-IdP testing, both addressed below.

---

## 1. Ground truth (already in the repo — rely on these, don't reinvent)

| Anchor | Location |
|---|---|
| Frontend SSO client (types, endpoints, error codes) | `apps/web/services/auth/sso.ts` |
| Auth router mount prefix | `apps/api/src/router.py:94` (`v1_router.include_router(auth.router, prefix="/auth", tags=["auth"])`) |
| Session issuance / MFA challenge | `apps/api/src/services/auth/session.py` → `mint_session_tokens` (L83), `issue_session_or_challenge` (L101) |
| One-time signed token pattern (copy this) | `apps/api/src/services/auth/magic_login.py` → `issue_magic_login_token` (L44), `consume_magic_login_token` (L163), `_redis` (L56) |
| org_slug → org resolver | `apps/api/src/services/auth/magic_login.py` → `resolve_org` (L90) |
| User creation | `apps/api/src/services/users/users.py` → `create_user` (L169), `create_user_with_invite` (L341), `create_user_without_org` (L418) |
| Role resolution | `apps/api/src/services/roles/roles.py` |
| Rate limiting | `apps/api/src/services/security/rate_limiting.py` → `check_login_rate_limit`, `get_client_ip` |
| Auth helpers (token creation, current user) | `apps/api/src/security/auth.py` |
| Session-user dependency (rejects API tokens) | `apps/api/src/router.py:68` → `require_authenticated_user` |
| Demo-org handling to mirror | `apps/api/src/routers/audit_logs.py` |
| Frontend base URL | `getAPIUrl()` → `http(s)://<api>/api/v1/` so routes resolve to `/api/v1/auth/sso/...` |
| WorkOS SDK | already locked: `workos==10.3.0` in `apps/api/pyproject.toml:46` |

Frontend contract files you will be graded against, read fully before coding:
`apps/web/services/auth/sso.ts` (459 lines), and the SSO UI components
(`OrgEditSSO`, `app/auth/sso/callback`) — you must match their response shapes
exactly.

---

## 2. Scope decisions (do not expand)

1. **Providers trust, only two.** Implement two adapters for real: `workos` and
   `custom_oidc`. All six providers appear in the provider registry with
   `available: false` unless backend config exists. Keycloak/Okta/Auth0/custom
   SAML become "configure via WorkOS" in their `description`, or get a native
   OIDC preset later. **Do not write native SAML in this pass.**
2. **Secrets are never stored in plaintext.** Custom OIDC is BYOK: the org's
   `SSOConfig.provider_config` may carry `issuer_url` / `client_id` /
   `client_secret` / `scopes`. The `client_secret` is Fernet-encrypted at rest
   (`src/security/secret_crypto.py`) and is **never returned** to the client
   (read responses omit it; an empty value on update keeps the stored secret).
   Non-secret endpoints/issuer are stored plaintext. WorkOS credentials
   (`client_id`/`client_secret`) stay in `config.yaml`/env; the org supplies only
   its non-secret `organization_id`. (Superseded §2's original blanket ban — the
   frontend collects a per-org OIDC secret, and the contract wins.)
3. **Reuse the existing auth/session machinery.** Never mint a session by any
   path other than `mint_session_tokens` / `issue_session_or_challenge`.
4. **Never emit an existing error code for a different meaning.** The frontend
   renders messages from the `error_code` you return (see §8 table).
5. **No frontend changes.** If a contract mismatch appears, the backend is
   wrong — fix the backend.

---

## 3. Data model

### 3.1 Table `sso_config`

Alembic migration: new version file under
`apps/api/migrations/versions/` (copy the style of the newest file there).

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `org_id` | int FK → `organization` **ON DELETE CASCADE** | config is meaningless without the org |
| `provider` | str | one of the six provider ids |
| `enabled` | bool, default `false` | |
| `domains` | JSON list of str | email domains allowed; store **lowercased, no leading `@`, no `www.`** |
| `auto_provision_users` | bool, default `false` | if false, unknown emails are rejected |
| `default_role_id` | int FK → `role` nullable **ON DELETE SET NULL** | fallback role for provisioned users |
| `provider_config` | JSON, default `{}` | non-secret values only (§2.2) |
| `created_at` / `updated_at` | datetime | |

Constraints:
- **Unique `(org_id, provider)`** — one active config per provider per org.
- **At most one enabled config per org** is *not* a hard constraint initially;
  the reader resolves the enabled one, and the CRUD layer warns when enabling a
  second provider (advise editing the existing one).

### 3.2 Demo teardown allowlist (REQUIRED)

`apps/api/src/tests/services/test_demo_teardown.py` has a `_SET_NULL_ALLOWED`
allowlist of (table, column) pairs checked against all FK columns. Register the
new FKs so teardown tests pass:

- `("sso_config", "org_id")` — cascade allowed
- `("sso_config", "default_role_id")` — set null allowed

The convention for naming tables/models: table `sso_config`, SQLModel class
`SSOConfig` in `apps/api/src/db/sso.py`. Source the model/file pattern from
`apps/api/src/db/payments/` or `apps/api/src/db/audit_logs.py`.

---

## 4. File-by-file build list

New backend files (create in this order; each builds on the last):

1. **`apps/api/src/db/sso.py`** — `SSOConfig` SQLModel (columns §3.1) and
   constants:
   - `SSO_PROVIDER_IDS = ("workos", "keycloak", "okta", "auth0",
     "custom_saml", "custom_oidc")`
   - payment-style `SSOErrorCode` literal/enum matching §8 exactly.
2. **`apps/api/migrations/versions/<id>_add_sso_config.py`** — migration per §3.
3. **`apps/api/src/services/sso/__init__.py`** — package.
4. **`apps/api/src/services/sso/providers/base.py`** — interface:
   - `provider_id`, `ProviderInfo` (match `SSOProviderInfo`/`ConfigField` shapes
     in `sso.ts`: `id, name, description, has_setup_portal, available,
     config_fields`, where `config_fields` entries are `name, type, required,
     description, placeholder?, hidden?`).
   - `async build_authorization_url(...) -> (url, state_extra)`
   - `async exchange_code(code, state_extra) -> Identity` where
     `Identity = { email, email_verified, name, provider, raw_id }`
   - `async get_setup_portal_url(...) -> str | None`
5. **`apps/api/src/services/sso/providers/workos.py`** — WorkOS adapter
   (SDK present). See `workos==10.3.0` docs. Redirect URI
   `{api_base}/v1/auth/sso/callback`. `has_setup_portal=True` →
   WorkOS Dashboard portal link from client id.
6. **`apps/api/src/services/sso/providers/oidc.py`** — generic OIDC adapter:
   discovery endpoint (optional, https-only) + authorization-endpoint /
   token-endpoint / userinfo flow; verify `id_token` signature (`iss`, `aud`,
   `nonce`) when issued. Reuse any JWT verification already in
   `src/security/auth.py` (`decode_jwt`).
7. **`apps/api/src/services/sso/providers/__init__.py`** — registry returning
   the six `ProviderInfo` objects; `available` =
   whether the adapter has the required config/environment present. Reading
   config must be lazy (import-time reads break tests that patch env).
8. **`apps/api/src/services/sso/state.py`** — one-time SSO state token. Copy the
   `magic_login.py` Redis/`itsdangerous` pattern: payload
   `{org_slug, return_url, provider, nonce, exp}`, single-use (burn on consume),
   short TTL (~10 min). On invalid/expired/reused state → `invalid_state` /
   `state_invalid_or_expired` (§8).
9. **`apps/api/src/services/sso/provision.py`** — reconciliation + provisioning
   (pure-ish, heavily unit-tested):
   - `resolve_org_by_slug` (wrap `magic_login.resolve_org`).
   - `email_domain_allowed(email, config.domains)` — normalize lowercase,
     exact match against domains list.
   - `find_or_provision_user(identity, org, config, request, db)`:
     1. match existing user by **email** in org;
     2. else if `auto_provision_users` → `create_user_with_invite`-style flow
        (or `create_user` with `is_oauth=True`, `signup_provider=<provider>`),
        skip password, prefer `auto_provision_users` semantics, record audit
        event via `src.services.audit.audit.record_audit_event`;
     3. else → `auto_provision_disabled` error.
   - resolve `default_role_id` from config; missing/bad role → org default role
     (see `src/services/roles/roles.py`).
10. **`apps/api/src/routers/sso.py`** — the router (§6). Endpoints rate-limited
    and guarded per §6. Mount on `v1_router` with
    `v1_router.include_router(sso.router, prefix="/auth", tags=["auth"])` in
    `apps/api/src/router.py` (mirror line 94; **not** inside the existing
    `auth.py`).
11. **`apps/api/src/services/sso/__init__.py`** — export the public helpers.
12. **Tests** (§9): `apps/api/src/tests/services/sso/…`,
    `apps/api/src/tests/routers/test_sso_router.py`,
    `apps/api/src/tests/db/test_sso_config.py`.

---

## 5. Configuration

Add to `apps/api/config/config.yaml` (and read via the existing config pattern
used by `config/config.py` — look at how the payments config keys were added,
then mirror):

```yaml
sso:
  enabled: true
  workos:
    client_id: ""            # VALIDBRIDGE_WORKOS_CLIENT_ID
    client_secret: ""        # VALIDBRIDGE_WORKOS_CLIENT_SECRET
    redirect_uri: ""
  oidc:
    client_id: ""            # VALIDBRIDGE_OIDC_CLIENT_ID
    client_secret: ""        # VALIDBRIDGE_OIDC_CLIENT_SECRET
    issuer: ""               # discovery, https only
    authorization_endpoint: ""
    token_endpoint: ""
    userinfo_endpoint: ""
    redirect_uri: ""
```

- Env vars (documented in `.env.example` with empty values).
- Provider `available` = required values non-empty.
- Expose a config getter in the config module (singleton, lazy) so tests can
  monkeypatch cleanly — same shape as the existing config accessors.

---

## 6. Endpoint specification

All under `/api/v1/auth/sso/…`. Match response/error shapes below to the letter.

### Admin endpoints (require `require_authenticated_user`; org-admin role check
inside, mirror `audit_logs.py`; demo org handled per the audit/demo convention —
demo org's `enabled` is force-false, no writes that affect real login)

| # | Method & path | Request | Response (200) |
|---|---|---|---|
| E1 | `GET /auth/sso/providers?org_id=` | org_id | `SSOProviderInfo[]` (six items; `config_fields` populated per adapter) |
| E2 | `GET /auth/sso/{org_id}/config` | — | `SSOConfig` **or 404 → the client treats 404 as `null`** |
| E3 | `POST /auth/sso/{org_id}/config` | `SSOConfigCreate` | created `SSOConfig` (201) |
| E4 | `PUT /auth/sso/{org_id}/config` | `SSOConfigUpdate` | updated `SSOConfig` |
| E5 | `DELETE /auth/sso/{org_id}/config` | — | 204 |
| E6 | `GET /auth/sso/{org_id}/setup-url?return_url=` | query | `{ "setup_url": str \| null }` |

`SSOConfigCreate/Update` field rules (from `sso.ts`):

```ts
interface SSOConfigCreate {
  provider: 'workos'|'keycloak'|'okta'|'auth0'|'custom_saml'|'custom_oidc'
  enabled?: boolean
  domains?: string[]          // normalize: lowercase, strip '@'/'www.'
  auto_provision_users?: boolean
  default_role_id?: number | null
  provider_config?: Record<string, any>   // non-secret only
}
```
- `default_role_id` must belong to `org_id` (reject otherwise).
- `domains` must be non-empty when `auto_provision_users` is true.
- Enabling a provider whose backend config is absent (`available: false`) →
  400 `sso_misconfigured`.

### Public endpoints (anonymous)

| # | Method & path | Request | Response |
|---|---|---|---|
| E7 | `GET /auth/sso/check?org_slug=` | query | `SSOLoginCheckResponse` `{ sso_enabled, provider }` |
| E8 | `GET /auth/sso/authorize?org_slug=` | query | `SSOAuthorizationResponse` `{ authorization_url, state }` — issue + stash state (§4.8), then build IdP URL |
| E9 | `GET/POST /auth/sso/callback?code=&state=` | query | `SSOCallbackResponse` (§7) |

E7–E9 are rate-limited with the existing login rate limiter
(`check_login_rate_limit`, keyed on IP + org). E8 errors when SSO is disabled
(`sso_not_enabled`) or misconfigured (`sso_misconfigured`).

---

## 7. Callback flow (E9) — the heart

Read top-to-bottom, in order:

1. **Rate limit** → 429.
2. **Validate presence** of `code` and `state` → `missing_params`.
3. **Consume `state`** (§4.8) → invalid/replayed/expired →
   `invalid_state` then `state_invalid_or_expired`.
4. **Resolve org** from `state.org_slug` via `magic_login.resolve_org` → missing
   → `sso_not_enabled`.
5. **Load config** (org, state.provider) and check `enabled` →
   `sso_not_enabled`.
6. **Exchange code** via the adapter (`workos` / `oidc`) → `Identity`. Failure →
   `token_exchange_failed`.
7. **Domain check** — `identity.email` domain vs `config.domains` →
   `email_domain_rejected` / `domain_not_allowed` (frontend maps both).
8. **Reconcile/provision** (§4.9) →
   - unknown email + `auto_provision_users=false` → `auto_provision_disabled`;
   - creation failure → `user_creation_failed`.
9. **Issue session** via existing session service:
   - call `issue_session_or_challenge` (handles MFA challenge automatically);
   - if a plain session is returned, respond with the SSO callback payload:
     ```ts
     {
       user: {...},                               // same shape other login routes return
       tokens: { access_token, refresh_token, expiry },
       redirect_url: string,                      // safe (see §8.4)
       org_slug?: string
     }
     ```
   - if MFA challenge is returned, mirror what the existing password/MFA login
     routes do at their callback/consume step so the client keeps working.
10. **Record audit event** (`record_audit_event`, `UserAuditEventType`) for the
    SSO login + any auto-provision.

All failures return the **structured error payload** (§8) — never a bare 500 for
an expected condition; log + 400/401/403 appropriately.

---

## 8. Error contract (frontend reads these — exact)

Shape: `HTTPException(detail={error, error_code, error_description,
provider?, details?})` — HTTP status 400 for bad params, 401/403 for auth/
domain denials. `error_description` should be human-readable (frontend fallback).

Codes the frontend already translates (`sso.ts:getErrorMessage`) — use these
exact strings, with these meanings:

| code | meaning | status |
|---|---|---|
| `sso_not_enabled` | org has no enabled SSO | 400/404 |
| `domain_not_allowed` / `email_domain_rejected` | email outside configured domains | 403 |
| `user_creation_failed` | provisioning failed | 500→ map to 400 w/ message |
| `token_exchange_failed` | code→token/profile failed | 401 |
| `invalid_state` | state missing/format invalid | 400 |
| `missing_params` | missing code/state | 400 |
| `state_invalid_or_expired` | state consumed/expired/replayed | 400 |
| `auto_provision_disabled` | unknown user, provisioning off | 403 |
| `sso_misconfigured` | provider backend config missing (also used by E3) | 400 |
| `callback_failed` | generic callback failure | 400 |

Do **not** invent new codes the frontend won't recognize; reuse the table. Log
the full error server-side; return the mapped code.

---

## 9. Testing strategy (make it CI-green without a real IdP)

### 9.1 Fake OIDC provider (primary)
A tiny in-repo test IdP (FastAPI app) under
`apps/api/src/tests/services/sso/fake_oidc.py`:
- `GET /authorize` → issues a `code` (signed/random) + redirects back to the
  configured callback;
- `POST /token` → swaps valid code for an `id_token` signed with a test RSA key;
- `GET /userinfo` → returns the fixture user (controllable email/verified).

Point an `oidc`-adapter `SSOConfig` at these URLs in tests (authorization/
token/userinfo endpoints all localhost). This exercises the *entire* E8→E9
round trip deterministically, including state validation, signature verification
via the same JWT path used in production.

### 9.2 Test files
- `src/tests/db/test_sso_config.py` — model constraints (unique org+provider,
  FK cascade/set-null via teardown).
- `src/tests/services/sso/test_state.py` — issue/consume once, expiry, tamper
  rejection, replay.
- `src/tests/services/sso/test_provision.py` — domain matcher (case/normalize),
  existing-user match, auto-provision on/off, role fallback, duplicate email.
- `src/tests/services/sso/test_providers.py` — WorkOS adapter with mocked SDK;
  OIDC adapter against the fake IdP (happy path + `token_exchange_failed` +
  signature-wrong rejection).
- `src/tests/routers/test_sso_router.py` — authz: anonymous → 401; API-token
  user rejected on E1–E6 (use `require_authenticated_user`); non-admin org user
  → 403; cross-org access denied; 404 semantics for E2; CRUD validation
  (unknown provider, bad `default_role_id`, `domains` rules, enabling an
  unconfigured provider → `sso_misconfigured`); E7/E8/E9 happy path via fake
  IdP; every error code in §8 reachable; rate-limit 429; redirect_url
  open-redirect rejection.
- **WorkOS manual checklist** (not CI): create sandbox WorkOS org, set env keys,
  E6 setup portal → create Connected SAML/OIDC app → E8 → IdP login → E9. Do
  this once before marking complete.

### 9.3 Commands
From `apps/api`:
- `uv run pytest <target files> -q`
- `uv run pytest src/tests/services/test_demo_teardown.py -q` (must stay green —
  validates §3.2 allowlist)
- `uv run --with ruff ruff check <new files>`
- Full suite when practical; the affected areas must be green before merge.

---

## 10. Ordered milestones + definition of done

- **M1 — Model + migration + teardown allowlist.** `SSOConfig`, migration, the
  Allowlist edit. **DoD:** teardown tests green.
- **M2 — Provider registry + state module.** Base interface, six `ProviderInfo`
  entries, `workos` + `oidc` adapters (SDK-mocked / fake-IdP), state token.
  **DoD:** provider + state unit tests green; ruff clean.
- **M3 — Admin CRUD (E1–E6).** Router + guards + validation. **DoD:**
  `test_sso_router.py` authz/CRUD green.
- **M4 — Public flow (E7–E9).** `provision.py`, callback flow, session reuse,
  error contract, audit events. **DoD:** fake-IdP round-trip green; error-code
  tests green.
- **M5 — Config/env wiring + demo-org handling.** `config.yaml` keys, `.env.example`,
  lazy getter, demo org behavior. **DoD:** admin + public tests still green with
  default config.
- **M6 — Verification + docs.** WorkOS sandbox manual pass; update `missing.md`
  §4.B status (every layer ✅) and move SSO row in the status table; full-suite
  run on affected areas.

Definition of done (all): every endpoint matches `sso.ts` shapes; no secret in
DB or logs; all §8 codes reachable and tested; MFA path verified through
`issue_session_or_challenge`; `test_demo_teardown` green; ruff clean; missing.md
updated.

---

## 11. Gotchas to respect

- **Provider breadth is the trap.** Ship the two adapters, present six provider
  cards. Do not gold-plate.
- **Secrets.** `provider_config` and any server logs must never contain a client
  secret. Use config/env only.
- **Open redirect.** `return_url`/`redirect_url` must be relative or same-origin
  (mirror the frontend's `safeExternalUrl` on the backend; if a helper exists in
  the API, reuse it). SSRF: custom OIDC endpoints must be https (localhost
  allowed for tests/dev).
- **Replay.** SSO state is single-use; the same `code` must not exchange twice
  (WorkOS/OIDC enforce this; don't cache successful exchanges).
- **Demo org.** Follow `audit_logs.py` demo handling; never let demo SSO
  actually gate demo login.
- **API-token users must not reach E1–E6** — use `require_authenticated_user`
  (router.py:68), not the OR-token dependency.
- **Rate limits** on E7–E9 reuse the existing login limiter — new limits or
  bypassing login limits will show up in security tests.
- **Timezone/format:** `created_at`/`updated_at` and everything serialized must
  match the rest of the API (ISO with `Z`).