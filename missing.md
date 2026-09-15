# ValidBridge — Missing Features & Build Roadmap

> **Context.** ValidBridge is a private, self-hosted learning platform. A handful
> of advanced features are intentionally gated behind a separate **Enterprise
> (EE)** package that is not part of this repository. This document specifies
> what already exists, what is missing, and exactly what it takes to build each
> gated feature so it works end to end.
>
> **Licensing.** The Enterprise licensing checks are kept intact and are **not**
> bypassed. Required functionality is reimplemented independently as first-party
> code (see §1).

Legend: ✅ present · ❌ missing · ⚠️ partial / gated · 🔧 to build

---

## 🚦 Master status

| Feature                                                                                                                                             |       License       | Frontend | Backend | DB  |    End-to-end     |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | :-----------------: | :------: | :-----: | :-: | :---------------: |
| Core LMS (courses, assignments, communities, boards, playgrounds, podcasts, code, certificates, roles, search, webhooks, API tokens, AI) + branding |        AGPL         |    ✅    |   ✅    | ✅  |        ✅         |
| Plan / feature / packs / billing primitives                                                                                                         |        AGPL         |    ✅    |   ✅    | ✅  |        ✅         |
| Custom domains + resolution                                                                                                                         |        AGPL         |    ✅    |   ✅    | ✅  |        ✅         |
| Audit-event recording (`user_audit_event`)                                                                                                          |        AGPL         |    —     |   ✅    | ✅  |        ✅         |
| Advanced analytics (`/analytics/*`)                                                                                                                 |  AGPL, declared EE  |    ✅    |   ✅    | ✅  | ⚠️ license-gated  |
| Student audit dossier (`/audit/*`)                                                                                                                  |  AGPL, declared EE  |    ✅    |   ✅    | ✅  | ⚠️ license-gated  |
| Multi-organization hosting                                                                                                                          | AGPL, license-gated |    ✅    |   ⚠️    | ✅  | ⚠️ config + infra |
| **Org-wide audit logs** (`/ee/audit_logs`)                                                                                                          |         EE          |    ✅    |   ❌    | ✅  |  ❌ reimplement   |
| **Platform superadmin** (`/ee/superadmin`)                                                                                                          |         EE          |    ✅    |   ❌    | ⚠️  |  ❌ reimplement   |
| **Payments** (`/payments/*`)                                                                                                                        |         EE          |    ✅    |   ❌    | ❌  |  ❌ reimplement   |
| **SSO** (`/auth/sso/*`)                                                                                                                             |         EE          |    ✅    |   ❌    | ❌  |  ❌ reimplement   |
| **SCORM** (`/scorm/*`)                                                                                                                              |         EE          |    ✅    |   ❌    | ❌  |  ❌ reimplement   |

> **Two different "audit" surfaces exist — do not confuse them:**
>
> - **Student audit dossier** (`/api/v1/audit/user/{id}`, `/audit/users/summary`,
>   `/audit/export`) — per-learner record. Implementation present in the AGPL
>   repo (`routers/audit.py`). Designated Enterprise (`analytics_advanced`); do
>   not bypass — license or reimplement.
> - **Org-wide audit logs** (`/api/v1/ee/audit_logs`, `/ee/audit_logs/export`) — the
>   admin event log. The event **table + write path are AGPL** (`UserAuditEvent`,
>   `record_audit_event`); the **viewer API is Enterprise** and must be
>   reimplemented first-party.

Live proof of current state:

```
GET /api/v1/instance/info
{"tenancy":"single","default_org_slug":"default","frontend_domain":"localhost:3000","top_domain":"localhost","mode":"oss","multi_org_enabled":false}
```

---

## ⚖️ 1. Licensing boundary and compliant approach

> This is a technical/licensing-surface audit, not legal advice. Confirm the
> classification with counsel before acting.

### 1.1 License basis

| Artifact                            | Location                        | License                                             |
| ----------------------------------- | ------------------------------- | --------------------------------------------------- |
| Application code in this repository | everything except `apps/api/ee` | GNU AGPL-3.0 (see `LICENSE`)                        |
| Enterprise package                  | `apps/api/ee`                   | separate, non-public license — **not present here** |

`.gitignore` declares the split:

```
# Enterprise Edition (private repo, overlaid at SaaS build time, symlinked locally)
apps/api/ee
```

The AGPL repository also contains **runtime gates** that mark certain surfaces as
Enterprise. These are product boundaries declared in code:

- `EE_ONLY_FEATURES = {"sso", "audit_logs", "payments", "analytics_advanced", "scorm"}`
- `/ee/*` API surface (`/ee/audit_logs`, `/ee/superadmin`, `/ee/status`)
- `ensure_ee_superadmin_surface()` → `403 ee_required` on OSS (`src/security/superadmin.py`)
- `is_multi_org_allowed()` → multi-org requires EE/SaaS
- `is_license_active()` on `apps/api/ee/hooks.py`

### 1.2 Do not bypass the licensing checks

The Enterprise licensing checks must remain intact. Do **not**:

- make `is_license_active()` return `True`,
- force `get_deployment_mode()` to `"ee"`,
- edit `EE_ONLY_FEATURES`, `ensure_ee_superadmin_surface`, or the `/ee/*` gates
  to unlock Enterprise surfaces.

### 1.3 Compliant path: independent, first-party reimplementation

The Enterprise package is not covered by this repository's AGPL grant. The
compliant route is therefore to **reimplement the required functionality as
ValidBridge's own first-party code**, integrated with the AGPL core, without
reusing the Enterprise surface or its license gate.

Build with:

- our own endpoints, models, and services (our own paths),
- our own configuration flags for gating (not the EE license),
- reuse of **AGPL core** primitives: auth/session, RBAC, orgs, media/content,
  user groups, email, the `user_audit_event` table, feature-resolution helpers,
- permitted **open-source libraries** for the domain logic (§2),
- our own (AGPL) frontend calling our endpoints.

Leave the Enterprise gates untouched: they keep returning `oss`, which is
correct because the Enterprise package is not being shipped or bypassed.

### 1.4 Feature classification

| Feature                                                                                                                                           | Implementation | Classification                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------- |
| Core LMS: courses, assignments, communities, boards, playgrounds, podcasts, code, certificates, roles, search, webhooks, API tokens, AI, branding | present        | **AGPL core**                                             |
| Plan / feature / packs / billing-usage primitives                                                                                                 | present        | **AGPL core**                                             |
| Headless API-token admin API (`/admin`)                                                                                                           | present        | **AGPL core**                                             |
| Custom domains (`/orgs/.../domains`, `/orgs/resolve/domain`)                                                                                      | present        | **AGPL core**                                             |
| Audit-event recording (`user_audit_event`, `record_audit_event`)                                                                                  | present        | **AGPL core**                                             |
| Advanced analytics (`/analytics/*`, `routers/analytics.py`)                                                                                       | present        | **AGPL code, declared Enterprise** (`analytics_advanced`) |
| Student audit dossier (`/audit/*`, `routers/audit.py`)                                                                                            | present        | **AGPL code, declared Enterprise** (`analytics_advanced`) |
| Org-wide audit logs viewer (`/ee/audit_logs`)                                                                                                     | absent         | **Enterprise — reimplement**                              |
| Platform superadmin API (`/ee/superadmin/*`, `/ee/status`)                                                                                        | absent         | **Enterprise — reimplement**                              |
| Payments (`/payments/*`, `ee.db.payments`, `ee.services.payments`)                                                                                | absent         | **Enterprise — reimplement**                              |
| SSO (`/auth/sso/*`)                                                                                                                               | absent         | **Enterprise — reimplement**                              |
| SCORM (`/scorm/*`, `ee.db.scorm`)                                                                                                                 | absent         | **Enterprise — reimplement**                              |
| License / manifest (`ee/hooks.py`)                                                                                                                | absent         | **Enterprise — do not bypass**                            |
| Multi-organization backend hooks                                                                                                                  | partial        | **AGPL present; license-gated**                           |

> **On "present but declared Enterprise":** the analytics and dossier code is
> physically in this AGPL repository, so the AGPL LICENSE covers it; the runtime
> gates mark it Enterprise by product design. Whether _using_ those gated
> features requires an Enterprise license depends on the applicable agreement,
> not on file location. Recommended: do not unlock by bypass — either license
> them, or reimplement independently.

---

## 🛠️ 2. Build specs (end to end)

### 📝 A. Org-wide audit logs — small first-party build

The event **storage exists in the AGPL core**; the Enterprise **viewer API is
absent** (the frontend currently calls the Enterprise `/ee/audit_logs`).

| Layer                                                                                  | Status |  License   |
| -------------------------------------------------------------------------------------- | :----: | :--------: |
| Frontend (`components/Dashboard/Pages/Org/OrgAuditLogs/`, `services/ee/audit_logs.ts`) |   ✅   |    AGPL    |
| DB model + durable write path (`UserAuditEvent`, `record_audit_event`)                 |   ✅   |    AGPL    |
| Enterprise viewer API (`/ee/audit_logs`, `/ee/audit_logs/export`)                      |   ❌   | Enterprise |

**Approach — first-party reimplementation, no bypass:**

1. Add a first-party router in the AGPL core (extend `routers/audit.py` or add a
   new module) mounted at our own path; query the existing `user_audit_event`
   table scoped to `org_id`, with pagination and the filters the UI sends
   (user, action/type, resource, IP, status, date range).
2. Enforce org-admin access and gate it with **our own configuration flag**, not
   the Enterprise `audit_logs` feature key.
3. Implement CSV/JSON export with the same filters.
4. Point our own (AGPL) frontend at the new path.
5. No new table or write path needed — events are already recorded.

### ✅ B. Advanced analytics — AGPL code, declared Enterprise

| Layer                                                                            |                   Status                   | License |
| -------------------------------------------------------------------------------- | :----------------------------------------: | :-----: |
| Frontend (`app/orgs/[orgslug]/dash/analytics`, `components/Dashboard/Analytics`) |                     ✅                     |  AGPL   |
| Backend (`src/routers/analytics.py`, `src/services/analytics/`)                  |                     ✅                     |  AGPL   |
| Student dossier (`src/routers/audit.py`, `src/services/audit/`)                  |                     ✅                     |  AGPL   |
| Runtime designation                                                              | Declared Enterprise (`analytics_advanced`) |    —    |

The implementation is present in the AGPL repository. Do not bypass the
Enterprise gate. Either obtain an Enterprise license, or reimplement the surface
independently as first-party code. Tinybird credentials are optional for live
charts.

### 💳 C. Payments — orgs sell their own courses

Frontend is **fully built**. Backend and models are **entirely absent** (they live
in the Enterprise package). Reimplement as **first-party AGPL code**.

| Layer                                                                                           | Status |         License          |
| ----------------------------------------------------------------------------------------------- | :----: | :----------------------: |
| Frontend (`components/Dashboard/Pages/Payments/`, `components/Payments/`, `services/payments/`) |   ✅   |           AGPL           |
| Backend router / services / models                                                              |   ❌   | Enterprise — reimplement |
| Paywall enforcement                                                                             |   ❌   | Enterprise — reimplement |

**First-party models to add** (AGPL core; auto-registered by `database.py`):

| Suggested path                       | Records                               |
| ------------------------------------ | ------------------------------------- |
| `src/db/payments/offers.py`          | offer                                 |
| `src/db/payments/enrollments.py`     | enrollment                            |
| `src/db/payments/groups.py`          | group, group resources, group syncs   |
| `src/db/payments/providers.py`       | per-org provider credentials / config |
| `src/db/payments/offer_resources.py` | offer-to-resource links               |

> The AGPL core currently references Enterprise paths
> (`security/rbac/rbac.py` → `ee.db.payments...`, `ee.services.payments...`). As
> part of the first-party build, repoint those imports to our own modules (an
> AGPL-core edit), instead of creating an `ee/` package.

**Required API surface** (exact paths the frontend already calls):

| Group                       | Endpoints                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Config                      | `GET/POST/PUT/DELETE /payments/{orgId}/config` (`?id=`, `?provider=`)                                                           |
| Customers / enrollments     | `GET /payments/{orgId}/customers`, `GET /payments/{orgId}/enrollments/mine`                                                     |
| Offers                      | `GET/POST /payments/{orgId}/offers`, `GET/PUT/DELETE /payments/{orgId}/offers/{offerId}`                                        |
| Offer resources             | `GET/POST/DELETE /payments/{orgId}/offers/{offerId}/resources`                                                                  |
| Offer public                | `GET /payments/{orgId}/offers/{offerId}/public`, `.../offers/public-listing`, `.../offers/by-resource`                          |
| Checkout                    | `GET /payments/{orgId}/offers/{offerUuid}/checkout`                                                                             |
| Billing portal              | `GET /payments/{orgId}/billing/portal`                                                                                          |
| Groups                      | `GET/POST /payments/{orgId}/groups`, `PUT/DELETE /payments/{orgId}/groups/{groupId}`                                            |
| Group resources             | `GET/POST/DELETE /payments/{orgId}/groups/{groupId}/resources`                                                                  |
| Group sync (-> user groups) | `GET/POST/DELETE /payments/{orgId}/groups/{groupId}/sync`                                                                       |
| Stripe overview             | `GET /payments/{orgId}/stripe/overview`, `.../charges`, `.../subscriptions`                                                     |
| Stripe Connect              | `GET /payments/{orgId}/stripe/connect/link`, `.../express/connect/link`, `.../express/connect/refresh`, `.../express/dashboard` |
| OAuth callback              | `GET /payments/stripe/oauth/callback`                                                                                           |

**External dependency:** Stripe (Connect for platform-on-behalf-of-org selling).

**End-to-end steps:**

1. Define first-party models in `src/db/payments/` (offers, enrollments, groups,
   provider config, offer-resource links); they auto-register via `database.py`.
2. Create `src/services/payments/payments_stripe.py`: checkout sessions, Connect
   onboarding, webhooks (Stripe SDK is already a dependency).
3. Create `src/services/payments/payments_access.py` and repoint
   `security/rbac/rbac.py` to it so the paywall is enforced for our code (AGPL-core
   edit; do not touch the Enterprise `ee/` surface).
4. Create a first-party payments router implementing the table above and register
   it on `v1_router` (our own prefix; do not use `register_routers`/the EE gate).
5. Add Stripe webhook processing (checkout completed, subscription updated,
   Connect account updated) to create enrollments and sync group membership.
6. Reuse the existing user-group sync target (`usergroups`) for group sync.
7. Configure per-org Stripe keys via the config endpoints (already in the UI).

### 🔐 D. SSO

Frontend is **fully built**. Backend and models are **absent** (Enterprise).
Reimplement as **first-party AGPL code**.

| Layer                                                                    | Status |         License          |
| ------------------------------------------------------------------------ | :----: | :----------------------: |
| Frontend (`services/auth/sso.ts`, `OrgEditSSO`, `app/auth/sso/callback`) |   ✅   |           AGPL           |
| Backend router / service / providers / model                             |   ❌   | Enterprise — reimplement |

**Required model** (shape the frontend expects in `SSOConfig`):

```
id, org_id, provider, enabled, domains[], auto_provision_users,
default_role_id, provider_config (JSON), created_at, updated_at
```

**Providers to support** (frontend type `SSOProvider`):
`workos`, `keycloak`, `okta`, `auth0`, `custom_saml`, `custom_oidc`.

**Required API surface** (exact paths the frontend already calls):

| Endpoint                            | Purpose                          |
| ----------------------------------- | -------------------------------- |
| `GET /auth/sso/providers?org_id=`   | list providers + `config_fields` |
| `GET /auth/sso/{orgId}/config`      | read config                      |
| `POST /auth/sso/{orgId}/config`     | create config                    |
| `PUT /auth/sso/{orgId}/config`      | update config                    |
| `DELETE /auth/sso/{orgId}/config`   | delete config                    |
| `GET /auth/sso/{orgId}/setup-url`   | IdP setup portal URL             |
| `GET /auth/sso/check?org_slug=`     | is SSO enabled for this org      |
| `GET /auth/sso/authorize?org_slug=` | start login (redirect)           |
| `GET/POST /auth/sso/callback?code=` | complete login, issue session    |

**External dependency:** an IdP provider (WorkOS is the intended default;
`workos` is already a backend dependency). Alternatively implement direct
SAML/OIDC for the `custom_*` providers.

**End-to-end steps:**

1. Add a first-party `SSOConfig` model (new table; auto-registered).
2. Implement a provider abstraction + a WorkOS (or native SAML/OIDC) adapter.
3. Implement the router above and register it on `v1_router` as first-party code
   (our own prefix; not `register_routers`/the EE gate).
4. On callback: validate the assertion, map domains to the org, auto-provision
   the user if enabled (default role via `default_role_id`), then issue the
   session using the existing auth/session service.
5. Ensure `sso` is an accepted method in the org's `allowed_auth_methods`
   policy (`organization_config.py` already lists it).

### 📚 E. SCORM

Frontend is **fully built and wired into the app** — the activity renderer,
import modal, and results view all lazy-import from the bundled SCORM UI.
Backend and models are **absent** (Enterprise). Reimplement as **first-party
AGPL code**.

| Layer                                                                                       |                    Status                    |         License          |
| ------------------------------------------------------------------------------------------- | :------------------------------------------: | :----------------------: |
| Frontend (`apps/web/ee/services/scorm/`, components, wired in `activity.tsx`, `client.tsx`) |                      ✅                      |           AGPL           |
| Backend content proxy / analyze / import / runtime / results                                |                      ❌                      | Enterprise — reimplement |
| DB models                                                                                   |                      ❌                      |
| Activity enums (`TYPE_SCORM`, `SUBTYPE_SCORM_12`, `SUBTYPE_SCORM_2004`)                     | ✅ already in `src/db/courses/activities.py` |

**First-party models** (AGPL core): version enum, completion-status enum, package,
SCO, SCO assignment, and attempt/completion records.

**Required API surface** (paths the frontend already calls):

| Endpoint                                 | Purpose                                                      |
| ---------------------------------------- | ------------------------------------------------------------ |
| `GET /scorm/{path}`                      | serve package content (same-origin for the SCORM API bridge) |
| `POST /scorm/analyze/{courseUuid}`       | inspect an uploaded package                                  |
| `POST /scorm/analyze-for-import/{orgId}` | inspect before import                                        |
| `POST /scorm/import/{courseUuid}`        | attach package to a course                                   |
| `POST /scorm/import-as-course`           | create a course from a package                               |
| `GET /scorm/{activityUuid}/results`      | learner results / grading                                    |

**Runtime:** implement the SCORM 1.2 / 2004 client API
(Initialize / GetValue / SetValue / Commit / Finish) server-side; the frontend
`ScormRuntimeAPI.ts` bridges to it.

**Permitted open-source components:** a SCORM manifest/SCO parser library, or
implement the `imsmanifest.xml` parse directly (recommended to avoid dependency
licensing questions). Reuse the existing content/media layer
(`src/services/media`, content directory) and presigned URLs; the proxy route
already passes storage redirects through.

**End-to-end steps:**

1. Define first-party SCORM models under `src/db/scorm/` (version, package, SCO,
   assignment, attempt/completion); auto-registered.
2. Implement package parsing (manifest `imsmanifest.xml`), version detection,
   and SCO tree extraction.
3. Implement import: store package files via the media layer, create the
   `TYPE_SCORM` activity (subtypes already exist in `src/db/courses/activities.py`),
   and link SCOs.
4. Implement the content proxy + runtime API (GET/POST endpoints) enforcing
   course access and recording attempts.
5. Implement results/grading and feed completion into the existing
   assignment/certificate pipeline.
6. Register the router on `v1_router` as first-party code (not the EE gate).

### 🌐 F. Multi-organization hosting

Mostly present; needs configuration plus infrastructure.

| Layer                                                      |          Status           |    License     |
| ---------------------------------------------------------- | :-----------------------: | :------------: |
| Frontend resolver (`apps/web/ee/services/tenancy/core.ts`) |            ✅             |      AGPL      |
| Backend custom domains (add/verify/SSL/resolve)            |            ✅             |      AGPL      |
| Multi-org creation gate (`is_multi_org_allowed`)           |    ⚠️ Enterprise-gated    |   Enterprise   |
| Tenant routing activation                                  | ⚠️ needs `tenancy: multi` |       —        |
| DNS / wildcard TLS                                         |            ❌             | infrastructure |
| Custom-domain DNS verification + cert issuance             |            ❌             | infrastructure |

**Steps:**

1. Multi-org creation is Enterprise-gated by `is_multi_org_allowed()`. Do **not**
   flip it to simulate an EE license. To run multiple institutions, either license
   the feature, or implement multi-org as a **first-party feature with our own
   gate** (keeping the Enterprise gate behavior for the Enterprise surface).
2. Set `tenancy: multi` and a real `domain` / `frontend_domain` in
   `apps/api/config/config.yaml` (multi-tenant inference excludes localhost).
3. Provision wildcard DNS `*.{domain}` and wildcard TLS.
4. Use the existing custom-domain endpoints; implement DNS TXT verification
   checks and certificate issuance on the edge/proxy.
5. Each organization then gets isolated branding/customization, landing pages,
   and menu — the `organizationconfig` table is already per-org.

---

## 📋 3. Recommended build order

All items are **first-party reimplementations**; the Enterprise gates stay intact.

| Phase | Work                                                                    | Enables                                                                                                         |
| ----- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **1** | Org-wide audit logs viewer (first-party router over `user_audit_event`) | Org event log + export                                                                                          |
| **2** | Multi-tenant config + infra (DNS/TLS)                                   | `slug.{domain}` — institutions under one instance                                                               |
| **3** | SSO backend                                                             | Enterprise-grade sign-in                                                                                        |
| **4** | SCORM backend                                                           | SCORM courses end to end                                                                                        |
| **5** | Payments backend + Stripe Connect                                       | Institutions sell courses, paywall enforcement                                                                  |
| —     | Advanced analytics / dossier                                            | Already implemented in AGPL; requires an Enterprise license or independent reimplementation — **do not bypass** |

---

## 🗂️ 4. Reference — where things live

| Concern                                | Path                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Enterprise gates (leave intact)        | `apps/api/src/core/ee_hooks.py`, `src/security/superadmin.py`                                 |
| Deployment mode                        | `apps/api/src/core/deployment_mode.py`                                                        |
| Feature resolution / plans             | `apps/api/src/security/features_utils/`                                                       |
| First-party modules to add (AGPL core) | `apps/api/src/db/`, `apps/api/src/services/`, `apps/api/src/routers/`                         |
| Auth (session, policy, methods)        | `apps/api/src/services/auth/`, `src/db/organization_config.py`                                |
| RBAC / paywall hook                    | `apps/api/src/security/rbac/rbac.py`                                                          |
| Media / content storage                | `apps/api/src/services/media/`, `src/services/orgs/uploads.py`                                |
| Frontend payments                      | `apps/web/services/payments/`, `components/Dashboard/Pages/Payments/`                         |
| Frontend SSO                           | `apps/web/services/auth/sso.ts`, `components/Dashboard/Pages/Org/OrgEditSSO/`                 |
| Frontend SCORM                         | `apps/web/ee/services/scorm/`, `apps/web/ee/components/`                                      |
| Frontend audit logs                    | `apps/web/components/Dashboard/Pages/Org/OrgAuditLogs/`, `apps/web/services/ee/audit_logs.ts` |
| Audit event table + write path         | `apps/api/src/db/user_audit_events.py`, `apps/api/src/services/audit/audit.py`                |
| Student audit dossier (present)        | `apps/api/src/routers/audit.py`, `apps/api/src/services/audit/`                               |
| Advanced analytics (present)           | `apps/api/src/routers/analytics.py`, `apps/api/src/services/analytics/`                       |
| Platform billing (SaaS)                | `apps/web/services/billing/stripe.ts`, `apps/api/src/routers/orgs/org_plan.py`, `packs.py`    |

`.gitignore` confirms the EE package is external by design:

```
# Enterprise Edition (private repo, overlaid at SaaS build time, symlinked locally)
# No trailing slash — must also match a bare symlink at apps/api/ee, not just a directory.
apps/api/ee
```

---

## ♻️ 5. Disposition: remove, retain, or reimplement

Directive: keep only what the licence permits, delete the Enterprise licensing
machinery ValidBridge will never use, and rebuild proprietary (EE) functionality
as ValidBridge's own first-party code.

The Enterprise package (`apps/api/ee`) is never shipped, so its licence checks
have nothing to protect once the package is absent. Removing them is therefore
not circumvention — it is deleting an unused integration. The proprietary
features themselves are **reimplemented**, never unlocked.

### 5.1 Remove — Enterprise licensing machinery

| Item                                                        | Path                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deployment mode / licence resolution (`saas`/`ee`/`oss`)    | `apps/api/src/core/deployment_mode.py`                                                                                                                                                                       |
| EE hook loader (`is_license_active`, `register_*`, startup) | `apps/api/src/core/ee_hooks.py`                                                                                                                                                                              |
| Enterprise feature list + mode branches                     | `EE_ONLY_FEATURES`; `security/features_utils/resolve.py`, `plan_check.py`                                                                                                                                    |
| EE superadmin gate                                          | `ensure_ee_superadmin_surface()` in `apps/api/src/security/superadmin.py`                                                                                                                                    |
| EE/SaaS multi-org gate                                      | `is_multi_org_allowed()` in `ee_hooks.py`                                                                                                                                                                    |
| Vendor-cloud flags / licence keys                           | `VALIDBRIDGE_SAAS`, `VALIDBRIDGE_FORCE_EE`, `VALIDBRIDGE_DISABLE_EE` in `apps/api/config/config.py`                                                                                                          |
| SaaS-only branches                                          | `services/marketing/loops.py`, `services/nudges/*`, `services/users/users.py` (email gate), `services/orgs/usage.py`, `services/email/branding.py`                                                           |
| EE ignore entry                                             | `.gitignore` (`apps/api/ee`)                                                                                                                                                                                 |
| Frontend EE status/gates                                    | `components/Hooks/useEEStatus.tsx`, `components/Security/EERequiredScreen.tsx`, `components/Admin/EELicenseError.tsx`, mode branches in `services/plans/plans.ts`, EE helpers in `services/config/config.ts` |
| Frontend EE API clients                                     | `services/ee/superadmin.ts`, `services/ee/audit_logs.ts` — repoint to first-party                                                                                                                            |

Replace with a single ValidBridge deployment mode plus config-driven feature
flags. Keep `is_user_superadmin` / `require_superadmin` — superadmin becomes a
ValidBridge (first-party) capability, without the EE gate.

### 5.2 Retain and ungate — AGPL code currently labelled Enterprise

This code lives in the AGPL repository, so the licence covers it. Keep it and
drop the Enterprise designation/gate; it becomes ValidBridge core.

| Feature                               | Path                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Advanced analytics                    | `apps/api/src/routers/analytics.py`, `apps/api/src/services/analytics/`                         |
| Student audit dossier                 | `apps/api/src/routers/audit.py`, `apps/api/src/services/audit/`                                 |
| Audit-event recording                 | `apps/api/src/db/user_audit_events.py`, `apps/api/src/services/audit/audit.py`                  |
| Plans / limits / packs / AI credits   | `src/security/features_utils/`, `src/db/packs.py`, `src/routers/orgs/packs.py`, `ai_credits.py` |
| Multi-tenant routing + custom domains | `apps/web/proxy.ts`, `apps/web/ee/services/tenancy/`, `src/routers/orgs/custom_domains.py`      |
| SCORM frontend UI                     | `apps/web/ee/services/scorm/`, `apps/web/ee/components/`                                        |

> Only `apps/api/ee` is the proprietary, separately licensed package.
> `apps/web/ee/` is tracked in this repository, so it is AGPL — retain it
> (optionally move it out of the `ee/` path for clarity).

### 5.3 Reimplement — proprietary (EE) functionality

Absent from the repository; rebuild as ValidBridge first-party code.

| Feature                    | Key integration notes                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| Payments                   | Stripe Connect; repoint `security/rbac/rbac.py` paywall to our module |
| SSO                        | WorkOS or native SAML/OIDC; reuse the existing session service        |
| SCORM backend              | manifest parse + runtime API + results                                |
| Org-wide audit logs viewer | read/export over the existing `user_audit_event` table                |
| Platform superadmin API    | own surface; reuse AGPL admin / RBAC services                         |

### 5.4 Do not reimplement

| Item                                      | Reason                                                    |
| ----------------------------------------- | --------------------------------------------------------- |
| Licence / manifest system (`ee/hooks.py`) | ValidBridge does not license its own code — omit entirely |
| Any code from `apps/api/ee`               | Never distributed under AGPL; do not copy                 |
