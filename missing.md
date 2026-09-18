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
| SSO backend | ❌ |
| SCORM backend | ❌ |
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

---

## ✍️ Recent work log

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
| SSO | ✅ | ❌ | ❌ | ❌ |
| SCORM | ✅ | ❌ | ❌ | ❌ |
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
| Group sync (→ user groups) | 🚧 follow-up |
| Hosted billing portal | 🚧 follow-up |

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
2. ✅ Tests — `test_payments_service.py` (11: checkout, paywall, webhook
   grant/refund/cancel/renew, signature, idempotency) + demo-store tests (19).
3. ✅ Frontend — offer create/edit (subscription + interval), public offer page,
   subscribe/cancel in `AccountPurchases`, checkout sheet.
4. 🚧 Follow-up: (a) live smoke test with real Paystack test keys;
   (b) group `sync` endpoint wiring enrollments → `usergroups`;
   (c) hosted billing portal (currently the web cancel button + Paystack
   webhook cover cancellations).

### 🔐 B. SSO

| Layer | Status |
|---|:---:|
| Frontend (`services/auth/sso.ts`, `OrgEditSSO`, `app/auth/sso/callback`) | ✅ |
| Backend router / service / providers / model | ❌ |
| Implementation plan | ✅ `sso-implementation-plan.md` (ordered milestones, exact contracts, fake-IdP test strategy) |

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

**Steps:** add the `SSOConfig` model; implement a provider abstraction + adapter;
add the router; on callback validate, map domains, auto-provision, and issue the
session via the existing auth service; keep `sso` in `allowed_auth_methods`.

### 📚 C. SCORM

| Layer | Status |
|---|:---:|
| Frontend (`apps/web/ee/services/scorm/`, components, wired in `activity.tsx`, `client.tsx`) | ✅ |
| Backend proxy / analyze / import / runtime / results | ❌ |
| Activity enums (`TYPE_SCORM`, `SUBTYPE_SCORM_12`, `SUBTYPE_SCORM_2004`) | ✅ already present |

**Models to add** (AGPL core): version enum, completion-status enum, package,
SCO, SCO assignment, attempt/completion.

**API surface the frontend already calls:**

| Endpoint | Purpose |
|---|---|
| `GET /scorm/{path}` | serve package content (same-origin for the SCORM API bridge) |
| `POST /scorm/analyze/{courseUuid}` | inspect an uploaded package |
| `POST /scorm/analyze-for-import/{orgId}` | inspect before import |
| `POST /scorm/import/{courseUuid}` | attach package to a course |
| `POST /scorm/import-as-course` | create a course from a package |
| `GET /scorm/{activityUuid}/results` | learner results / grading |

**Runtime:** implement the SCORM 1.2 / 2004 client API
(Initialize / GetValue / SetValue / Commit / Finish) server-side; the frontend
`ScormRuntimeAPI.ts` bridges to it.

**Steps:** add `src/db/scorm/` models; parse `imsmanifest.xml`; store package
files via the media layer; create the SCORM activity; implement the proxy +
runtime + results; register the router on `v1_router`.

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
