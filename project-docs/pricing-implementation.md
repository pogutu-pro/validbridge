# ValidBridge — Pricing, Billing & Infrastructure Implementation Plan

> Written 2026-09-25. The **what** (prices, plans, rules) is in
> [`pricechange.md`](pricechange.md); this file is the **how**, split into
> workstreams that separate agents can run in parallel. Read §0–§4 before
> taking any workstream.

---

## 0. Summary

Build usage-based pricing on **Paystack only**:

- new plans (Public Education, Starter, Growth, Business, Enterprise)
- per-instructor learner allowance, metering and enforcement
- a prepaid wallet and saved cards
- a superadmin console that controls prices and every limit
- updated public pages
- self-hosted Judge0 and workers on a second Oracle VM
- a local AI model

The Stripe code is removed. There are **no customers yet**, so plans are
replaced outright (only the demo org needs care).

**The three rules that keep this safe:**
1. **Money is exact.** Integer KES cents, append-only ledger, server-computed
   amounts, idempotent webhooks.
2. **Nothing ships enforced.** Every limit has `off | shadow | enforce`
   switches; production runs `shadow` until launch sign-off (§9).
3. **Limits never destroy.** At a limit, *new* usage pauses; existing content,
   classes in progress and data are never deleted or cut off.

---

## 1. Ground truth — reuse these, don't reinvent

| Need | Already in the repo |
|---|---|
| Plan definitions, limits | `apps/api/src/security/features_utils/plans.py` (`PLAN_FEATURE_CONFIGS`, `PLAN_HIERARCHY`, `AI_CREDIT_LIMITS`) |
| Feature resolution (plan → overrides → packs → admin toggles) | `apps/api/src/security/features_utils/resolve.py` |
| Usage counting, admin seats | `apps/api/src/security/features_utils/usage.py` (`_get_actual_admin_seat_count`, `check_limits_with_usage`) |
| Atomic AI credits (Redis Lua), purchased credits | `usage.py` `reserve_ai_credit`, key `ai_credits_purchased:{org}` |
| **Monthly active users + overage** | `apps/api/src/security/features_utils/active_users.py` |
| Router-level plan checks | `apps/api/src/security/features_utils/plan_check.py` (`get_org_plan`, `require_plan`) |
| Deployment mode | `apps/api/src/core/deployment_mode.py` — **hardcoded `'ee'` (everything unlocked)** |
| Paystack client | `apps/api/src/services/payments/paystack.py` (initialize, verify, plans, subscriptions, webhook signature) |
| Course-sales payments (per-org keys) | `apps/api/src/services/payments/service.py` — keep separate from platform billing |
| Secret encryption at rest | `apps/api/src/security/secret_crypto.py` (`encrypt_secret`) — used by SSO |
| Uploads (single entry point) | `apps/api/src/services/utils/upload_content.py` (`upload_file`, `upload_content`), paths `orgs/{org_uuid}/…`, filesystem or S3/R2 |
| Recordings | `LiveRecording.file_size` in `apps/api/src/db/live_sessions.py` |
| Live sessions (org, instructor, start/end) | `LiveSession` + `apps/api/src/services/live/sessions.py` (`mark_live`, `finalize_session`) |
| HLS transcoding queue | `apps/api/src/services/utils/hls_jobs.py` — Redis queue `validbridge:hls:queue` + `transcode-worker` CLI |
| Code execution (Judge0 client) | `apps/api/src/routers/code_execution.py` (headers `X-Judge0-Client-ID/Secret`, batch limits) |
| AI model tiers | `apps/api/src/services/ai/llm/tiers.py` (fast / standard / pro → Gemini) |
| RAG (knowledge retrieval) | `apps/api/src/services/ai/rag/` |
| Email sending | `apps/api/src/services/email/utils.py` `send_email` (Resend or SMTP, platform-wide) |
| Email branding / watermark | `apps/api/src/services/email/branding.py` (`general.watermark`) |
| Site badge | `apps/web/components/Objects/Watermark.tsx` |
| Demo org guard | `apps/api/src/services/demo/guards.py` `is_demo_org` |
| Superadmin API | `apps/api/src/routers/superadmin.py` (plan, config, admin_toggles, usage) |
| Superadmin UI | `apps/web/app/admin/(dashboard)/organizations/[orgId]/page.tsx` (Plan tab hidden unless `saas`) |
| Upgrade prompts | `apps/web/components/Dashboard/Shared/PlanRestricted/*`, `FeatureGate`, `services/features/featureMetadata.ts` |
| SSO | `apps/api/src/routers/sso.py`, providers `workos` + `oidc` |
| Public pages | `apps/web/app/site/*`, `apps/web/lib/site/content.ts`, `lib/site/legal.ts` |

---

## 2. Non-negotiables

1. **Money in integer cents** (`amount_cents: int`, KES × 100). No floats anywhere
   in billing.
2. **The server computes every amount** from the price catalogue. The client
   sends *what* (item, quantity), never *how much*.
3. **Every Paystack result is verified server-side** (`verify_transaction`: status,
   amount, currency `KES`, reference ownership) before anything is granted.
4. **Idempotency everywhere:** unique `reference` per payment attempt; unique
   Paystack event ID per webhook; an idempotency key on purchase requests.
   Replaying a webhook grants nothing twice.
5. **Append-only ledger.** Balances are derived; corrections are new entries.
6. **Card data never touches our servers.** Paystack Popup / hosted checkout
   only; store the `authorization_code` encrypted (`secret_crypto`) plus brand,
   last4, expiry, card signature.
7. **Row locks on money moves** (`SELECT … FOR UPDATE` on the billing account)
   so concurrent purchases can't overspend the wallet or the spending limit.
8. **Demo org is never billed or limited** (`is_demo_org`).
9. **Every limit is a switch** (`off | shadow | enforce`), readable by the
   superadmin, default `shadow` in production.
10. **Every superadmin money action is audit-logged** with actor, reason and
    before/after values.
11. **Tests with every PR;** CI green before merge. `main` deploys to production.

---

## 3. Target architecture

```
                ┌────────────── price_catalog (DB, versioned, superadmin-editable)
                │
plan + add-ons + packs + overrides ──► Entitlements(org)  ◄── cached in Redis 60 s
                                            │
   enforcement points ──check──►  Entitlements + UsageCounters(org, month)
   (upload, go live, AI, code run, invite, email, SSO, API, domain, badge)
                                            │ shadow: log only / enforce: block
                                            ▼
                               402/403 with error contract (§4.3)

Paystack (platform account) ──webhook──► billing engine ──► ledger / invoices / grants
monthly job (1st, 00:30 EAT) ──► invoice ──► wallet → saved card → pay link (M-Pesa)
```

### 3.1 Servers

| | **Server A — owner (existing)** | **Server B — brother (new)** | **Server C — later** |
|---|---|---|---|
| Runs | nginx, web, API, Postgres, Redis, LiveKit SFU | Judge0, LiveKit Egress (recordings), `transcode-worker`, **staging** | Local AI model |
| Public ports | 80/443, LiveKit ports | none (SSH only) | none |
| Talks to | B and C over WireGuard | A over WireGuard (Redis for queues; R2 for files) | A over WireGuard |

Oracle accounts are separate tenancies, so connect them with **WireGuard**
(or Tailscale), not VCN peering.

**Moving workers to B requires files in R2 first** (the filesystem backend is
local to A).

---

## 4. Shared contracts (Workstream W0 creates these first)

### 4.1 Plan IDs (clean switch, no customers)

`public-education`, `starter`, `growth`, `business`, `enterprise`.
Remove `free`, `personal`, `personal-family`, `standard`, `pro` everywhere
(API literals, web types, tests, admin UI). New orgs default to **`starter`**.
The demo org is set to `business` with billing exempt.

### 4.2 Data model (new, Alembic migrations in `apps/api/migrations`)

| Table | Key columns | Notes |
|---|---|---|
| `price_catalog` | `id, version, effective_from, items JSONB, created_by` | Seeded from `pricechange.md`; invoices snapshot the version |
| `billing_account` | `org_id PK, billing_email, status (active/past_due/paused), cycle (monthly/yearly), period_start, spending_limit_cents, auto_add_seats bool, paystack_customer_code, exempt bool` | One per org |
| `payment_method` | `id, org_id, auth_code_enc, signature, brand, last4, exp_month, exp_year, bank, channel, reusable, is_default, created_by, created_at` | Unique `(org_id, signature)` |
| `ledger_entry` | `id, org_id, amount_cents (±), kind, ref_type, ref_id, balance_after_cents, created_at, actor_id` | Append-only; kinds: `topup, charge, grant, refund, adjustment` |
| `invoice` | `id, org_id, number, period, lines JSONB, subtotal_cents, tax_cents, total_cents, status (draft/open/paid/void/failed), paid_via, catalog_version, etims_ref` | Lines snapshot unit prices |
| `payment_attempt` | `reference UNIQUE, org_id, purpose, amount_cents, status, paystack_status, created_by, raw_hash` | Every initialize or charge |
| `paystack_event` | `event_id UNIQUE, type, reference, received_at, processed_at` | Webhook idempotency |
| `org_addon` | `org_id, addon (live_unlimited/managed_email/remove_badge/extra_seat), quantity, started_at, ends_at` | Monthly add-ons |
| `pack_balance` | `org_id, kind (ai_credits/live_seconds/code_runs), remaining, updated_at` | Purchased, non-expiring |
| `usage_counter` | `org_id, metric, period (YYYY-MM), used, updated_at` | Unique `(org_id, metric, period)` |
| `storage_snapshot` | `org_id, bytes, measured_at, source` | Nightly scan result |
| `public_ed_application` | `id, org_id, institution, type, reg_number, email_domain, document_key (private), status, reviewed_by, reviewed_at, expires_at, agreement_version` | Yearly renewal |
| `org_email_config` | `org_id, provider (resend/smtp), secret_enc, from_address, verified_at` | Bring your own key |
| `enforcement_flag` | `metric, mode (off/shadow/enforce)` | Global; per-org override in `billing_account` |

### 4.3 Entitlements API (single source every check uses)

`apps/api/src/security/features_utils/entitlements.py`

```python
@dataclass(frozen=True)
class Entitlements:
    plan: str
    instructor_seats: int          # included + extra-seat add-ons + overrides
    learner_allowance: int         # 200 × seats (or override); None = unlimited
    storage_bytes: int
    live_seconds_month: int        # plan allowance; packs tracked separately
    live_unlimited_instructors: set[int] | int
    live_concurrency: int
    premium_ai_credits_month: int
    code_runs_month: int
    managed_email: bool
    byo_email: bool
    features: dict[str, bool]      # api, webhooks, custom_domain, sso, remove_badge …
    exempt: bool                   # demo / comped

async def get_entitlements(org_id: int, db) -> Entitlements
async def check(org_id, metric, amount, db) -> Decision   # allowed | shadow_blocked | blocked
async def record_usage(org_id, metric, amount, db) -> None
```

### 4.4 Error contract (web reads `error_code`)

HTTP **402** when payment unlocks it, **403** when the plan doesn't include it.

```json
{ "error_code": "storage_quota_exceeded",
  "metric": "storage", "used": 2147483648, "limit": 2147483648,
  "options": ["buy_storage", "upgrade"], "message": "…" }
```

Codes: `seat_limit_reached`, `learner_allowance_grace`, `learner_allowance_exceeded`,
`storage_quota_exceeded`, `live_hours_exhausted`, `live_concurrency_limit`,
`premium_ai_credits_exhausted`, `code_runs_exhausted`, `email_not_enabled`,
`feature_not_in_plan`, `billing_paused`, `spending_limit_reached`.

### 4.5 Feature flags (env, read by `src/core/billing_flags.py`)

`VALIDBRIDGE_DEPLOYMENT_MODE=ee|saas` (**W0 makes this env-driven**; default `ee`
locally), `VALIDBRIDGE_BILLING_ENABLED`, `VALIDBRIDGE_ENFORCEMENT_DEFAULT=shadow`,
platform keys `VALIDBRIDGE_PLATFORM_PAYSTACK_SECRET_KEY` / `_PUBLIC_KEY`
(separate from org course-sale keys; the public key is safe for
`NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, the secret never is).

---

## 5. Workstreams

Each: **goal · depends on · owns (files) · tasks · tests · done when.** An agent
edits only files it owns; changes to shared files go through the W0 owner.

### W0 — Foundations (serial, first, one agent)
- **Depends:** none. **Blocks:** everything.
- **Owns:** `plans.py`, `resolve.py`, `deployment_mode.py`, `organization_config.py` (plan literal), new `entitlements.py`, `billing_flags.py`, all new migrations/models in `src/db/billing/`, `price_catalog` seed.
- **Tasks:**
  1. Make `get_deployment_mode()` read `VALIDBRIDGE_DEPLOYMENT_MODE` (default `ee`); keep behaviour identical when unset.
  2. Replace plan IDs (§4.1) in `PLAN_FEATURE_CONFIGS`, `PLAN_HIERARCHY`, `AI_CREDIT_LIMITS`, `FEATURE_PLAN_REQUIREMENTS` (SSO → `enterprise`; API/webhooks/custom domain → `growth`; analytics_advanced, versioning, audit_logs, roles, communities, boards, podcasts, playgrounds → `public-education`, i.e. every plan).
  3. Add `COST_GATED_FEATURES = {"sso"}`, resolved by plan **in every mode** (so SSO is locked even in `ee`), with the per-org `force_enabled` override for deals.
  4. Create all §4.2 tables and models; seed `price_catalog` v1 from `pricechange.md` §3–4.
  5. Implement `entitlements.py` (§4.3) and the error contract helper (§4.4).
  6. Replace `free/standard/pro` in API tests; update web types `PlanId` (`services/billing/plans.ts` is deleted in W2, so only `services/plans/plans.ts` and the admin page lists).
- **Tests:** entitlements for each plan; SSO locked in `ee`; mode env switch; migration up/down.
- **Done:** CI green; production behaviour unchanged (mode still `ee`, flags `shadow`).

### W1 — Security prerequisites (parallel with W0, small)
- **Owns:** `infra.md`, `.gitignore`, `security/superadmin.py`.
- **Tasks:**
  1. **Remove the default admin password from `infra.md`**, rotate that password in production, and note that it remains in git history (the repo is private; if it's ever shared, rewrite history).
  2. Require 2FA for superadmins (block superadmin endpoints until enrolled).
  3. Confirm `*.key` stays gitignored (it is); store VM keys in a password manager, not the repo folder.
  4. Add audit logging to every superadmin money/limit action (helper used by W11).
- **Done:** password rotated, superadmin 2FA enforced, audit helper merged.

### W2 — Remove Stripe (parallel after W0)
- **Owns:** everything below.
- **Delete:** `apps/web/app/api/billing/**`; `apps/web/services/billing/stripe.ts`, `subscriptionUtils`, `services/billing/plans.ts`; the Stripe bits of `activeUserBilling.ts` (keep any pure helpers W3 needs, or move them to the API); the `stripe` dependency in `apps/web/package.json` and `apps/api/pyproject.toml`; the `/payments/stripe/connect/oauth` branch in `proxy.ts`; Stripe exemptions in `apps/api/src/security/csrf.py`; Stripe code in `apps/api/src/services/packs/packs.py` and `routers/orgs/packs.py` (packs move to W3); Stripe mentions in `OfferCard.tsx`, `AccountPurchases.tsx`, `lib/errors/catalog.ts`, locale keys; tests `billing-*.test.mjs`; `STRIPE_*` env in docs/compose.
- **Keep:** `app/(hub)/billing` and `app/(hub)/new` routes (UI rebuilt in W9 — stub them to "Billing is being upgraded" until then).
- **Tests:** `grep -ri stripe` returns only historical docs; web and API suites green.
- **Done:** no Stripe code or dependency; hub pages render the stub.

### W3 — Paystack billing engine (parallel after W0)
- **Owns:** `apps/api/src/services/billing/**` (new), `apps/api/src/routers/billing.py` (new), `paystack.py` (add functions only).
- **Tasks:**
  1. `paystack.py`: add `charge_authorization`, `create_customer`, `refund`, `check_pending_charge`; keep course-sales functions untouched.
  2. **Checkout** `POST /api/v1/billing/checkout {item, quantity, save_card, idempotency_key}` → price from catalogue → `payment_attempt` → `initialize_transaction` (reference `vbp_{org}_{uuid}`, channels `card, mobile_money, bank_transfer`, currency KES, amount in cents) → return `access_code` for Paystack Popup.
  3. **Webhook** `POST /api/v1/billing/paystack/webhook` (platform secret, HMAC-SHA512, raw body) → store `paystack_event` (unique) → `verify_transaction` → in one DB transaction: mark attempt, ledger entry, grant (pack/add-on/wallet/invoice paid) → invalidate the entitlements cache.
  4. **Saved cards:** on `charge.success` with `channel=card`, `authorization.reusable` and `save_card=true` → encrypt and store; dedupe by `signature`. Endpoints: list, set default, delete (removes our token).
  5. **One-click purchase** `POST /billing/charge-saved {item, payment_method_id, idempotency_key}` → `charge_authorization`; handle `success` / `send_otp` / `pending` / `failed` (fall back to Popup on OTP or pending).
  6. **Wallet:** top-up via checkout; balance = sum of the ledger; purchases draw from the wallet first when the school chooses.
  7. **Monthly job** (1st, 00:30 EAT; `cli.py billing run-cycle`, cron on A): per org, build the invoice (base, seats, add-ons, storage over allowance from the latest snapshot), apply wallet → default card → else open the invoice and email a pay link (M-Pesa). Idempotent per `(org, period)`.
  8. **Dunning:** retries on D+1, D+3, D+5 with emails; then `status=paused` (paid features pause, read-only; nothing deleted); paying resumes immediately.
  9. **Spending limit:** block overage purchases or auto-seats that would pass it (`spending_limit_reached`).
  10. **Reconciler** (hourly): re-verify `pending` attempts older than 15 minutes with Paystack, so a missed webhook still completes.
  11. **Refunds/disputes:** `refund.processed`, `charge.dispute.*` → ledger plus a superadmin alert.
  12. **Invoices:** number series, PDF, email; `etims_ref` field left for the accountant decision.
- **Tests:** webhook signature (valid, invalid, replay); amount or currency mismatch rejected; double webhook → one grant; concurrent purchases vs wallet (row lock); spending limit; charge_authorization statuses mocked; dunning state machine; the monthly job idempotent.
- **Done:** a full purchase works end-to-end with **Paystack test keys** (card + test M-Pesa) on staging.

### W4 — Metering and enforcement (parallel after W0; split into 4a–4e)
All use `entitlements.check()` / `record_usage()` and respect flags (`shadow` = log + allow).

- **4a Seats and learners.** Owns `usage.py` (new `instructor_seats`), invite/role-assignment call sites (mirror where `admin_seats` is checked). Seat = Admin/Maintainer/Instructor role. Learner allowance from `active_users.py`: over the allowance → 7-day grace (`learner_allowance_grace`), then block *new* learners (`learner_allowance_exceeded`); `auto_add_seats` → W3 adds a seat add-on within the spending limit. Public Education: unlimited seats.
- **4b Storage.** Owns `upload_content.py` and a new `services/billing/storage_meter.py`. Fast path: Redis `storage_used:{org}` incremented on upload (orgs only). Truth: a nightly scan of the org prefix (filesystem walk or S3 `list_objects_v2` sum), including HLS output and recordings → `storage_snapshot` and a Redis reset. Enforce before upload (`storage_quota_exceeded`). Recordings past retention on Public/Starter are deleted only after 3 warning emails, and only when the storage cap is exceeded and unpaid (confirm with the owner).
- **4c Live.** Owns `services/live/sessions.py` checks. At `mark_live`/start: concurrency = count of `LIVE` sessions for the org (`live_concurrency_limit`); hours = plan allowance − used + pack balance, unless the instructor has LiveBridge Unlimited (`live_hours_exhausted`). **Never stop a class in progress.** At `finalize_session`: record duration; draw from allowance, then packs. Recording start requires storage headroom.
- **4d AI and code.** Owns `services/ai/llm/tiers.py` routing hooks, `reserve_ai_credit` call sites, `code_execution.py`. Own-model tasks: no credits, per-org hourly rate limit. Premium tasks (images 5, audio 3, captions per minute, pro model 3): monthly allowance → `pack_balance` (mirror into existing Redis keys, with Postgres as truth). Code runs: counter per run (batch = per test case) + hourly limit (`code_runs_exhausted`).
- **4e Email.** Owns `send_email` classification. Tag every call site `essential` (verification, reset, magic link, invites, receipts, billing) or `engagement` (nudges, reminders, announcements, live invitations). Engagement sends only with managed email (counted; 5,000/month) or a BYO key (W6); otherwise skip + log (`email_not_enabled` in the UI).
- **Tests (each):** shadow logs but allows; enforce blocks with the exact error code; demo exempt; limits never delete; concurrency race (two go-lives at once).
- **Done:** all metrics visible in `usage_counter`, running in `shadow` in production.

### W5 — Lock SSO to Enterprise (small, parallel after W0)
- **Owns:** `apps/api/src/routers/sso.py`, `OrgEditSSO.tsx`.
- **Tasks:** gate create, update (enabling only), setup-url, check and authorize on `entitlements.features["sso"]` (Enterprise or `force_enabled`); disabling and deleting always allowed. The UI shows "Enterprise feature — talk to us".
- **Tests:** non-Enterprise → 403 `feature_not_in_plan`; Enterprise ok; override ok; login button hidden when not entitled.

### W6 — Bring-your-own email key (after W4e contract)
- **Owns:** `org_email_config`, `services/email/org_provider.py`, org settings UI "Email sending".
- **Tasks:** store a Resend key or SMTP credentials encrypted; a "send test email" check sets `verified_at`; `send_email(org_id=…)` uses the org's provider for engagement mail and the platform provider for essential mail; SPF/DKIM guide in the Help Center.
- **Tests:** key encrypted at rest and never echoed back; fallback when the org key fails (engagement skipped, never essential).

### W7 — Public Education verification
- **Owns:** `public_ed_application`, application UI in org settings, superadmin review queue (with W11).
- **Tasks:** apply form (institution, type, registration/TSC number, official email domain check, document upload to a **private** prefix never served publicly), agreement acceptance (versioned), superadmin approve/reject with reason → plan `public-education` for 12 months; reminders at 30/7 days; expiry → `starter` (nothing deleted).
- **Tests:** document not publicly reachable; only superadmin approves; expiry downgrade.

### W8 — Own AI model (infra + routing)
- **Owns:** `tiers.py` provider addition, `infra.md` §AI, Server C setup.
- **Tasks:**
  1. Serve a small quantized model (1–3B, ARM CPU) behind an **OpenAI-compatible** endpoint (llama.cpp server or Ollama) on Server C (or B until C exists), reachable only over WireGuard.
  2. Add a `local` provider with `VALIDBRIDGE_LOCAL_LLM_URL`; route free tasks (drafts, quizzes, feedback, assistant) to it; fall back to Gemini flash-lite when it's down or queued too long (fallback cost acceptable, logged).
  3. **Knowledge:** use the existing RAG pipeline first (fast to update); fine-tuning is a separate ML task, not blocking.
  4. Per-org hourly limit plus a queue with timeout.
- **Tests:** routing by task type; fallback; rate limit.
- **Done:** free tasks served locally in staging; latency recorded.

### W9 — School billing UI (after W3, W4)
- **Owns:** `apps/web/app/(hub)/billing/**`, `(hub)/new/**` plan step, in-app limit dialogs (`PlanRestricted/*`, `UpgradeModal*`).
- **Tasks:** plan picker; **usage meters** (seats, learners, storage, live hours, premium AI, code runs, email); **wallet** (balance, top up via Paystack Popup, history); **payment methods** (saved cards: add via first payment or a KES 50 wallet top-up, set default, remove); packs and add-ons shop; LiveBridge "you'd save" hint; spending limit and auto-add seats; invoices list + PDF; Public Education application entry; 80/100% banners; every §4.4 error code mapped to a dialog with the right options.
- **Tests:** web unit tests for the error-code → dialog mapping; no amount computed client-side.

### W10 — Server B, Judge0, workers, backups (infra; parallel from day 1)
- **Owns:** `infra.md`, `DEPLOYMENT.md`, new `infra/server-b/` (compose files, WireGuard templates — **no secrets**).
- **Tasks:**
  1. **Access:** owner SSH key on B; document ownership (brother's tenancy) in `infra.md`.
  2. **WireGuard** tunnel A↔B (later C); Oracle security lists + iptables: B exposes **no public ports** except SSH (key-only).
  3. **Judge0 spike first (day 1):** the official images may be **x86-only** while Oracle A1 is **ARM**, and Judge0's sandbox (isolate) needs **cgroup v1** (`systemd.unified_cgroup_hierarchy=0` on Ubuntu 22.04+). Try an arm64 build from source; if that fails, choose: (a) an Oracle x86 shape (paid, small), (b) a Piston-based runner with a Judge0-compatible adapter. Record the decision.
  4. **Judge0 config:** `AUTHN_HEADER=X-Judge0-Client-Secret`, `AUTHN_TOKEN=<secret>` (matches the existing client), `ENABLE_NETWORK=false`, CPU/memory/time limits, worker count sized to cores; bind to the WireGuard IP; API env `VALIDBRIDGE_JUDGE0_API_URL=http://<wg-ip>:2358`.
  5. **Files to R2 first** (`finish.md` §4) — required before workers run on B.
  6. **`transcode-worker`** on B consuming `validbridge:hls:queue` (Redis on A over WireGuard, password + bind to WG IP only).
  7. **LiveKit Egress** on B (`infra.md` §7b), output to R2.
  8. **Staging** on B: `staging.validbridge.co.ke` (basic auth), Paystack **test** keys, its own DB.
  9. **Backups:** nightly encrypted `pg_dump` from A → R2 bucket `validbridge-backups` (30-day lifecycle); a **weekly restore test** on B.
  10. **Monitoring:** uptime checks (Cloudflare or UptimeRobot), disk and CPU alerts, Sentry alerts for billing webhook errors.
- **Done:** code runs through self-hosted Judge0 in staging; a transcode job runs on B; a backup has been restored at least once.

### W11 — Superadmin console (after W0, W3)
- **Owns:** `apps/api/src/routers/superadmin.py` (billing endpoints), `apps/web/app/admin/**`.
- **Controls, per org:** plan and cycle; billing status (pause/resume); exempt/comped; **overrides** for every entitlement (seats, learner allowance, storage, live hours, concurrency, AI, code runs, features incl. SSO); **grant packs** (free credits/hours/GB with reason); wallet adjustment (ledger entry with reason); refund (Paystack refund API); discounts/coupons; Enterprise custom price lines; Public Education review queue with document viewer; view invoices, ledger, attempts, usage; per-org enforcement mode.
- **Global:** **price catalogue editor** (new version with `effective_from`; never edits the past); enforcement flags per metric; default fair-use limits; reports (MRR, revenue by plan, failed payments, top usage vs capacity, AI cost vs credit revenue); the billing-job run log.
- **Rules:** superadmin 2FA (W1); every action audit-logged with a reason; money actions need confirmation.
- **Show the Plan tab** whenever `BILLING_ENABLED`, not only in `saas`.

### W12 — Public pages, legal, help (after W0 catalogue; final copy after W3)
- **Owns:** `apps/web/app/site/**`, `components/Site/**`, `lib/site/**`, `lib/help/**` billing articles.
- **Tasks:** pricing page reads the catalogue (`GET /api/v1/billing/catalog`, cached) → KES with ≈USD; the five plans; add-ons and packs; **cost calculator** (instructors, learners, GB, live hours, AI → monthly estimate); comparison table; FAQ (wallet, M-Pesa, saved cards, limits, Public Education); landing pricing section updated; **Terms §Plans & billing** (KES, Paystack, wallet, saved cards, auto-renew, retries and pause, refunds, packs non-expiring, the Public Education agreement); **Privacy** (Paystack holds card data; we store a token; billing records retention); Help Center billing articles; `llms.txt` pricing summary; bump legal `updated`.
- **Tests:** calculator matches the server invoice preview for the same inputs (shared test vectors).

### W13 — Staging, shadow, E2E, launch (last)
See §9.

---

## 6. Waves and parallelism

| Wave | Streams (parallel within a wave) | Exit criteria |
|---|---|---|
| **0** | W0 (one agent), W1, W10 steps 1–4 (Judge0 spike) | Contracts merged; Judge0 decision made |
| **1** | W2, W3, W4a–e, W5, W8, W10 (rest) | Engine + metering in `shadow`; Stripe gone; staging up |
| **2** | W6, W7, W9, W11, W12 | UIs complete against real endpoints |
| **3** | W13 | Launch checklist signed |

Branch per stream `pricing/wN-short-name`; small PRs; rebase on `main`; merge
only when CI is green **and** the feature is behind its flag.

---

## 7. Security plan

| Area | Control |
|---|---|
| Card data | Paystack Popup/hosted only; we store an encrypted `authorization_code` + brand/last4/expiry (PCI SAQ-A scope) |
| Webhooks | HMAC-SHA512 with the platform secret over the raw body; reject unsigned; idempotent by event ID; re-verify with the API; optional Paystack IP allow-list |
| Amounts | Server-side catalogue only; currency must be `KES`; reference must belong to the org |
| Concurrency | Row lock on `billing_account` for wallet/limit moves; unique constraints for idempotency |
| Authorization | Billing endpoints require **org admin**; purchases log `created_by`; superadmin requires 2FA; all money actions audit-logged |
| Secrets | Platform Paystack secret only in server env; org course keys separate; BYO email keys encrypted, never echoed; no secret in `NEXT_PUBLIC_*` |
| Abuse | Rate limits on checkout, charge-saved, code runs, AI, API; spending limit; the hourly reconciler catches stuck payments |
| Files | Public Education documents in a private prefix, served only to superadmins via signed URLs |
| Infra | B/C: no public ports; WireGuard; Judge0 network disabled and resource-capped; Redis password + WG bind; nightly encrypted backups + restore tests |
| Repo hygiene | Remove the admin password from `infra.md` and rotate it (W1); keys stay out of git |
| Compliance | Kenya DPA (Privacy updated, W12); Consumer Protection Act (clear prices, meters, notice of price changes); **KRA eTIMS** invoicing — confirm with an accountant before charging |

---

## 8. Onboarding flows that must never break

Scripted E2E on staging with Paystack test keys (a checklist in W13), run
before launch and after every billing release:

1. **Private trainer:** sign up → `/new` → Starter (no card) → create course → hits the 50-learner cap in shadow (logged) → upgrades to Growth with a card, "save card" ticked → invoice paid → plan active.
2. **Public school:** sign up → apply for Public Education (document + agreement) → superadmin approves → plan switches → 2 GB / 10 h allowances shown.
3. **M-Pesa payer:** top up the wallet with test M-Pesa → buy a live-hours pack from the wallet.
4. **One-click:** buy AI credits with the saved card (success, OTP → fallback to Popup, failure).
5. **Limits:** in `enforce` on a test org: storage cap → upload blocked with a dialog; go-live over concurrency → blocked; a class in progress continues past zero hours; learner grace → 7 days → blocked; nothing deleted.
6. **Missed webhook:** drop a webhook → the reconciler completes within an hour.
7. **Monthly job:** run it for a test period twice → one invoice; wallet → card → pay link order respected; dunning to paused → pay → resumes.
8. **Demo org:** never charged, never limited.
9. **SSO:** Growth org can't configure; Enterprise can.

---

## 9. Launch sequence (W13)

1. Staging passes §8 twice in a row.
2. Production: set `VALIDBRIDGE_BILLING_ENABLED=true`, platform **live** Paystack keys, `VALIDBRIDGE_DEPLOYMENT_MODE=saas`, enforcement `shadow` for all metrics.
3. **Shadow for 2 weeks** with the demo + internal test orgs: compare `shadow_blocked` logs to expectations; fix false positives.
4. Publish the new pricing page, Terms and Help articles (W12).
5. Switch metrics to `enforce` **one at a time**: storage → code runs → premium AI → live concurrency → live hours → seats/learners.
6. The first real monthly job runs with the superadmin watching the run log.
7. **Rollback:** flip the flag back to `shadow` (no deploy needed); billing issues → `BILLING_ENABLED=false` (purchases pause, nothing lost).

**Runbooks** (in `infra.md`): payment succeeded but not granted (reconciler / manual grant with reason), double charge (refund), webhook secret rotation, Paystack outage (wallet-only mode), server B down (code runs and transcoding queue; the site stays up).

---

## 10. Testing strategy

- **API:** pytest per stream; Paystack mocked at the HTTP layer (fixtures for `charge.success`, `refund.processed`, `charge_authorization` statuses); property tests for ledger balances; concurrency tests with parallel requests.
- **Web:** bun tests for the calculator, error-code dialogs and catalogue rendering; shared **invoice test vectors** (JSON) used by the API and web.
- **E2E:** §8 checklist on staging with Paystack test keys.
- **CI:** existing pipeline (~18–30 min); no merge on red.

---

## 11. Open risks and decisions

| Risk | Plan |
|---|---|
| Judge0 on ARM | Day-1 spike (W10.3); fallback x86 shape or Piston adapter |
| Local model speed on CPU | Hybrid routing with Gemini fallback (W8); measure before advertising "free AI" limits |
| Brother's tenancy ownership | Written agreement + owner access; backups off-account |
| eTIMS / VAT | Accountant before charging (blocks the first real invoice, not the build) |
| 1st-of-month load | Monthly job batches orgs; runs off-peak (00:30 EAT) |
| Price mistakes | Versioned catalogue; invoices snapshot prices; superadmin can issue credits |
