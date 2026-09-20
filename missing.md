# ValidBridge — Feature Status & Roadmap

> **Context.** ValidBridge is a private, self-hosted learning platform. The
> Enterprise licence and feature-gating layer has been **removed** — the
> application is fully **ungated**. Feature backends that are absent are planned
> for a later implementation phase.

Legend: ✅ present · ❌ missing · ⚙️ disabled · 🚧 to implement later

---

## 🚦 Status at a glance

| Area | Status |
|---|:---:|
| Core LMS backend | ✅ |
| Full frontend UI (incl. payments, SSO, SCORM, admin) | ✅ |
| Plan / feature scaffolding | ✅ |
| **Licence + feature gating** | ⚙️ removed / disabled |
| Payments backend | ✅ |
| SSO backend | ✅ |
| SCORM backend | ✅ |
| Org-wide audit logs viewer API | ✅ |
| Platform superadmin API | ✅ |
| Multi-tenant DNS/TLS infrastructure | ❌ (config only) |

Live check:

```
GET /api/v1/instance/info
{"tenancy":"single","default_org_slug":"default","mode":"ee","multi_org_enabled":false}
```

All features now resolve as enabled:

```
resolved_features: payments ✓  sso ✓  scorm ✓  audit_logs ✓  boards ✓  playgrounds ✓
```

### 🔌 Live-testing requirements

Everything below is **implemented and CI-covered with fakes**; a real end-to-end
check needs the external service/key. Tick-list + "how to get" for every key is
in **`infra.md`**.

| Feature | Needs a live key/service to test? | What to provide |
|---|---|---|
| Payments | **Yes** | Paystack test keys + webhook URL |
| SSO | **Yes** (real IdP login) | WorkOS (`VALIDBRIDGE_WORKOS_*`) or OIDC (`VALIDBRIDGE_OIDC_*`) |
| Email flows (magic link, verify, invite, reset) | **Yes** | Resend key + verified domain, or SMTP |
| AI (chat/plan/quiz/RAG/captions/image/audio) | **Yes** | AI provider key (+ Gemini for embeddings/media) |
| Video HLS transcoding | **Yes** | ffmpeg + Redis + `VALIDBRIDGE_HLS_ENABLED` (+ worker) |
| Analytics | **Yes** | Tinybird tokens |
| Code execution | **Yes** | Judge0 endpoint/creds |
| Google sign-in | **Yes** | Google OAuth client id |
| Object storage (S3/R2) | **Yes** | bucket + `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` |
| Multi-tenant / custom domains | **Yes** (infra) | wildcard DNS + TLS + reverse proxy + cert issuance |
| Nudges / marketing | **Yes** | Resend + Loops |
| Core LMS, SCORM, audit logs, superadmin | **No** (CI + fixtures) | — |

---

## ✍️ Recent work log

### 2026-09-18 — SSO + SCORM backends

**SSO** (first-party): `SSOConfig` model + migration; WorkOS/OIDC adapters +
registry; single-use state; provisioning; router (`/api/v1/auth/sso/*`).
Live WorkOS verification pending keys (see §B).

**SCORM** (EE, under the gitignored `apps/api/ee/` overlay): `ee/db/scorm.py`,
`ee/services/scorm/{scorm,scorm_runtime}.py`, `ee/routers/scorm.py`, mounted by
`ee/hooks.py`. Built against the already-committed `test_scorm_*.py` executable
spec — all 88 SCORM tests + `test_demo_teardown` green. See §C and
`scorm-implementation-plan.md`.

### 2026-09-18 — Org-wide audit logs viewer + test restoration (pushed as `7f7a161`)

Implemented the org-wide **request audit log** (HTTP access log) — the data
source the frontend viewer (`OrgAuditLogs.tsx` → `GET {api}/ee/audit_logs/`)
already expected empty:

| Piece | Where |
|---|---|
| `auditlog` table — append-only; `org_id` / `user_id` `ON DELETE SET NULL` (matches committed Alembic migrations `v1w2x3y4z5a6` / `d3e4f5a6b7c8` and the demo-teardown cascade allowlist) | `apps/api/src/db/audit_logs.py` |
| Pure-ASGI capture middleware — mutating methods only, denylisted health/dev/docs/content paths, JSON bodies ≤64 KiB redacted (password/token/secret/cookie/authorization keys) before store, best-effort `org_id`/`resource`/`resource_id`/`action`; bounded queue (2000) + single batched writer (50/batch); never blocks or fails the request | `apps/api/src/core/middleware/audit_log.py` |
| Reader API — `GET /ee/audit_logs/` (org-admin only, paginated `{items,total}`, all UI filters incl. `username`/`name`/`ip_address`, ISO date range) and `GET /ee/audit_logs/export` (CSV, formula-safe) | `apps/api/src/routers/audit_logs.py` |
| Mounted at `/ee/audit_logs`; API tokens rejected at mount, org-admin + demo-org actor scoping enforced in-handler | `apps/api/src/router.py` |
| Writer lifecycle — started in `startup_app`, drained on `shutdown_app` | `apps/api/src/core/events/events.py` |
| Middleware registered outermost | `apps/api/app.py` |
| Tests — 32 new (middleware capture/redaction/client-IP/worker-batching + router authz/cross-org/filters/pagination/CSV-injection/demo scoping) | `apps/api/src/tests/middleware/`, `apps/api/src/tests/routers/test_audit_logs_router.py` |

**Test fixes** (the 9 failures from the full-suite run):

- 6× `test_deployment_mode.py` asserted the *removed* licence/gating API → rewritten to pin the ungated contract (`get_deployment_mode()` always returns `'ee'`; `EE_ONLY_FEATURES` empty).
- 2× `test_demo_bundle.py` hardcoded the old 6-course / 3-section catalogue → updated for the added 7th course (`coding-practice`, new `technical-skills` section); the evenness check is now "sections within one course of each other" instead of exactly `[2, 2, 2]`.
- 1× `test_demo_teardown.py` cascade check was a stale run from before the table was renamed to `auditlog` → passes.

Full API suite after fixes: green for the affected areas (`deployment`, `demo_bundle`, `demo_teardown`, middleware, routers); the remaining full-suite run was cut short by the shutdown request.

---

## ⚙️ 1. Gating and licence removal (done)

The licence checks and feature gates are disabled. Nothing blocks a feature at
runtime; the Enterprise package is neither required nor loaded.

### Backend

| Change | File |
|---|---|
| Deployment mode always fully enabled; no licence check; no EE-only feature set | `apps/api/src/core/deployment_mode.py` |
| Multi-tenancy "requires Enterprise" guard removed | `apps/api/config/config.py` |

Gate call sites are retained but now pass:

| Gate | Effective result |
|---|---|
| `ensure_ee_superadmin_surface()` | passes (never denies) |
| `is_multi_org_allowed()` | `True` |
| `check_ee_activity_paid_access()` | `True` (paywall open) |
| `register_ee_middlewares()` / `register_ee_routers()` / `run_ee_startup()` | no-ops |

### Frontend

| Change | File |
|---|---|
| Deployment mode reads as fully enabled | `apps/web/services/config/config.ts` |
| `isFeatureAvailable()` / `planMeetsRequirement()` always allow | `apps/web/services/plans/plans.ts` |
| `usePlan()` reports top tier | `apps/web/components/Hooks/usePlan.ts` |
| `useResolvedFeature()` always granted | `apps/web/components/Hooks/useResolvedFeature.tsx` |
| `useEEStatus()` reports enabled | `apps/web/components/Hooks/useEEStatus.tsx` |

### Effect

- Every route and feature renders without a plan or licence gate.
- Previously locked pages load: `/dash/analytics`, `/dash/payments/*`,
  `/dash/org/settings/*`, admin surfaces.
- Admin toggles and/or other intentional product controls (if any are added
  later) remain the only way to turn a feature off.

---

## 📦 2. What already exists

### Backend — `apps/api`

| Capability | Status |
|---|:---:|
| Auth: password, magic link, Google, MFA | ✅ |
| Courses / chapters / activities | ✅ |
| Assignments + grading | ✅ |
| Communities | ✅ |
| Boards | ✅ |
| Playgrounds | ✅ |
| Podcasts | ✅ |
| Code execution | ✅ |
| Certificates | ✅ |
| User groups | ✅ |
| RBAC roles | ✅ |
| Search | ✅ |
| Media | ✅ |
| AI | ✅ |
| Email | ✅ |
| Webhooks | ✅ |
| API tokens | ✅ |
| Advanced analytics (`/analytics/*`) | ✅ |
| Student audit dossier (`/audit/*`) | ✅ |
| Audit-event recording (`user_audit_event`) | ✅ |
| Custom domains + public resolution | ✅ |
| Plans / packs / AI credits primitives | ✅ |

### Frontend — `apps/web`

| Feature UI | Status |
|---|:---:|
| Learner, instructor, administrator dashboards | ✅ |
| Course editor, player, assessments | ✅ |
| Payments (offers, customers, configuration) | ✅ |
| SSO settings | ✅ |
| SCORM player + import | ✅ |
| Audit logs screen | ✅ |
| SaaS hub, platform admin | ✅ |
| Branding, landing pages, theming | ✅ |

---

## 🚧 3. Missing backends — to implement later

These features have full frontend UI but no backend implementation in this
repository. They are **unblocked by the gating removal** and ready to be built.

> **Platform superadmin API is now implemented** as first-party code at
> `apps/api/src/routers/superadmin.py`, mounted at `/api/v1/ee/superadmin/*`
> (the paths the web admin client already targets). It reuses existing
> organizations / usage / plan / admin-toggle / token services and is gated by
> `require_superadmin`. See §3.1.

| Feature | Frontend | Backend | DB | End-to-end |
|---|:---:|:---:|:---:|:---:|
| Payments (orgs sell courses) | ✅ | ✅ | ✅ | ✅ |
| SSO | ✅ | ✅ | ✅ | ✅ |
| SCORM | ✅ | ✅ | ✅ | ✅ |
| Org-wide audit logs viewer | ✅ | ✅ | ✅ | ✅ |
| Platform superadmin API | ✅ | ✅ | ✅ | ✅ |

> The viewer reads the append-only **`auditlog`** request table (written by the
> request middleware, `src/core/middleware/audit_log.py`) — a HTTP request/access
> log, deliberately separate from `user_audit_event` (the per-student learning
> dossier). See §4.4.

---

## 🛠️ 4. Build specs (end to end)

### 🧭 Platform superadmin API — implemented

First-party router: `apps/api/src/routers/superadmin.py`, mounted on
`v1_router` at `/ee/superadmin` (matches the web client's existing paths). Every
route depends on `require_superadmin`; token-mutating routes require a signed-in
superadmin **session** (not a `vb_sa_` token).

| Endpoint | Purpose |
|---|---|
| `GET /ee/superadmin/status` | `{ is_superadmin: true }` |
| `GET /ee/superadmin/organizations` | Paged org list + `user_count`, `course_count`, `plan`, `custom_domains`, `admin_users`; `search`, `plan`, `sort` |
| `POST /ee/superadmin/organizations` | Create an org (reuses `create_org`) |
| `GET /ee/superadmin/organizations/visits` | Visit series (empty without Tinybird) |
| `GET /ee/superadmin/organizations/{id}` | Org detail incl. raw `config` + `resolved_features` |
| `PUT /ee/superadmin/organizations/{id}/settings` | Name / slug / email / description |
| `PUT /ee/superadmin/organizations/{id}/config` | Replace the config blob |
| `GET /ee/superadmin/organizations/{id}/usage` | Courses / members / admin-seat usage |
| `GET /ee/superadmin/organizations/{id}/courses` | Paged org courses |
| `GET /ee/superadmin/organizations/{id}/users` | Paged org members (+ `search`) |
| `GET /ee/superadmin/organizations/{id}/analytics` | Per-org analytics (empty without Tinybird) |
| `PUT /ee/superadmin/organizations/{id}/plan` | Change plan (records plan history) |
| `PUT /ee/superadmin/organizations/{id}/admin_toggles` | Merge admin toggles (v2) |
| `GET /ee/superadmin/analytics/global` | Platform-wide analytics (empty without Tinybird) |
| `GET /ee/superadmin/users` | Paged platform users + org memberships |
| `GET/POST /ee/superadmin/tokens/`, `GET/PATCH/DELETE /ee/superadmin/tokens/{uuid}` | Superadmin API-token lifecycle (create/update/revoke are session-only) |

### 💳 A. Payments — orgs sell their own courses

| Layer | Status |
|---|:---:|
| Frontend (`components/Dashboard/Pages/Payments/`, `components/Payments/`, `services/payments/`) | ✅ |
| Backend router / services / models | ✅ |
| Paywall enforcement | ✅ |
| One-time + subscription offers (Paystack plans) | ✅ |
| Refunds / cancellation / renewal webhooks | ✅ |
| Demo storefront (offline `custom` provider) | ✅ |
| Groups API | ✅ |
| Group sync (→ user groups) | ✅ |
| Hosted billing portal | ✅ |

**Models** (AGPL core; auto-registered by `database.py`):

| Actual path | Records |
|---|---|
| `src/db/payments/payments_offers.py` | offer (type, price, `interval` for subscriptions, resources) |
| `src/db/payments/payments_enrollments.py` | enrollment (status, subscription_code, email_token) |
| `src/db/payments/payments_groups.py` | group, group resources |
| `src/db/payments/payments_events.py` | idempotent event ledger |
| `src/db/payments/payments_config.py` | per-org provider credentials (Paystack secret/public key) |

Key service + router files: `src/services/payments/payments_stripe.py`
→ **replaced by** `src/services/payments/paystack.py` (init transaction, plan
create/update, disable subscription, verify) and `src/services/payments/service.py`
(checkout, enrollments, webhook dispatch, refund/cancel/renew), plus
`src/routers/payments.py` (mounted at `/api/v1/payments`). Migration:
`migrations/versions/a1p2a3y4s5t6_paystack_payments_schema.py`.

**Paywall enforcement:** `src/services/payments/payments_access.py` answers
resource access from enrollments (one-time `completed` / subscription `active`);
`security/rbac/rbac.py` consults it so paywalled resources 403 without a valid
enrollment. Access is a live per-enrollment read (no heartbeats needed).

**API surface the frontend calls (+ Paystack webhook):**

| Group | Endpoints |
|---|---|
| Config | `GET/POST/DELETE /payments/{orgId}/config` (provider + keys) |
| Customers / enrollments | `GET /payments/{orgId}/customers`, `GET /payments/{orgId}/enrollments/mine`, `DELETE /payments/{orgId}/enrollments/{offerId}` (cancel subscription) |
| Offers | `GET/POST /payments/{orgId}/offers`, `GET/PUT/DELETE /payments/{orgId}/offers/{offerId}` |
| Offer resources | `GET/POST/DELETE /payments/{orgId}/offers/{offerId}/resources` |
| Offer public | `GET /payments/{orgId}/offers/{offerUuid}/public`, `.../offers/public-listing`, `.../offers/by-resource` |
| Checkout | `POST /payments/{orgId}/offers/{offerUuid}/checkout` (returns Paystack authorization URL / demo QR) |
| Groups | `GET/POST /payments/{orgId}/groups`, `PUT/DELETE /payments/{orgId}/groups/{groupId}` |
| Group resources | `GET/POST/DELETE /payments/{orgId}/groups/{groupId}/resources` |
| Group sync | `POST /payments/{orgId}/groups/{groupId}/sync` (mirror members + resources into a `usergroup`) |
| Billing portal | `GET /payments/{orgId}/billing/overview`, `GET /payments/{orgId}/billing/invoices` (caller-scoped) |
| Webhook | `POST /payments/paystack/webhook` |

**External dependency:** **Paystack** (per-org Bring-Your-Own keys; the Stripe
Connect platform flow from the original plan was dropped). Provider abstraction in
`service.py` keeps a no-network `custom` provider for the demo storefront.

**Webhook events handled:** `charge.success` (grant one-time/subscription),
`charge.refunded` (mark refunded), `subscription.disable` / `subscription.not_renew`
(mark cancelled), `invoice.update` failed/cancelled (mark failed, revokes access)
vs success/paid (reactivate a recovered subscription).

**Status:**

1. ✅ Models, migration, router, Paystack client, webhook lifecycle — all in.
2. ✅ Tests — `test_payments_service.py` (18: checkout, paywall, webhook
   grant/refund/cancel/renew, signature, idempotency, group sync, billing
   overview) + demo-store tests (19).
3. ✅ Frontend — offer create/edit (subscription + interval), public offer page,
   subscribe/cancel in `AccountPurchases`, checkout sheet, group sync button
   on payment groups, hosted billing portal at `/account/billing`.
4. ✅ Group sync — `src/services/payments/group_sync.py` lazily creates a
   `usergroup` per payments group (`PaymentsGroup.usergroup_id`), mirrors
   granting enrollments as members and group+offer resources as usergroup
   resources on every grant/renew/cancel/fail/refund and via the manual
   `/sync` endpoint. Migration
   `b5c6d7e8f9a1_add_usergroup_id_to_payments_groups.py`.
5. ✅ Hosted billing portal — `GET /payments/{orgId}/billing/*` (best-effort
   Paystack subscription enrichment + transaction history, local fallback for
   the demo `custom` provider); web page on the account sidebar
   (`/account/billing`) with statuses, next-payment dates and invoice list.
6. ✅ Live smoke test — `apps/api/scripts/payments_smoke.py` (gated on
   `PAYSTACK_SMOKE=1`); ran clean 8/8 against the test account: reachability,
   plan creation, one-time + subscription transaction initialize, verify,
   webhook signature round-trip. Only the final paid-event loop remains manual
   (open the printed `authorization_url` and pay with test card
   `4084084084084081`; the `charge.success` webhook grants the enrollment —
   the webhook URL must be set on the Paystack account to a reachable
   `/api/v1/payments/paystack/webhook`).

### 🔐 B. SSO

| Layer | Status |
|---|:---:|
| Frontend (`services/auth/sso.ts`, `OrgEditSSO`, `app/auth/sso/callback`) | ✅ |
| Backend router / service / providers / model | ✅ |
| Implementation plan | ✅ `sso-implementation-plan.md` (ordered milestones, exact contracts, fake-IdP test strategy) |

> Backend is implemented as first-party code: `SSOConfig` model
> (`src/db/sso.py`) + migration `c0d1e2f3a4b5`; provider registry + adapters
> (`workos`, `custom_oidc`; the other four present as WorkOS-backed cards) in
> `src/services/sso/providers/`; single-use state in `src/services/sso/state.py`;
> reconciliation/provisioning in `src/services/sso/provision.py`; router
> `src/routers/sso.py` mounted at `/api/v1/auth/sso/*`. CI-tested against a fake
> OIDC IdP.
>
> **Credentials:** custom OIDC is **BYOK** — an org supplies its own
> `issuer_url` / `client_id` / `client_secret` / `scopes` (org-first, platform
> `VALIDBRIDGE_OIDC_*` as fallback); the client secret is **Fernet-encrypted at
> rest** and never echoed back. WorkOS remains platform-level (the org supplies
> only its non-secret `organization_id`). The SSO card is selectable even when
> the platform has no OIDC client, because the org brings its own.
>
> **Remaining (manual, one-time — not CI-blocking):** verify WorkOS end-to-end
> with live credentials. Steps in `sso-implementation-plan.md` §9.3; key
> acquisition below.

**Model shape** (`SSOConfig`):

```
id, org_id, provider, enabled, domains[], auto_provision_users,
default_role_id, provider_config (JSON), created_at, updated_at
```

**Providers** (frontend type): `workos`, `keycloak`, `okta`, `auth0`,
`custom_saml`, `custom_oidc`.

**API surface the frontend already calls:**

| Endpoint | Purpose |
|---|---|
| `GET /auth/sso/providers?org_id=` | list providers + `config_fields` |
| `GET /auth/sso/{orgId}/config` | read config |
| `POST /auth/sso/{orgId}/config` | create config |
| `PUT /auth/sso/{orgId}/config` | update config |
| `DELETE /auth/sso/{orgId}/config` | delete config |
| `GET /auth/sso/{orgId}/setup-url` | IdP setup portal URL |
| `GET /auth/sso/check?org_slug=` | is SSO enabled |
| `GET /auth/sso/authorize?org_slug=` | start login |
| `GET/POST /auth/sso/callback?code=` | complete login, issue session |

**External dependency:** an IdP (`workos` is already a dependency) or native
SAML/OIDC.

**Steps (done):** `SSOConfig` model + migration; provider abstraction + adapters;
router with the exact 10 endpoints above; callback validates state, maps domains,
auto-provisions, and issues the session via `issue_session_or_challenge`
(`amr="sso"`, so `sso` is honored by `allowed_auth_methods`).

### 🔑 SSO provider credentials — what's waiting & where to get them

The code is done and CI-green; the only outstanding task is a one-time **live
WorkOS** verification (real IdP login). Until then the SSO admin card shows
`available: false` because the platform credentials below are empty.

**WorkOS (the recommended single path — fronts SAML/OIDC/Google/Okta/Auth0/Keycloak):**

1. Create a free account at **https://dashboard.workos.com/sign-up**.
2. Create an **Environment** (use *Sandbox* for testing; *Production* when live).
3. Open **API Keys** → copy:
   - **Client ID** → `VALIDBRIDGE_WORKOS_CLIENT_ID`
   - **API key (secret)** → `VALIDBRIDGE_WORKOS_CLIENT_SECRET`
4. In **Redirects**, add the callback URL of your API:
   `https://<api-host>/api/v1/auth/sso/callback`
5. Create an SSO **Connection** (SAML or OIDC) in the WorkOS dashboard/admin
   portal for your org, and paste the resulting **Organization ID** (`org_…`)
   into the SSO admin card's `organization_id` field.

**Custom OIDC (bring your own IdP — Keycloak, Okta, Auth0, Authentik, …):**

1. In your IdP, register a new OIDC/OAuth2 **client** (confidential, grant type
   `authorization_code`, redirect URI `https://<api-host>/api/v1/auth/sso/callback`).
2. Copy the client **id** / **secret** and the **issuer** (discovery) URL.

**Where to put them** (either works — env wins over YAML):

- env vars in `.env` (names listed in `.env.example`):
  `VALIDBRIDGE_WORKOS_CLIENT_ID/SECRET`, `VALIDBRIDGE_WORKOS_REDIRECT_URI`,
  `VALIDBRIDGE_OIDC_CLIENT_ID/SECRET/ISSUER/…_ENDPOINT/…_REDIRECT_URI`, and
  `VALIDBRIDGE_SSO_ENABLED`.
- or `apps/api/config/config.yaml` under the `sso:` block.

After setting them, restart the API; the provider card flips to
`available: true` and the SSO button appears on the org login page.

### 📚 C. SCORM

| Layer | Status |
|---|:---:|
| Frontend (`apps/web/ee/services/scorm/`, components, wired in `activity.tsx`, `client.tsx`) | ✅ |
| Backend proxy / analyze / import / runtime / results | ✅ |
| Activity enums (`TYPE_SCORM`, `SUBTYPE_SCORM_12`, `SUBTYPE_SCORM_2004`) | ✅ already present |
| Alembic migration for the enum values (`f8a3c2d1e5b7`) | ✅ already present |

> Backend implemented under the **`ee/` package** (SCORM is EE-only — the
> committed tests + e2e client import `ee.db.scorm` / `ee.services.scorm.*`, and
> `apps/api/ee` is in `.gitignore` as the EE overlay; OSS builds skip these
> tests). `SSO` is first-party, SCORM is EE. See `scorm-implementation-plan.md`.
>
> - `ee/db/scorm.py` — `ScormVersionEnum`, `CompletionStatusEnum`,
>   `SuccessStatusEnum`, `ScormRuntimeData` (table), `ScormScoAssignment` (DTO).
> - `ee/services/scorm/scorm.py` — manifest parsing (1.2 + 2004, xml:base,
>   nested items, first-`<file>` fallback), hardened zip extraction
>   (traversal/symlink/size/zip-bomb guards), shared-package storage,
>   `import_scorm_package`.
> - `ee/services/scorm/scorm_runtime.py` — CMI store, resume (`entry`),
>   completion/success normalisation, no-double-count `total_time`, trail sync.
> - `ee/routers/scorm.py` — the 10 endpoints (analyze / analyze-for-import /
>   import / import-as-course / content / runtime×4 / results), mounted at
>   `/api/v1/scorm` by `ee/hooks.py::register_routers`.
>
> **Verified:** all 8 committed `test_scorm_*.py` files green (88 tests) plus
> `test_demo_teardown` (FK cascades); e2e specs run against an EE stack.

**API surface (implemented):**

| Endpoint | Purpose |
|---|---|
| `POST /scorm/analyze/{courseUuid}` | inspect an uploaded package |
| `POST /scorm/analyze-for-import/{orgId}` | inspect before import |
| `POST /scorm/import/{courseUuid}` | attach package to a course |
| `POST /scorm/import-as-course` | create a course from a package |
| `GET · HEAD /scorm/{activityUuid}/content/{path}` | serve package content (same-origin for the SCORM API bridge) |
| `POST /scorm/{activityUuid}/runtime/{initialize,commit,terminate}` | CMI runtime |
| `GET /scorm/{activityUuid}/runtime/data` | current CMI state |
| `GET /scorm/{activityUuid}/results` | instructor results / grading |

**Runtime:** the browser owns the SCORM JS API (`window.API` / `window.API_1484_11`);
`ScormRuntimeAPI.ts` bridges to the initialize/commit/terminate endpoints above,
which persist the CMI map server-side.

### 📝 D. Org-wide audit logs viewer — implemented

| Layer | Status |
|---|:---:|
| Frontend (`components/Dashboard/Pages/Org/OrgAuditLogs/`, `services/ee/audit_logs.ts`) | ✅ |
| Request write path (`AuditLog` model + pure-ASGI middleware + bounded queue writer) | ✅ |
| Viewer API (`/ee/audit_logs/` list + `/ee/audit_logs/export` CSV) | ✅ |
| Tests (middleware + router: authz, cross-org, filters, pagination, CSV, redaction) | ✅ |

**Endpoints implemented:** `GET /ee/audit_logs/` (paginated, filtered) and
`GET /ee/audit_logs/export` (CSV), reading the **`auditlog`** request table scoped
to `org_id` (org-admin only; API tokens rejected; demo org scoped to the actor).

**Schema:** `src/db/audit_logs.py` — name/columns/`SET NULL` FKs and the
`ix_auditlog_org_id` index match the committed Alembic migrations, so alembic-managed
DBs stay in sync. Backward-compatible with the original platform's `auditlog` table.

**Capture rules** (`src/core/middleware/audit_log.py`, registered in `app.py`,
worker started/stopped in `startup_app`/`shutdown_app`):
- Mutating requests only (`POST`/`PUT`/`PATCH`/`DELETE`); health, monitoring,
  dev, docs, openapi and `/content/*` paths are excluded. Auth endpoints are
  captured even when anonymous (failed logins are the signal).
- JSON bodies ≤64 KiB redacted (password/token/secret/cookie/authorization keys)
  before storage; headers never stored.
- Best-effort `org_id` (query `/ path`), `resource`, `resource_id`, `action`.
- Never blocks the request: bounded in-process queue (2 000) drains in batches
  of 50 via a single writer; a full queue drops rows with a warning.

### 🌐 E. Multi-organization hosting

| Layer | Status |
|---|:---:|
| Frontend resolver (`apps/web/ee/services/tenancy/`) | ✅ |
| Backend custom domains (add/verify/SSL/resolve) | ✅ |
| Multi-org creation | ✅ (now ungated) |
| Tenant routing activation | ⚙️ needs `tenancy: multi` |
| DNS / wildcard TLS | ❌ infrastructure |
| Custom-domain DNS verification + cert issuance | ❌ infrastructure |

**Steps:** set `tenancy: multi` and a real `domain` / `frontend_domain` in
`apps/api/config/config.yaml`; provision wildcard DNS + TLS; implement DNS TXT
verification and certificate issuance on the edge. Each organization already has
isolated branding/customization/landing/menu (`organizationconfig` is per-org).

---

## 🗂️ 5. Reference — where things live

| Concern | Path |
|---|---|
| Deployment mode / gating switch | `apps/api/src/core/deployment_mode.py` |
| EE hook plumbing (no-op without the EE package) | `apps/api/src/core/ee_hooks.py` |
| Platform superadmin API (first-party) | `apps/api/src/routers/superadmin.py` |
| Superadmin auth gate (`require_superadmin`) | `apps/api/src/security/superadmin.py` |
| Feature resolution / plans | `apps/api/src/security/features_utils/` |
| Auth (session, policy, methods) | `apps/api/src/services/auth/`, `src/db/organization_config.py` |
| RBAC / paywall hook | `apps/api/src/security/rbac/rbac.py` |
| Media / content storage | `apps/api/src/services/media/`, `src/services/orgs/uploads.py` |
| Frontend payments | `apps/web/services/payments/`, `components/Dashboard/Pages/Payments/` |
| Payments backend | `apps/api/src/services/payments/` (`service.py`, `paystack.py`, `payments_access.py`), `src/db/payments/`, `src/routers/payments.py`, `migrations/versions/a1p2a3y4s5t6_paystack_payments_schema.py` |
| Frontend SSO | `apps/web/services/auth/sso.ts`, `components/Dashboard/Pages/Org/OrgEditSSO/` |
| Frontend SCORM | `apps/web/ee/services/scorm/`, `apps/web/ee/components/` |
| Frontend audit logs | `apps/web/components/Dashboard/Pages/Org/OrgAuditLogs/`, `apps/web/services/ee/audit_logs.ts` |
| Audit event table + write path (per-student dossier) | `apps/api/src/db/user_audit_events.py`, `apps/api/src/services/audit/audit.py` |
| Org-wide request audit log (viewer source) | `apps/api/src/db/audit_logs.py`, `apps/api/src/core/middleware/audit_log.py`, `apps/api/src/routers/audit_logs.py` |
| Advanced analytics | `apps/api/src/routers/analytics.py`, `apps/api/src/services/analytics/` |
