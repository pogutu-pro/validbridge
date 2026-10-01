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
  - Set: `VALIDBRIDGE_INITIAL_ADMIN_EMAIL` / `VALIDBRIDGE_INITIAL_ADMIN_PASSWORD` in the server env (value kept in the password manager, never in this repo), org `default`. Change the password after first login.
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
  - [x] **Routes fixed 2026-09-20:** the SSO router was mounted at `/auth` instead of `/auth/sso`, so every frontend call (`/api/v1/auth/sso/check|providers|authorize|callback`) and the WorkOS redirect URI 404'd. Now mounted at `/auth/sso` (`apps/api/src/router.py`); verified live (`/auth/sso/check` → 200, old `/auth/check` → 404). Guard test added.
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

### Organizations' own domains (Cloudflare for SaaS)

A school can serve its site at e.g. `learn.school.ac.ke`. Cloudflare for SaaS
issues and renews the certificate; ValidBridge registers the hostname with
Cloudflare when the school clicks **Verify** (Dashboard → Developers →
Domains) and removes it when the domain is deleted. The Domains page shows the
certificate state straight from Cloudflare.

- [ ] **Fallback origin**: Cloudflare → DNS → add `domains` → A → the VM IP,
  **Proxied**. Then SSL/TLS → Custom Hostnames → set **Fallback Origin** to
  `domains.validbridge.co.ke`.
- [ ] **API token** (separate from the R2 token): My Profile → API Tokens →
  Create Token → *Custom*: **Zone → SSL and Certificates → Edit** on zone
  `validbridge.co.ke` (optionally restrict to the VM's IP).
- [ ] **Zone ID**: Cloudflare → `validbridge.co.ke` → Overview → right-hand
  column "Zone ID".
- [ ] API `.env`:
  - `VALIDBRIDGE_CLOUDFLARE_API_TOKEN=<token>` (server only)
  - `VALIDBRIDGE_CLOUDFLARE_ZONE_ID=<zone id>`
  - `VALIDBRIDGE_CUSTOM_DOMAIN_CNAME_TARGET=domains.validbridge.co.ke`
  - then `docker compose up -d backend`
- [ ] **nginx**: customer domains reach the VM with their own `Host`
  (`learn.school.ac.ke`), which the `*.validbridge.co.ke` vhost doesn't match.
  Make the **frontend** vhost the `default_server` on port 80 (or add
  `server_name _;` to it) so unknown hosts go to the web app, which maps the
  Host to the organization.
- What a school does: add the **TXT** record shown on its Domains page and a
  **CNAME** from its host (e.g. `learn`) to `domains.validbridge.co.ke`, click
  **Verify**, and wait a few minutes for the certificate. Use a subdomain like
  `learn.`; many DNS providers don't allow a CNAME on the bare domain.
- Without the token/zone set, verification still works but schools' domains
  have no certificate (browsers show an error), so don't advertise it yet.

### Help Center — `help.validbridge.co.ke`

The public Help Center is served by the **same Next.js frontend** (`:3000`):
`proxy.ts` rewrites the `help.` host to `app/help-center`, and org `/help…`
pages 307-redirect there (not on custom domains, plain localhost or single
tenancy — those keep the in-org pages). `help` and `docs` are reserved
subdomains, so no organization can take them.

- [x] **DNS**: nothing to add — the `*.validbridge.co.ke` wildcard already covers
  `help.`. (An explicit `help` record is optional.)
- [x] **nginx**: nothing to add — the wildcard frontend vhost already accepts
  `*.validbridge.co.ke` and must pass the original `Host` header
  (`proxy_set_header Host $host;`), which it already does for org subdomains.
- [x] **Cloudflare**: proxied (orange cloud) is fine — it is plain HTTP(S).
  The Universal SSL certificate covers first-level `*.validbridge.co.ke`.
- [ ] After deploy: open `https://help.validbridge.co.ke` and
  `https://{org}.validbridge.co.ke/help` (should land on the help host).
- Note: `docs.validbridge.co.ke` is also reserved. If the docs site is deployed
  separately, give `docs` its own DNS record pointing at that host — otherwise
  the wildcard sends it to this frontend, where it is not an organization.

> Without DNS + TLS + proxy, `slug.your-domain.tld` and customer domains will not
> resolve/secure. Adding an institution is then just an `organization` row.

---

## 7b. Live classroom (LiveBridge) 🟠 — self-hosted LiveKit

LiveBridge is off until LiveKit is configured: until then **Start lesson /
Join** return "Live lessons are temporarily unavailable" (scheduling, the course
card and the student "Live lessons" page still work). Everything else — auth,
enrollment, chat, polls, quizzes, attendance — is ValidBridge; LiveKit only
carries audio/video.

### Required (live lessons)

- [ ] **LiveKit server** on its own subdomain, e.g. `live.validbridge.co.ke`.
  - Get: self-host `livekit/livekit-server` (Docker, host networking) — see
    https://docs.livekit.io/home/self-hosting/deployment/. Generate an API
    key/secret pair (`docker run --rm livekit/livekit-server generate-keys`) and
    put them in the LiveKit config (`keys:`).
  - ⚠️ **DNS must be DNS-only (grey cloud) in Cloudflare** — the Cloudflare proxy
    cannot carry WebRTC. LiveKit needs its own TLS certificate for the
    subdomain (LiveKit's built-in Caddy/Let's Encrypt, or nginx `stream`).
  - ⚠️ **Open ports** in the Oracle **security list AND the Ubuntu iptables rules**
    (Oracle images block by default): `443/tcp` (signalling via TLS),
    `7881/tcp` (ICE/TCP fallback), `50000-60000/udp` (media) — or `7882/udp` if
    you enable single-port UDP mux. For learners on restrictive networks enable
    LiveKit's built-in **TURN** (`turn:` in the config; `3478/udp` and TURN/TLS on
    `5349/tcp` or a separate 443 hostname).
  - Server env (API):
    - `LIVEKIT_URL=wss://live.validbridge.co.ke` — public URL browsers connect to
    - `LIVEKIT_API_KEY=<key>`
    - `LIVEKIT_API_SECRET=<secret>` — **API only; never in any `NEXT_PUBLIC_*`**
    - `LIVEKIT_API_URL=http://<private-ip>:7880` *(optional)* — if the API can
      reach LiveKit over a private network instead of the public URL
- [ ] **LiveKit config** `~/livekit/livekit.yaml` — no IPs hard-coded: LiveKit
  discovers the VM's public IP via STUN (`use_external_ip`), which matters on
  Oracle because the VM only sees its private IP.
  ```yaml
  port: 7880                    # HTTP/WebSocket (behind TLS, see below)
  bind_addresses: [""]
  rtc:
    use_external_ip: true       # advertise the public IP, discovered at start
    tcp_port: 7881              # ICE/TCP fallback when UDP is blocked
    port_range_start: 50000     # WebRTC media over UDP
    port_range_end: 60000
  turn:                         # for learners behind strict firewalls/proxies
    enabled: true
    domain: turn.validbridge.co.ke   # its own DNS-only (grey cloud) record
    udp_port: 3478
    tls_port: 5349              # TURN over TLS; needs cert_file/key_file below
    cert_file: /certs/turn.crt
    key_file: /certs/turn.key
  keys:
    <LIVEKIT_API_KEY>: <LIVEKIT_API_SECRET>
  webhook:
    api_key: <LIVEKIT_API_KEY>
    urls:
      - https://api.validbridge.co.ke/api/v1/live/webhook
  ```
  Start it (host networking so the UDP range works):
  ```bash
  docker run -d --name livekit --restart unless-stopped --network host \
    -v ~/livekit/livekit.yaml:/livekit.yaml -v ~/livekit/certs:/certs:ro \
    livekit/livekit-server --config /livekit.yaml
  ```
  TLS for `wss://live.validbridge.co.ke`: terminate on the VM (nginx/Caddy with a
  Let's Encrypt cert for the grey-cloud hostname) and proxy to `127.0.0.1:7880`
  with WebSocket upgrade headers. Get the TURN cert the same way
  (`certbot certonly --standalone -d turn.validbridge.co.ke`) and copy it into
  `~/livekit/certs`.
  Ubuntu firewall (Oracle images default to REJECT; mirror these in the VCN
  security list):
  ```bash
  for p in 443 7881 5349; do sudo iptables -I INPUT -p tcp --dport $p -j ACCEPT; done
  sudo iptables -I INPUT -p udp --dport 3478 -j ACCEPT
  sudo iptables -I INPUT -p udp --dport 50000:60000 -j ACCEPT
  sudo netfilter-persistent save
  ```
- [ ] **Verify transports.** `docker logs livekit | grep -i "external\|ip"` should
  show the VM's public IP. After a test lesson, the app logs which transport each
  browser actually used (`live_connected` analytics event: `host/udp`,
  `srflx/udp`, `…/tcp` = TCP fallback, `relay/…` = TURN), plus every
  `live_reconnecting`/`live_connection_failed`. To test the fallbacks, block UDP
  on a test laptop (e.g. `sudo iptables -A OUTPUT -p udp --dport 50000:60000 -j DROP`)
  and join: the event should report `/tcp`; also blocking 7881 should give
  `relay/…`.
- [ ] **API logs** — every live event is one line starting `live.` (e.g.
  `live.session.created`, `live.token.issued`, `live.join.denied code=ENROLLMENT_REQUIRED`,
  `live.webhook.processed`, `live.attendance.recorded`, `live.recording.ready`,
  `live.livekit.call_failed`, `live.session.auto_ended reason=host_absent`).
  Tokens and secrets are never logged. `docker compose logs backend | grep " live\."`.
- [ ] **LiveKit webhook → ValidBridge** (attendance and lesson state in real time):
  the `webhook:` block in the config above. Its `api_key` must be the same key
  as `LIVEKIT_API_KEY`. Without it things still work, just slower: the API reconciles with LiveKit
  every 30s (`VALIDBRIDGE_LIVE_RECONCILE_INTERVAL_SECONDS`).
- [ ] **nginx**: nothing to add for the API (webhook is a normal
  `/api/v1/...` route). Do **not** proxy LiveKit media through the existing
  nginx/Cloudflare path.
- [ ] Restart: `docker compose up -d backend` (no frontend rebuild needed — the
  browser gets `LIVEKIT_URL` from the API with each join token).

### Optional — recordings (LiveKit Egress)

Recordings are written by Egress **straight to R2** and appear in the course as
normal video lessons (HLS + captions apply). They are **never stored on the
VM disk**, so they need §2 (R2) done first.

**What to do (in order):**

- [ ] **1. Finish §2 first — R2 storage.** Create the bucket + R2 API token and
  set on the API: `VALIDBRIDGE_CONTENT_DELIVERY_TYPE=s3api`,
  `VALIDBRIDGE_S3_API_BUCKET_NAME`, `VALIDBRIDGE_S3_API_ENDPOINT_URL`,
  `VALIDBRIDGE_S3_API_REGION=auto`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
  The API hands these same credentials to Egress in each recording request, so
  **Egress itself needs no storage config**.
- [ ] **2. Give LiveKit a Redis.** Egress and LiveKit talk through Redis. In the
  LiveKit server config add:
  ```yaml
  redis:
    address: <redis-host>:6379   # the VM's Redis, or a dedicated one
  ```
  If you reuse the app's Redis container, expose it only on the private network
  (never publicly), then restart LiveKit.
- [ ] **3. Pick where Egress runs.** ⚠️ Egress runs headless Chrome and uses
  ~2–4 vCPU per active recording. On the 4-OCPU A1 VM a recording competes with
  the API + HLS transcoding — prefer a **separate small instance** (it only needs
  outbound access to LiveKit, Redis and R2; no inbound ports). Confirm the
  `livekit/egress` tag you pull supports `linux/arm64` if the host is ARM.
- [ ] **4. Create the Egress config** `~/livekit-egress/config.yaml`:
  ```yaml
  log_level: info
  api_key: <same as LIVEKIT_API_KEY>
  api_secret: <same as LIVEKIT_API_SECRET>
  ws_url: wss://live.validbridge.co.ke
  redis:
    address: <same redis as step 2>:6379
  ```
- [ ] **5. Start Egress:**
  ```bash
  docker run -d --name livekit-egress --restart unless-stopped \
    --cap-add SYS_ADMIN \
    -e EGRESS_CONFIG_FILE=/out/config.yaml \
    -v ~/livekit-egress:/out \
    livekit/egress
  docker logs -f livekit-egress   # should start without redis/auth errors
  ```
- [ ] **6. Turn recordings on in ValidBridge** (API `.env`):
  `VALIDBRIDGE_LIVE_RECORDING_ENABLED=true`
  (optional `VALIDBRIDGE_LIVE_RECORDING_LAYOUT=speaker|grid|single-speaker`),
  then `docker compose up -d backend`.
- [ ] **7. Webhook** — nothing new: the LiveKit webhook above also delivers the
  `egress_*` events (recording started/ready/failed). Without it the reconciler
  still picks recordings up, just slower.
- [ ] **8. Verify:** start a lesson → the lecturer now sees a **Record** button →
  record ~1 minute → stop → within a few minutes the recording shows under
  **Past lessons** on the course card and in the course dashboard's LiveBridge
  tab, and the MP4 exists in R2 at
  `content/orgs/<org>/courses/<course>/activities/<activity>/video/recording.mp4`.
  If it shows **Failed**: check `docker logs livekit-egress` (usually R2
  credentials/endpoint, or Egress not on the same Redis as LiveKit).

Lessons scheduled with **"Record automatically"** start recording as soon as the
lecturer starts the lesson; **"Publish recordings"** decides whether students see
the recording straight away or it stays a draft for the lecturer.

### Optional tuning (defaults are fine)

| Env | Default | Meaning |
|---|:---:|---|
| `VALIDBRIDGE_LIVE_TOKEN_TTL_SECONDS` | 600 | join-token lifetime (only checked at connect) |
| `VALIDBRIDGE_LIVE_READY_TIMEOUT_MINUTES` | 60 | a started lesson with no lecturer ends after this |
| `VALIDBRIDGE_LIVE_HOST_ABSENT_GRACE_MINUTES` | 15 | lesson ends if no lecturer is connected this long |
| `VALIDBRIDGE_LIVE_MAX_DURATION_HOURS` | 8 | hard cap per lesson |
| `VALIDBRIDGE_LIVE_ROOM_EMPTY_TIMEOUT_SECONDS` | 600 | LiveKit closes an empty room after this |
| `VALIDBRIDGE_LIVE_MAX_PARTICIPANTS` | 0 | 0 = unlimited |
| `VALIDBRIDGE_LIVE_LATE_GRACE_MINUTES` / `_EARLY_LEAVE_GRACE_MINUTES` | 5 / 5 | attendance: late / left-early thresholds |
| `VALIDBRIDGE_LIVE_PRESENT_THRESHOLD_PERCENT` | 75 | below this share of the lesson = "partial" |
| `VALIDBRIDGE_LIVE_PROCESSING_TIMEOUT_HOURS` | 6 | give up waiting for a recording |
| `VALIDBRIDGE_LIVE_RECORDING_FINALIZE_TIMEOUT_MINUTES` | 60 | recording file must reach R2 within this |

### Local development (no real keys needed)

```bash
docker run -d --name livekit-dev -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev --bind 0.0.0.0
# apps/api/.env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```
Restart the API. (Webhooks aren't needed locally — the 30s reconciler covers it.)

### Verify

1. As a lecturer: course page → LiveBridge → **Schedule** → open it → **Start lesson**.
2. As an enrolled student: sidebar **Live lessons** shows it as LIVE → **Join now**.
3. Course dashboard → **LiveBridge** tab shows attendance after the lesson ends.

---

## 7c. Server B (code execution, workers, staging, backups) 🔵

A second Oracle VM in a **separate tenancy** (the owner's brother's account):
A1.Flex **arm64**, Ubuntu 24.04, cgroup v2. No public ports except SSH; linked
to Server A by **WireGuard** (A `10.66.0.1` ↔ B `10.66.0.2`, UDP 51820).
Full setup, the Judge0-vs-Piston decision and templates:
**[`infra/server-b/README.md`](../infra/server-b/README.md)**.

- [x] Docker Engine + compose, `wireguard-tools`, unattended security upgrades (2026-09-25)
- [x] WireGuard tunnel A ↔ B live (`wg-quick@wg0` on both)
- [x] Backup target: user `vbbackup`, `/srv/validbridge-backups` (A pushes over the tunnel)
- [ ] Code execution: official Judge0 images are amd64-only and need cgroup v1,
  so B will run **Piston (arm64 build) behind a Judge0-compatible adapter** on
  `10.66.0.2:2358`; then set `VALIDBRIDGE_JUDGE0_API_URL=http://10.66.0.2:2358`
  and `VALIDBRIDGE_JUDGE0_CLIENT_SECRET` on A
- [ ] Resize to 4 OCPU / 24 GB / 100 GB (owner, Oracle console)
- [ ] `transcode-worker`, LiveKit Egress, staging (after R2, §2)

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
| `VALIDBRIDGE_SUPERADMIN_REQUIRE_2FA` | 🟠 | `false` | superadmin sessions need 2FA (enable after enrolling; see DEPLOYMENT.md security checklist) |
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
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | 🟠 | — | live classroom (LiveBridge) — see §7b |
| `LIVEKIT_API_URL` | 🟡 | from `LIVEKIT_URL` | private LiveKit API address |
| `VALIDBRIDGE_LIVE_RECORDING_ENABLED` / `_RECORDING_LAYOUT` | 🟡 | `false` / `speaker` | live lesson recordings (needs Egress + R2) |
| `VALIDBRIDGE_LIVE_*` (tuning) | 🟡 | see §7b | lesson timeouts, attendance thresholds |
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
| 10 | **LiveKit (LiveBridge live lessons)** | self-host LiveKit on a DNS-only subdomain, open ports, add webhook — see §7b | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | lessons can be scheduled but not started/joined |
| 11 | *(optional)* **LiveKit Egress (recordings)** | deploy Egress + finish item 8 (R2) — see §7b | `VALIDBRIDGE_LIVE_RECORDING_ENABLED=true` | Record button hidden; no recordings |

**Not a secret — usage step:** create organizations; each is served at
`{slug}.validbridge.co.ke` (the seeded org is `default.validbridge.co.ke`).
Custom domains per org are supported via Dashboard → Domains (needs the org's
DNS TXT/CNAME).
