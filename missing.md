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
| Payments backend | ❌ |
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
| Payments (orgs sell courses) | ✅ | ❌ | ❌ | ❌ |
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
| Backend router / services / models | ❌ |
| Paywall enforcement | ❌ |

**Models to add** (AGPL core; auto-registered by `database.py`):

| Suggested path | Records |
|---|---|
| `src/db/payments/offers.py` | offer |
| `src/db/payments/enrollments.py` | enrollment |
| `src/db/payments/groups.py` | group, group resources, group syncs |
| `src/db/payments/providers.py` | per-org provider credentials / config |
| `src/db/payments/offer_resources.py` | offer-to-resource links |

**API surface the frontend already calls:**

| Group | Endpoints |
|---|---|
| Config | `GET/POST/PUT/DELETE /payments/{orgId}/config` (`?id=`, `?provider=`) |
| Customers / enrollments | `GET /payments/{orgId}/customers`, `GET /payments/{orgId}/enrollments/mine` |
| Offers | `GET/POST /payments/{orgId}/offers`, `GET/PUT/DELETE /payments/{orgId}/offers/{offerId}` |
| Offer resources | `GET/POST/DELETE /payments/{orgId}/offers/{offerId}/resources` |
| Offer public | `GET /payments/{orgId}/offers/{offerId}/public`, `.../offers/public-listing`, `.../offers/by-resource` |
| Checkout | `GET /payments/{orgId}/offers/{offerUuid}/checkout` |
| Billing portal | `GET /payments/{orgId}/billing/portal` |
| Groups | `GET/POST /payments/{orgId}/groups`, `PUT/DELETE /payments/{orgId}/groups/{groupId}` |
| Group resources | `GET/POST/DELETE /payments/{orgId}/groups/{groupId}/resources` |
| Group sync (-> user groups) | `GET/POST/DELETE /payments/{orgId}/groups/{groupId}/sync` |
| Stripe overview | `GET /payments/{orgId}/stripe/overview`, `.../charges`, `.../subscriptions` |
| Stripe Connect | `GET /payments/{orgId}/stripe/connect/link`, `.../express/connect/link`, `.../express/connect/refresh`, `.../express/dashboard` |
| OAuth callback | `GET /payments/stripe/oauth/callback` |

**External dependency:** Stripe (Connect for platform-on-behalf-of-org selling).

**Steps:**

1. Add the models under `src/db/payments/`.
2. Add `src/services/payments/payments_stripe.py` (checkout, Connect, webhooks).
3. Add `src/services/payments/payments_access.py` and repoint
   `security/rbac/rbac.py` to it for paywall enforcement.
4. Add a payments router on `v1_router`.
5. Add Stripe webhook handling (checkout, subscription, Connect) to create
   enrollments and sync group membership.
6. Reuse the existing `usergroups` sync target.

### 🔐 B. SSO

| Layer | Status |
|---|:---:|
| Frontend (`services/auth/sso.ts`, `OrgEditSSO`, `app/auth/sso/callback`) | ✅ |
| Backend router / service / providers / model | ❌ |

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
| Frontend SSO | `apps/web/services/auth/sso.ts`, `components/Dashboard/Pages/Org/OrgEditSSO/` |
| Frontend SCORM | `apps/web/ee/services/scorm/`, `apps/web/ee/components/` |
| Frontend audit logs | `apps/web/components/Dashboard/Pages/Org/OrgAuditLogs/`, `apps/web/services/ee/audit_logs.ts` |
| Audit event table + write path (per-student dossier) | `apps/api/src/db/user_audit_events.py`, `apps/api/src/services/audit/audit.py` |
| Org-wide request audit log (viewer source) | `apps/api/src/db/audit_logs.py`, `apps/api/src/core/middleware/audit_log.py`, `apps/api/src/routers/audit_logs.py` |
| Advanced analytics | `apps/api/src/routers/analytics.py`, `apps/api/src/services/analytics/` |
