# ValidBridge — Infrastructure & Credentials Checklist

> How to use: work top-to-bottom. Tick `[x]` as you complete each item. Every
> item says **what** it is, **where** to get it, and **which feature** it
> unlocks. `.env.example` only covers the minimum to boot — the full set is
> below. Values can go in `.env` (env wins) or `apps/api/config/config.yaml`.

Legend: `[ ]` to do · `[x]` done · 🔴 required to boot · 🟠 required for a core
feature · 🟡 optional / nice-to-have · 🔵 infra (not a key)

> **Status snapshot (2026-09-20)** — verified against the live Oracle VM
> (`84.12.116.16`, Ubuntu 24.04, nginx active, Cloudflare TLS) and the running
> `validbridge-*` containers:
> - **Tier 0 is done and live** (DB/Redis/JWT/MFA/domain/admin all configured).
> - **Email (Resend)**, **Sentry**, **Tinybird tokens** and the **WorkOS secret**
>   are now set on the server.
> - ⚠️ **AI key is rejected by Google** ("consumer suspended") — AI features will
>   fail until a valid AI Studio key replaces it.
> - ✅ **Tinybird is live** — `events` datasource deployed + `validbridge_ingest`
>   / `validbridge_read` scoped tokens set on the server.
> - ❌ **WorkOS Client ID is still missing**; **Paystack**, **Judge0** and
>   **Google sign-in** are still unset on the server.
> - ✅ **Per-org subdomains are live** (`{slug}.validbridge.co.ke`) — tenancy
>   switched to `multi`, wildcard DNS + nginx wildcard vhost configured.

---

## 0. Tier 0 — Required to boot at all 🔴
> ✅ **Verified live on the Oracle VM (2026-09-20)** — `validbridge-db`,
> `redis`, `backend`, `frontend` all healthy; migrations applied; admin/org seeded.

- [x] **PostgreSQL** (with `pgvector` for AI search/RAG)
  - Where: bundled `docker-compose.yml` (`pgvector/pgvector:pg16`).
  - Set: `VALIDBRIDGE_SQL_CONNECTION_STRING=postgresql+asyncpg://validbridge:validbridge@db:5432/validbridge`.
- [x] **Redis** (sessions, rate-limits, magic-login single-use, HLS queue, invites, nudges)
  - Where: bundled `docker-compose.yml` (`redis:7.2.3-alpine`).
  - Set: `VALIDBRIDGE_REDIS_CONNECTION_STRING=redis://redis:6379/validbridge`.
- [x] **JWT secret** (≥ 32 chars)
  - Set: `VALIDBRIDGE_AUTH_JWT_SECRET_KEY` (generated and configured).
- [x] **MFA encryption key**
  - Set: `VALIDBRIDGE_MFA_ENCRYPTION_KEY` (generated and configured).
- [x] **Public URLs / domain**
  - Set: `VALIDBRIDGE_DOMAIN=validbridge.co.ke`, `NEXT_PUBLIC_APP_URL=https://validbridge.co.ke`, `BACKEND_URL=https://api.validbridge.co.ke`, `NEXT_PUBLIC_VALIDBRIDGE_HTTPS=True`, `VALIDBRIDGE_COOKIE_DOMAIN=.validbridge.co.ke`.
- [x] **Initial admin + org** (created on first boot)
  - Set: `admin@validbridge.dev` / `ValidBridge123!`, org `default`.
- [x] **Run migrations**
  - Completed on container boot (71 database tables initialized).

---

## 1. Email (magic-link login, verification, invites, nudges) 🟠

Provider is `resend` or `smtp`.

- [x] **Choose provider** → `VALIDBRIDGE_EMAIL_PROVIDER=resend` (set on server)
- [x] **From address** → `no-reply@validbridge.co.ke`, `ValidBridge` (set — ⚠️ confirm the domain is verified in Resend or sends will fail)
- [x] **Resend** (recommended)
  - Get: sign up at `https://resend.com` → **API Keys** → create key; **Domains** → add + verify your sending domain (SPF/DKIM).
  - Set: `VALIDBRIDGE_RESEND_API_KEY=re_...` (set on server — key is valid but **send-only restricted**)
  - [ ] Bounce/complaint webhook (for nudges): Resend → **Webhooks** → add endpoint `https://<api>/api/v1/nudges/...`; set `VALIDBRIDGE_RESEND_WEBHOOK_SECRET=whsec_...` (also requires `VALIDBRIDGE_NUDGES_ENABLED=true`)
- [ ] **or SMTP** (not used — Resend is configured)
  - Set: `VALIDBRIDGE_SMTP_HOST`, `VALIDBRIDGE_SMTP_PORT` (587), `VALIDBRIDGE_SMTP_USERNAME`, `VALIDBRIDGE_SMTP_PASSWORD`, `VALIDBRIDGE_SMTP_USE_TLS=true`.
- Unlocks: password reset, email verification, **magic-link login**, org invites, nudges.

---

## 2. File / media storage 🟠

- [ ] **Choose backend** → `VALIDBRIDGE_CONTENT_DELIVERY_TYPE=filesystem|s3api`
  - `filesystem` = local `content/` dir (default; fine for a single VPS, **not** multi-replica).
  - `s3api` = S3-compatible object storage (needed for multi-replica / large video / custom domains).
- [ ] **S3 / Cloudflare R2** (if `s3api`)
  - Get (R2): `https://dash.cloudflare.com` → R2 → **Create bucket** → **Manage R2 API Tokens** → create a token (Access Key ID + Secret).
  - Set:
    - `VALIDBRIDGE_S3_API_BUCKET_NAME=...`
    - `VALIDBRIDGE_S3_API_ENDPOINT_URL=https://<accountid>.r2.cloudflarestorage.com`
    - `VALIDBRIDGE_S3_API_REGION=auto` (R2) or the real region for AWS S3/MinIO
    - `AWS_ACCESS_KEY_ID=...` and `AWS_SECRET_ACCESS_KEY=...` ← **not in `.env.example`**; boto3 reads these directly (standard AWS chain).
- Unlocks: durable media, presigned direct streaming, SCORM package storage, multi-replica uploads.

---

## 3. Payments (orgs sell courses) 🟠 — Paystack
> ⚠️ **Not configured on the server.** Dev-only test keys exist in local
> `apps/api/.env`; production needs live/test keys below.

- [ ] Get: `https://dashboard.paystack.com` → **Settings → API Keys & Webhooks**.
- [ ] Set platform fallback (orgs can also bring their own keys in the dashboard):
  - `VALIDBRIDGE_PAYSTACK_SECRET_KEY=sk_test_...` / `sk_live_...`
  - `VALIDBRIDGE_PAYSTACK_PUBLIC_KEY=pk_test_...` / `pk_live_...`
- [ ] Set the **webhook URL** in Paystack to `https://<api>/api/v1/payments/paystack/webhook` (signature is verified against the secret key).
- Unlocks: checkout, enrollment, billing.

---

## 4. SSO 🟠 — WorkOS (recommended) and/or custom OIDC

- [x] `VALIDBRIDGE_SSO_ENABLED=true` (set on server)
- [~] **WorkOS** (fronts SAML/OIDC/Google/Okta/Auth0/Keycloak)
  - Get: `https://dashboard.workos.com` → create Environment → **API Keys** → copy **Client ID** + **API key (secret)**.
  - [x] `VALIDBRIDGE_WORKOS_CLIENT_SECRET` set and validated live; `VALIDBRIDGE_WORKOS_REDIRECT_URI=https://api.validbridge.co.ke/api/v1/auth/sso/callback` set.
  - [ ] ❌ **`VALIDBRIDGE_WORKOS_CLIENT_ID` is still missing** — paste the Client ID; without it the provider reports `available: false`.
  - [ ] In WorkOS **Redirects** add the same callback URL; create a **Connection** and put its `org_...` id in the per-org SSO card.
- [ ] **Custom OIDC** (bring your own IdP)
  - Get from your IdP (Keycloak/Okta/Auth0/Authentik): client id + secret + issuer/discovery; register redirect `https://<api>/api/v1/auth/sso/callback`.
  - **Per-institution (BYOK, preferred):** the org enters `issuer_url`, `client_id`, `client_secret`, `scopes` in **Dashboard → Organization → SSO**. These are stored on the org's `SSOConfig`, org-first over any platform default, and the secret is **encrypted at rest and never returned** to the browser. Leave the platform values below empty to run pure BYOK.
  - **Platform default (optional fallback):** `VALIDBRIDGE_OIDC_CLIENT_ID`, `VALIDBRIDGE_OIDC_CLIENT_SECRET`, `VALIDBRIDGE_OIDC_ISSUER`, `VALIDBRIDGE_OIDC_AUTHORIZATION_ENDPOINT`, `VALIDBRIDGE_OIDC_TOKEN_ENDPOINT`, `VALIDBRIDGE_OIDC_USERINFO_ENDPOINT`, `VALIDBRIDGE_OIDC_REDIRECT_URI`.
- Unlocks: org SSO login. (CI tests use the in-repo fake IdP — no key needed; **live login needs these**.)

### 4b. BYOK — what each institution brings (per-org, encrypted at rest)

- [ ] **Paystack** (their own merchant account) — secret + public key, entered in **Dashboard → Payments**. The **secret key is Fernet-encrypted at rest** and never returned; falls back to the platform keys in §3 when unset.
- [ ] **OIDC** (their own IdP app) — `issuer_url` / `client_id` / `client_secret` / `scopes`, entered in **Dashboard → SSO**. Secret encrypted at rest, never returned.
- [ ] **Their own domain** (BYO, not a key) — entered in **Dashboard → Domains**; they add a DNS **TXT** record (and CNAME). See §7 for the cert/proxy work.
- [ ] **WorkOS** — the org supplies only its non-secret `organization_id`; the WorkOS client secret stays platform-level (§4).

> All stored secrets use `src/security/secret_crypto.py` (Fernet, key derived from
> `VALIDBRIDGE_AUTH_JWT_SECRET_KEY`). **Rotating that JWT secret makes every
> stored BYOK secret undecryptable** — set `VALIDBRIDGE_MFA_ENCRYPTION_KEY` for
> MFA separately, and treat the JWT secret as long-lived (or plan a re-entry of
> BYOK secrets when rotating).

---

## 5. AI (chat, course planning, quiz/assignment gen, RAG search, captions, images, TTS) 🟠

- [x] `VALIDBRIDGE_IS_AI_ENABLED=true` (set on server)
- [x] `VALIDBRIDGE_AI_PROVIDER=google` (set on server)
- [x] **`VALIDBRIDGE_AI_API_KEY` — valid 2026-09-20.** Previous key was suspended; the
  replacement was verified live (list/generateContent `200`; in-app `pydantic_ai` →
  `google-genai` roundtrip returned "AI is online"; `VALIDBRIDGE_GEMINI_API_KEY`
  set to the same key for embeddings + image/audio).
  - ⚠️ **Model compatibility (new `AQ`-styled key, 2026):** `gemini-2.5-flash` is no
    longer usable by this (new) account, and `gemini-3.1-pro-preview` /
    `gemini-2.5-flash-image` 429 (free-tier/no-billing). Resolved via overrides:
    `VALIDBRIDGE_AI_MODEL_PRO=gemini-3.5-flash`, `VALIDBRIDGE_AI_IMAGE_MODEL=gemini-3.1-flash-image`,
    `VALIDBRIDGE_AI_TTS_MODEL=gemini-3.1-flash-tts-preview`. Tiers `fast`/`standard`
    keep their verified defaults (`gemini-3.1-flash-lite` / `gemini-3.5-flash`).
  - ⚠️ Image/TTS gen may still 429 randomly on the **free tier** (no billing) — not a config bug.
- [~] Optional overrides: `VALIDBRIDGE_AI_BASE_URL`, `VALIDBRIDGE_AI_MODEL_FAST/STANDARD/PRO`, `VALIDBRIDGE_AI_EMBEDDING_PROVIDER`, `VALIDBRIDGE_AI_EMBEDDING_MODEL`, `VALIDBRIDGE_AI_EMBEDDING_DIMENSIONS` (default 768 — changing needs a migration + re-index), `VALIDBRIDGE_AI_IMAGE_MODEL`, `VALIDBRIDGE_AI_TTS_MODEL` <small>(model overrides now set — see above)</small>.
- [x] **ffmpeg + ffprobe** on the host (used for AI captions) → installed on the VM 2026-09-20 (`ffmpeg 6.1.1`); override paths with `VALIDBRIDGE_FFMPEG_PATH` / `VALIDBRIDGE_FFPROBE_PATH`.
- Unlocks: all AI features, semantic search, auto-captions, AI image/audio.
- ⚠️ Embeddings fall back to Google when the chosen provider lacks embeddings — keep `VALIDBRIDGE_GEMINI_API_KEY` set if you want RAG with non-Google providers.

---

## 6. Video hosting / HLS 🟡→🟠

Uploaded MP4/WebM plays immediately (progressive `Range` streaming). HLS
adaptive streaming + preview sprites are **opt-in**.

- [x] **ffmpeg + ffprobe** on the host (and any transcode worker) — installed 2026-09-20 (`ffmpeg 6.1.1`)
- [x] **Enable HLS** → `VALIDBRIDGE_HLS_ENABLED=true` — set on server 2026-09-20, backend recreated
- [x] **Worker model** — in-process on the API pod confirmed running: `HLS in-app consumer started (concurrency=1)` (no standalone worker needed; backfill one-off available via `uv run python cli.py transcode-backfill --limit 0`)
- [x] Tuning — defaults in place (`VALIDBRIDGE_HLS_CONCURRENCY=1`, `_FFMPEG_THREADS=1`, `_MAX_RETRIES=6`, `_ENCRYPT=true` AES-128)
- [x] Redis reachable (the queue lives there — Tier 0 Redis is up)
- [ ] What's left depends on **S3/R2** (§2): heavy HLS is best served off the VPS disk → `VALIDBRIDGE_CONTENT_DELIVERY_TYPE=s3api`.
- ⚠️ Transcoding is **CPU-heavy in-process on this VM** — monitor before heavy uploads.
- 💰 **Cost decision 2026-09-20:** keep transcode on the VM — Oracle Always Free (`VM.Standard.A1.Flex`, 4 OCPU/23GB) → compute + egress (≤10TB/mo) are **free**, so HLS here is $0. Revisit **R2** (existing `s3api` backend, ≈free egress) or **Cloudflare Stream** (~$5/1k min stored/mo) only when video volume slows the app or forces a paid compute shape.
- Unlocks: adaptive HLS ladder (1080/720/480/360p), hover-scrub sprite, encrypted segments.

---

## 7. Multi-tenant hosting (subdomains + custom domains) 🔵

App code is complete; this is **infra**. ✅ Verified live 2026-09-20 (nginx
`active`, site `validbridge` routes `:3000`/`:8000`; no certbot on host — TLS is
Cloudflare-terminated).

- [x] `VALIDBRIDGE_DOMAIN=validbridge.co.ke` & `VALIDBRIDGE_COOKIE_DOMAIN=.validbridge.co.ke` configured
- [x] **DNS**: Cloudflare A records (`@`, `api`, `www`) pointing to `84.12.116.16`
- [x] **TLS**: Cloudflare SSL/TLS termination enabled
- [x] **Reverse proxy / ingress**: Nginx configured on Oracle VM terminating port 80 and routing to frontend (:3000) and backend API (:8000)
- [x] **Wildcard DNS**: `*.validbridge.co.ke` → Cloudflare (verified 2026-09-20; `default.`/`admin.`/random subdomains resolve)
- [x] **Per-org subdomains enabled**: `VALIDBRIDGE_TENANCY=multi`, `VALIDBRIDGE_COOKIE_DOMAIN_ALLOW_BROAD=true`, `NEXT_PUBLIC_VALIDBRIDGE_MULTI_ORG=True`, `VALIDBRIDGE_ALLOWED_REGEXP` scoped to `*.validbridge.co.ke`; nginx frontend vhost accepts `*.validbridge.co.ke`. `/instance/info` now returns `tenancy: multi`, `multi_org_enabled: true`. Apex serves login/org-picker; each org lives on `{slug}.validbridge.co.ke`.
- [ ] `CLOUD_INTERNAL_KEY=...` (if control-plane domain sync is enabled)

> Without DNS + TLS + proxy, `slug.your-domain.tld` and customer domains will not
> resolve/secure. Adding an institution is then just an `organization` row.

---

## 8. Optional integrations 🟡

- [x] **Analytics** (Tinybird): ✅ **done 2026-09-20.** `events` datasource deployed (Forward mode, `tb deploy`) and two least-privilege resource-scoped tokens created via `TOKEN` directives in `events.datasource`: `validbridge_ingest` (`DATASOURCES:APPEND`) and `validbridge_read` (`DATASOURCES:READ`). Server env set to `VALIDBRIDGE_TINYBIRD_API_URL=https://api.europe-west2.gcp.tinybird.co` + the two scoped tokens (verified: read query 200, ingest 202). To re-deploy after schema changes: `cd apps/api/src/db/tinybird/datasources && TB_TOKEN=<admin> TB_HOST=https://api.europe-west2.gcp.tinybird.co tb --cloud deploy`.
- [ ] **Code execution** (Judge0): RapidAPI Judge0 or self-host → `VALIDBRIDGE_JUDGE0_API_URL`, `VALIDBRIDGE_JUDGE0_CLIENT_ID`, `VALIDBRIDGE_JUDGE0_CLIENT_SECRET`.
- [ ] **Google sign-in**: `https://console.cloud.google.com` → OAuth 2.0 Client → `VALIDBRIDGE_GOOGLE_OAUTH_CLIENT_ID` (or `VALIDBRIDGE_GOOGLE_CLIENT_ID`). (A Gemini/AI Studio key is **not** a Google OAuth client id.)
- [ ] **Marketing email (Loops)**: `https://loops.so` → API key → `LOOPS_API_KEY`.
- [x] **Realtime boards collab**: `COLLAB_INTERNAL_KEY` set on server + `NEXT_PUBLIC_COLLAB_URL=wss://validbridge.co.ke` (note: the collab service is not part of the current `docker-compose.yml`).
- [x] **Error monitoring**: `VALIDBRIDGE_SENTRY_DSN` set on server.
- [ ] **SaaS control plane only** (ignore for self-host): `CLOUD_INTERNAL_KEY`, `VALIDBRIDGE_PLATFORM_API_KEY`, `VALIDBRIDGE_PLATFORM_URL`.

---

## 9. Feature → live-key testing matrix

Some features are fully covered by CI with fakes; the rest need real keys to
verify end-to-end. `missing.md` also flags these.

| Feature | Needs a live key/service to test? | What to provide | Status (2026-09-20) |
|---|---|---|---|
| Core LMS / courses / activities | No (CI) | — | ✅ live |
| Payments | **Yes** | Paystack test keys + webhook URL | ⏳ unset on server |
| SSO | **Yes** (live IdP login) | WorkOS (or OIDC) client id/secret + callback | ⚠️ secret set, **Client ID missing** |
| SCORM | No (EE flag; CI uses fixtures) | `ee/` overlay present (gitignored) | ✅ code |
| Email (magic link, verify, invites) | **Yes** | Resend key+domain or SMTP | ⚠️ key set, verify domain |
| AI (chat/plan/quiz/RAG/captions/image/audio) | **Yes** | AI provider key (+ Gemini for embeddings/media) | ✅ **key valid** — chat/tiers verified live; free-tier 429 possible on image/TTS |
| Video HLS | **Yes** (transcode) | ffmpeg + Redis + `VALIDBRIDGE_HLS_ENABLED` (+ worker) | ✅ ffmpeg + HLS enabled, in-app consumer live |
| Analytics | **Yes** | Tinybird tokens | ✅ datasource + scoped tokens live |
| Code execution | **Yes** | Judge0 endpoint/creds | ⏳ unset |
| Google sign-in | **Yes** | Google OAuth client id | ⏳ unset |
| Multi-tenant / custom domains | **Yes** (infra) | wildcard DNS + TLS + proxy | ✅ per-org subdomains live |
| Object storage (S3/R2) | **Yes** | bucket + AWS keys | ⏳ filesystem default |
| Nudges / marketing | **Yes** | Resend + Loops | ⏳ webhook/Loops unset |

---

## 10. Full environment variable reference

| Variable | Required | Default | Feature |
|---|---|:---:|---|
| `VALIDBRIDGE_SQL_CONNECTION_STRING` | 🔴 | — | Postgres (`...asyncpg://`) |
| `VALIDBRIDGE_REDIS_CONNECTION_STRING` | 🔴 | — | Redis |
| `VALIDBRIDGE_AUTH_JWT_SECRET_KEY` | 🔴 | — | Sessions (≥32 chars) |
| `VALIDBRIDGE_MFA_ENCRYPTION_KEY` | 🟡 | JWT secret | TOTP secret encryption |
| `VALIDBRIDGE_DOMAIN` / `VALIDBRIDGE_FRONTEND_DOMAIN` | 🔴/🟡 | `localhost:3000` | URLs, cookies, email links |
| `VALIDBRIDGE_TENANCY` | 🟡 | `single` | `single`/`multi` |
| `VALIDBRIDGE_COOKIE_DOMAIN` | 🟡 | — | cross-subdomain cookies (multi) |
| `VALIDBRIDGE_ALLOWED_ORIGINS` / `_ALLOWED_REGEXP` | 🔴¹ | catch-all | CORS/CSRF (scope in prod) |
| `VALIDBRIDGE_INITIAL_ADMIN_EMAIL` / `_PASSWORD` | 🔴 | — | first admin |
| `VALIDBRIDGE_INITIAL_ORG_NAME` / `_SLUG` | 🔴 | — | first org |
| `VALIDBRIDGE_EMAIL_PROVIDER` | 🟠 | `resend` | `resend`/`smtp` |
| `VALIDBRIDGE_SYSTEM_EMAIL_ADDRESS` / `_SENDER_NAME` | 🟠 | — | From address |
| `VALIDBRIDGE_RESEND_API_KEY` | 🟠 | — | Resend email |
| `VALIDBRIDGE_RESEND_WEBHOOK_SECRET` | 🟡 | — | bounce/complaint webhook |
| `VALIDBRIDGE_SMTP_HOST/PORT/USERNAME/PASSWORD/USE_TLS` | 🟠 | — | SMTP email |
| `VALIDBRIDGE_CONTENT_DELIVERY_TYPE` | 🟠 | `filesystem` | `filesystem`/`s3api` |
| `VALIDBRIDGE_S3_API_BUCKET_NAME` / `_ENDPOINT_URL` | 🟠 | — | object storage |
| `VALIDBRIDGE_S3_API_REGION` | 🟡 | `auto` | region (R2=auto) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | 🟠 | — | S3/R2 creds (not in `.env.example`) |
| `VALIDBRIDGE_PAYSTACK_SECRET_KEY` / `_PUBLIC_KEY` | 🟠 | — | Paystack |
| `VALIDBRIDGE_SSO_ENABLED` | 🟡 | `true` | SSO master switch |
| `VALIDBRIDGE_WORKOS_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | 🟠² | — | WorkOS SSO |
| `VALIDBRIDGE_OIDC_CLIENT_ID` / `_SECRET` / `_ISSUER` / `_*_ENDPOINT` / `_REDIRECT_URI` | 🟠² | — | custom OIDC |
| `VALIDBRIDGE_IS_AI_ENABLED` | 🟠 | `false` | AI master switch |
| `VALIDBRIDGE_AI_PROVIDER` / `_API_KEY` / `_BASE_URL` | 🟠 | `google` | AI provider |
| `VALIDBRIDGE_GEMINI_API_KEY` | 🟠 | — | Gemini + embeddings/media fallback |
| `VALIDBRIDGE_AI_MODEL_FAST/STANDARD/PRO` | 🟡 | built-in | model tiers |
| `VALIDBRIDGE_AI_EMBEDDING_*` / `_DIMENSIONS` | 🟡 | provider default / 768 | RAG embeddings |
| `VALIDBRIDGE_AI_IMAGE_MODEL` / `_TTS_MODEL` | 🟡 | built-in | media gen |
| `VALIDBRIDGE_HLS_ENABLED` | 🟡 | `false` | HLS transcoding |
| `VALIDBRIDGE_HLS_INPROCESS_WORKER` | 🟡 | `false` | transcode on API pod |
| `VALIDBRIDGE_HLS_CONCURRENCY` / `_FFMPEG_THREADS` / `_MAX_RETRIES` / `_ENCRYPT` | 🟡 | 1 / 1 / 6 / true | HLS tuning |
| `VALIDBRIDGE_FFMPEG_PATH` / `_FFPROBE_PATH` | 🟡 | `ffmpeg`/`ffprobe` | binaries |
| `VALIDBRIDGE_CAPTIONS_CONCURRENCY` | 🟡 | 1 | caption jobs |
| `VALIDBRIDGE_TINYBIRD_API_URL` / `_INGEST_TOKEN` / `_READ_TOKEN` | 🟡 | — | analytics |
| `VALIDBRIDGE_JUDGE0_API_URL` / `_CLIENT_ID` / `_CLIENT_SECRET` | 🟡 | — | code execution |
| `VALIDBRIDGE_GOOGLE_OAUTH_CLIENT_ID` / `VALIDBRIDGE_GOOGLE_CLIENT_ID` | 🟡 | — | Google sign-in |
| `LOOPS_API_KEY` | 🟡 | — | marketing email |
| `COLLAB_INTERNAL_KEY` / `NEXT_PUBLIC_COLLAB_URL` | 🟡 | — | realtime boards |
| `VALIDBRIDGE_SENTRY_DSN` | 🟡 | — | error monitoring |
| `VALIDBRIDGE_PLATFORM_URL` / `_PLATFORM_API_KEY` / `CLOUD_INTERNAL_KEY` | 🟡 | — | SaaS control plane |
| `VALIDBRIDGE_MEDIA_URL` | 🟡 | derived | override media base URL |
| `VALIDBRIDGE_DEVELOPMENT_MODE` | 🟡 | `false` | dev mode |
| `VALIDBRIDGE_LOG_LEVEL` | 🟡 | — | logging |
| `NEXT_PUBLIC_VALIDBRIDGE_*` / `NEXTAUTH_*` / `BACKEND_URL` / `HTTP_PORT` | 🔴/🟡 | — | frontend wiring |

¹ Defaults to a catch-all regexp — **scope it in production**. ² Set one of WorkOS **or** OIDC to make SSO available.

---

## 11. Remaining follow-ups (operator-owned — as of 2026-09-20)

**Everything code / config / infra is done.** Only secrets and a few dashboard
steps remain. After editing the server `.env`, run
`cd ~/projects/validbridge && docker compose up -d backend` (add `frontend` when
a `NEXT_PUBLIC_*` value changes).

| # | Item | Action | Env var(s) | Impact while unset |
|--:|---|---|---|---|
| 1 | **WorkOS Client ID** | dashboard.workos.com → API Keys → copy Client ID | `VALIDBRIDGE_WORKOS_CLIENT_ID` | SSO card stays `available: false` (secret already set) |
| 2 | ✅ **Gemini key — done 2026-09-20** | replacement key validated live + in-app; model overrides set for pro/image/tts (§5) | — | chat/tiers work; free-tier 429 possible on image/TTS |
| 3 | **Paystack keys** | dashboard.paystack.com → Settings → API Keys & Webhooks | `VALIDBRIDGE_PAYSTACK_SECRET_KEY`, `VALIDBRIDGE_PAYSTACK_PUBLIC_KEY` | no checkout/billing |
| 3b | **Paystack webhook** | set URL `https://api.validbridge.co.ke/api/v1/payments/paystack/webhook` | — | payments not confirmed |
| 4 | **Google OAuth Client ID** | console.cloud.google.com → OAuth 2.0 Client | `VALIDBRIDGE_GOOGLE_OAUTH_CLIENT_ID` | Google sign-in hidden |
| 5 | **Resend domain + webhook** | verify sending domain (SPF/DKIM); add bounce/complaint webhook | `VALIDBRIDGE_RESEND_WEBHOOK_SECRET` (+ `VALIDBRIDGE_NUDGES_ENABLED=true`) | sends may fail; nudges idle |
| 6 | *(optional)* **Loops** | loops.so API key | `LOOPS_API_KEY` | marketing email off |
| 7 | *(optional)* **Judge0** | self-host or RapidAPI | `VALIDBRIDGE_JUDGE0_API_URL`, `_CLIENT_ID`, `_CLIENT_SECRET` | code execution returns 503 |
| 8 | *(optional)* **S3/R2 storage** | bucket + R2 token — see §2 | `VALIDBRIDGE_CONTENT_DELIVERY_TYPE`, `_S3_API_*`, `AWS_*` | filesystem only (fine for single VPS) |
| 9 | ✅ **HLS video — done 2026-09-20** | `VALIDBRIDGE_HLS_ENABLED=true` set; in-app consumer live; MP4 fallback until transcoded | — | see §6 |

**Not a secret — usage step:** create organizations; each is served at
`{slug}.validbridge.co.ke` (the seeded org is `default.validbridge.co.ke`).
Custom domains per org are supported via Dashboard → Domains (needs the org's
DNS TXT/CNAME).
