# ValidBridge — Launch checklist (the one file to follow)

> Updated 2026-09-25 from a live check of both servers and DNS. **This file
> replaces `finish.md`** and is the only to-do list. Technical commands stay in
> `infra.md` (reference), deploys in `DEPLOYMENT.md`, pricing in
> `pricechange.md` / `pricing-implementation.md`.
>
> Who: **You** = owner · **Brother** = owner of Server B · **Claude** = done by
> the AI agents / me on the servers once you give the go-ahead.
>
> How to set a key on Server A: `ssh` in → edit `~/projects/validbridge/.env` →
> `docker compose up -d backend` (add `frontend` if the name starts with
> `NEXT_PUBLIC_`). Never put a secret in a `NEXT_PUBLIC_*` variable.

Legend: 🔴 blocks launch · 🟠 important · 🟡 later

---

## 0. Status right now (checked 2026-09-25)

| Area | Status |
|---|---|
| Website, API, database, Redis (Server A) | ✅ running |
| Public site (landing, pricing, terms, privacy) | ✅ live |
| AI (Gemini) | ✅ key set |
| Error monitoring (Sentry) | ✅ set |
| Email delivery | ✅ Resend DKIM + `send.` records live · add optional DMARC: TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:support@validbridge.co.ke` |
| Backups | ✅ nightly 02:15 EAT → Server B over the tunnel: DB dump (14 days, **restore tested**) + **mirror of the R2 bucket** (deleted files kept 30 days in `r2/content-deleted/`). Script `/usr/local/bin/validbridge-backup`, log `/var/log/validbridge-backup.log` |
| Live classes (LiveKit) | ✅ installed, keys verified, all ports open from outside, TURN answers, public IP validated · **final check: a real lesson laptop + phone** |
| File storage | ✅ **Cloudflare R2** (`s3api`), write/read tested, 46 existing files copied, served from R2 |
| Platform billing (Paystack) | ❌ keys not set; code in progress (pricing agents) |
| Code exercises | ✅ Piston + Judge0-compatible adapter on Server B (10.66.0.2:2358), 24 of 30 languages; API connected and tested (C#, Haskell, Swift, Objective-C, NASM not available on ARM) |
| Google sign-in | ❌ not set |
| Bot protection (Turnstile) | ❌ not set |
| SSO (WorkOS) | ⚠️ secret set, client ID missing — Enterprise only, can wait |
| Custom domains (Cloudflare for SaaS) | ❌ token + zone ID not set |
| Server B (brother) | ✅ SSH · Docker · **WireGuard link to A live** (10.66.0.1 ↔ 10.66.0.2) · still **2 cores / 12 GB / 46 GB — resize not applied yet** |
| Public ports 3000/8000 on Server A | ✅ closed |

**What "today" can realistically finish:** everything in §1–§5 (the platform
fully working, servers connected, backups, email, live classes, storage, code
exercises) plus merging the first pricing code. **Charging schools** goes live
later, after the billing code is finished and has run two weeks in "shadow"
mode (see `pricing-implementation.md` §9).

---

## 1. Do first — security (You, 10 min) 🔴

- [ ] **Change the admin password** on https://validbridge.co.ke (Account →
  Security) and **turn on 2FA** for your account. The first-boot password is
  written in old docs and in git history.
- [ ] Keep server keys in a password manager. `sshkeys/` and `*.key` are
  gitignored — never commit them.

---

## 2. Brother — Server B (Oracle console, ~20 min)

- [ ] **Resize** the VM to **4 OCPUs / 24 GB** (Compute → Instances → the VM →
  Edit → Shape). Free within Always Free if he runs no other free VMs.
- [ ] **Disk to 100 GB** (Instance → Boot volume → Edit → 100 GB). Claude grows
  the partition afterwards.
- [ ] **Upgrade to Pay As You Go** (stops Oracle reclaiming idle free VMs; still
  free within limits) and create a **$1 budget alert** (Billing → Budgets).
- [ ] **Security list** (Networking → VCN → subnet → Security List → Add ingress):
  - UDP **51820** from **`84.12.116.16/32`** (private link from Server A)
  - TCP **443** from Cloudflare only (for `staging.`) — Claude sends the ranges
    when staging is set up
- [ ] **Console access for recovery:** add You as a user in his Oracle account
  with rights to manage this instance and its network — or be reachable when
  Claude reboots Server B (needed if Judge0 requires a kernel setting change).
- [ ] **Agreement:** don't stop, resize or delete the VM without telling You;
  both keep access.

He does **not** need to provide any keys or accounts.

---

## 3. Connecting the two servers

```
Server A 84.12.116.16 (You)            Server B 84.12.69.88 (Brother)
 web · API · Postgres · Redis           Judge0 (code runs)
 LiveKit (live video)                   LiveKit Egress (recordings)
 nginx (public 80/443)                  video conversion worker
        │                               staging site
        └──── WireGuard tunnel ─────────┘
          10.66.0.1  ◄── UDP 51820 ──►  10.66.0.2
```

- **You (Oracle console of Server A):** add ingress **UDP 51820** from
  **`84.12.69.88/32`** to Server A's security list.
- **Claude:** installs WireGuard on both, opens UDP 51820 in each server's
  iptables for the other's IP only, and binds private services to tunnel IPs:
  - Judge0 on B listens only on `10.66.0.2` (A calls it)
  - Redis on A is reachable by B only through the tunnel, with a password
  - nothing on B is public except SSH (and staging HTTPS via Cloudflare)
- ✅ **Done 2026-09-25:** tunnel up and tested both ways; each server accepts
  UDP 51820 only from the other's IP; rules saved (survive reboots).

---

## 4. DNS — Cloudflare (You, 15 min) 🔴

| Record | Type | Value | Proxy | For |
|---|---|---|---|---|
| Resend records (from Resend → Domains → `validbridge.co.ke`) | TXT / MX | as shown by Resend | **DNS only** | Email delivery 🔴 |
| `live` | A | `84.12.116.16` | **DNS only (grey)** | Live classes |
| `turn` | A | `84.12.116.16` | **DNS only (grey)** | Live classes behind strict networks |
| `staging` | A | `84.12.69.88` | Proxied (orange) | Staging on Server B |
| `domains` | A | `84.12.116.16` | Proxied | Fallback origin for schools' own domains |
| `www` | Redirect rule | `https://validbridge.co.ke/$1` (301) | — | One canonical site |

Today `live`, `turn`, `domains`, `staging` and `www` all resolve through the
wildcard to Cloudflare's proxy — the explicit records above override it.

---

## 5. Accounts and keys needed for a fully working platform

| # | What | Who gets it | Where | Unlocks | Priority |
|---|---|---|---|---|---|
| 1 | **Resend domain verified** | You | resend.com → Domains → Add `validbridge.co.ke` → add records (§4) → *Verified* | Sign-up, password reset, invites | 🔴 |
| 2 | **Cloudflare R2**: bucket `validbridge-media` + bucket `validbridge-backups` + API token (read/write both) + Account ID | You | dash.cloudflare.com → R2 | Storage off the full disk, recordings, workers on B, **backups** | 🔴 |
| 3 | **Paystack platform keys** — **test** keys now, live keys at billing launch | You | dashboard.paystack.com → Settings → API Keys & Webhooks | Schools paying ValidBridge (wallet, saved cards, packs) | 🔴 for billing |
| 4 | **LiveKit keys** | Claude generates (no account) | on Server A | Live classes | 🔴 |
| 5 | **Judge0 (or Piston) auth token** | Claude generates | on Server B | Code exercises | 🟠 |
| 6 | **Google sign-in** OAuth client | You | console.cloud.google.com → Credentials → OAuth client (Web); origin `https://validbridge.co.ke`, redirect `https://validbridge.co.ke/auth/callback/google` | "Sign in with Google" | 🟠 |
| 7 | **Turnstile** site + secret key | You | Cloudflare → Turnstile → hostname `validbridge.co.ke` | Bot protection on login/sign-up | 🟠 |
| 8 | **Gemini billing enabled** | You | aistudio.google.com → project → enable billing | Reliable images/audio; stops Google using prompts from the free tier | 🟠 |
| 9 | **Cloudflare for SaaS**: API token (SSL and Certificates: Edit, Zone Read) + Zone ID | You | Cloudflare → My Profile → API Tokens; zone Overview | Schools' own domains (Growth+) | 🟡 |
| 10 | **WorkOS client ID** | You | dashboard.workos.com → API Keys; redirect `https://api.validbridge.co.ke/api/v1/auth/sso/callback` | SSO (Enterprise only) | 🟡 |
| 11 | `hello@validbridge.co.ke` inbox | You | your email host | "Book a demo" links | 🟠 |
| 12 | **Accountant**: KRA eTIMS + VAT | You | — | Invoicing schools legally | 🔴 before first real charge |
| 13 | Third Oracle server for the local AI model | Later | — | Free AI on your own model | 🟡 |

Send keys to Claude **only through the server** (paste into `.env` yourself, or
tell Claude to open the file for you) — never in chat or git.

---

## 6. What Claude does once you say go (same day)

1. **Server B:** Docker + WireGuard (done by an agent), Judge0/Piston per the
   ARM test, grow disk after resize, staging site, backup-restore test.
2. **Server A:** WireGuard, LiveKit (+ certs, nginx, ports), R2 switch + copy
   existing files, nightly encrypted database backups to R2, Turnstile/Google
   keys applied, disk check.
3. **Recordings:** LiveKit Egress on B writing to R2; turn on recordings.
4. **Video conversion** worker moved to B (after R2).
5. **Code:** merge the pricing agents' work in waves (nothing charges anyone
   until billing is switched on).

---

## 7. Final check — "is everything working?"

1. Sign up a new user → **verification email arrives**.
2. Log in with password, **Google**, and see the **Turnstile** check.
3. Create an org → opens at `{slug}.validbridge.co.ke`.
4. Create a course with a video and a quiz → video plays, quiz grades.
5. **Code exercise** runs and auto-grades.
6. **AI:** ask the assistant; generate a quiz and an image.
7. **Course sale:** org connects Paystack **test** keys + webhook → student buys → course unlocks.
8. **Live class:** start on a laptop, join on a phone, share screen, run a poll,
   record → attendance and recording appear in the course.
9. `validbridge.co.ke/help` → Help Center; `www.` redirects to the apex.
10. **Backup:** last night's backup exists in R2 and was restored on Server B.
11. **Billing (staging, Paystack test keys):** top up wallet with test M-Pesa,
    buy AI credits with a saved test card, run the monthly bill once.

---

## 8. Where everything lives

| File | Use it for |
|---|---|
| **`LAUNCH.md`** | This checklist — the only to-do list |
| `infra.md` | Technical reference: every env var, LiveKit/Egress commands |
| `infra/server-b/` | Server B setup (being written by an agent) |
| `DEPLOYMENT.md` | How deploys and rollbacks work |
| `pricechange.md` | Prices and plans |
| `pricing-implementation.md` | How billing is being built (agents) |
| `test.md`, `DEMO_STACK.md` | Local demo environment |
| `missing.md` | Old feature roadmap (history only) |
