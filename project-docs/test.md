# ValidBridge — Environments, Credentials & Notes

## 1. Production Live Instance (`validbridge.co.ke`)

| Service  | URL                                            | Notes                                      |
| -------- | ---------------------------------------------- | ------------------------------------------ |
| Web App  | https://validbridge.co.ke                      | Main platform & default org (ValidBridge)  |
| Sign In  | https://validbridge.co.ke/login                | Login page                                 |
| API      | https://api.validbridge.co.ke/api/v1           | FastAPI backend                            |
| Server   | `84.12.116.16` (Oracle Cloud)                  | Nginx + Docker (PostgreSQL 16, Redis 7.2)  |

### Production Accounts (`validbridge.co.ke`)

> All 4 roles below are provisioned on the live production database. Passwords are
> kept in the password manager only — never write them in this repo.

| Role | Email | Password | Permissions |
| -------------------------- | ---------------------------- | ----------------- | ----------- |
| Administrator (superadmin) | `admin@validbridge.dev` | *(password manager)* | Full platform & org admin access |
| Maintainer | `maintainer@validbridge.dev` | *(password manager)* | Org content & course maintenance |
| Instructor | `instructor@validbridge.dev` | *(password manager)* | Course creation & grading |
| Learner (student) | `student@validbridge.dev` | *(password manager)* | Student learning & enrollments |

---

## 2. Local Demo Instance (localhost / `lvh.me`)

Dev instance for the localhost presentation. All services run locally; no external
third-party keys are required (except optionally a hosted Judge0 for code execution,
see below).

### Running services (Local)

| Service  | URL                                       | Notes                                  |
| -------- | ----------------------------------------- | -------------------------------------- |
| Web      | http://lvh.me:3010                        | default org (ValidBridge)              |
| Web      | http://demo.lvh.me:3010                   | demo org (Riverbend Academy)           |
| API      | http://localhost:1348 (/api/v1)           | uvicorn via run_demo_api.sh            |
| Collab   | ws://lvh.me:4000                          | Hocuspocus realtime (course editing)   |

`lvh.me` resolves to 127.0.0.1, so any `demo.lvh.me` subdomain works without hosts
edits. Multi-tenancy is on: `demo.*` routes to the demo org.

### Login credentials (Local)

> All logins below are verified working against the running instance. This build
> is ungated (`get_deployment_mode()` → `ee`), so SaaS email-verification is NOT
> enforced — even `admin@validbridge.dev` (`email_verified = false`) signs in.

### Demo organization — Riverbend Academy (`demo.lvh.me:3010`)

> **Sign in at `http://demo.lvh.me:3010/login`** for these accounts — NOT
> `http://lvh.me:3010/login`. The latter is the *default* org (ValidBridge);
> these accounts are members of the demo org only, so on the default org they
> render as "You're viewing ValidBridge as a guest".

Role demo users (password from `VALIDBRIDGE_DEMO_ROLE_PASSWORD`, or `demo1234` only in development mode; seeded by `cli.py demo-roles`):

| Role              | Email                             | Password   |
| ----------------- | --------------------------------- | ---------- |
| Admin | `role-admin@demo.example.com` | `VALIDBRIDGE_DEMO_ROLE_PASSWORD` |
| Maintainer | `role-maintainer@demo.example.com` | `VALIDBRIDGE_DEMO_ROLE_PASSWORD` |
| Instructor | `role-instructor@demo.example.com` | `VALIDBRIDGE_DEMO_ROLE_PASSWORD` |
| Learner (student) | `role-learner@demo.example.com` | `VALIDBRIDGE_DEMO_ROLE_PASSWORD` |

> The **student demo role** is `role-learner@demo.example.com` — this is the
> "User" role in the demo org (Riverbend Academy). Use it to experience the demo
> as a learner/student. Its DB role is `User` (`userorganization.role_id` → 4).

Superadmin of the demo org's default *platform* org:

| Role       | Email              | Password             |
| ---------- | ------------------ | -------------------- |
| Superadmin | `admin@school.dev` | see `.demo-secrets` |

(The superadmin password is generated on first run and lives in `.demo-secrets`
at the repo root — gitignored. If it ever changes, read it from there.)

> The 40 seeded `demo-XX@demo.example.com` students (`demo_*` usernames) have
> unusable passwords on purpose — they are progress/analytics props, not logins.
> Use `role-learner@demo.example.com` to experience the demo as a learner.

### Default organization — ValidBridge (`lvh.me:3010`)

| Role                       | Email                        | Password          |
| -------------------------- | ---------------------------- | ----------------- |
| Administrator (superadmin) | `admin@validbridge.dev` | *(password manager)* |
| Maintainer | `maintainer@validbridge.dev` | *(password manager)* |
| Instructor | `instructor@validbridge.dev` | *(password manager)* |
| Learner (student) | `student@validbridge.dev` | *(password manager)* |

### Role map (verified via `userorganization`)

| Org          | Email                          | Role       |
| ------------ | ------------------------------ | ---------- |
| `default`    | `admin@validbridge.dev`        | Admin      |
| `default`    | `maintainer@validbridge.dev`   | Maintainer |
| `default`    | `instructor@validbridge.dev`   | Instructor |
| `default`    | `student@validbridge.dev`      | User       |
| `demo`       | `role-admin@demo.example.com`  | Admin      |
| `demo`       | `role-maintainer@demo.example.com` | Maintainer |
| `demo`       | `role-instructor@demo.example.com` | Instructor |
| `demo`       | `role-learner@demo.example.com` | User      |
| `demo` (platform) | `admin@school.dev`        | Superadmin |

## What is in the demo

- **40 fictional students**, 3 cohorts, boards, playgrounds, communities,
  podcasts and a storefront — refreshed/re-reconciled every 10 minutes
  (drift sweep removes visitor content, never memberships).
- **Coding Practice with Python** (section *Technical Skills*):
  - 2 YouTube video lessons (embedded, no local storage)
  - 3 interactive documents with **run-in-browser code playgrounds** (blockCode)
  - 1 auto-graded assignment (quiz + short-answer), graded demo submissions
- Code playgrounds call the API `code/execute` / `code/execute-batch` endpoints.

## Code execution (Judge0)

No local Judge0 / Docker is required. Code blocks render without it; running code
returns a clean `503 Code execution is not configured. Set VALIDBRIDGE_JUDGE0_API_URL.`

To enable against a hosted Judge0 (CE HTTP API), set these in
`apps/api/run_demo_api.sh` and restart the API:

```bash
export VALIDBRIDGE_JUDGE0_API_URL="https://your-hosted-judge0.example.com"
export VALIDBRIDGE_JUDGE0_CLIENT_ID=""            # optional auth headers
export VALIDBRIDGE_JUDGE0_CLIENT_SECRET=""        # optional auth headers
```

## Rebuild / reset commands

All from `apps/api` and via `uv run python cli.py`, running against the DB:

| Command                          | Effect                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| `uv run python cli.py demo-sync` | Provision/refresh the demo from the bundle (safe to repeat)   |
| `uv run python cli.py demo-roles`| Idempotently (re)create the 4 role login users (pass reset)   |
| `uv run python cli.py demo-status` | Show demo org state                                            |
| `uv run python cli.py demo-teardown` | **Delete ALL seeded/mock data**: the demo org, every course incl. Coding Practice with Python, the role users, the 40 students, memberships, storage files. Then `demo-sync` rebuilds from scratch. |

`demo-teardown` is the documented "wipe everything" command: the role users carry
`signup_method="demo"` and the new course lives inside the demo org, so both are
removed by it (teardown deletes by org cascade + the demo-student user rows).

## Manual service startup (verified working — copy/paste)

> **Why demo ports, not 8000/3000:** on this machine ports **8000** and **3000**
> are held by an *unrelated* Docker project (`dev-redpanda_console`, `dev-account`).
> The OSS defaults (`app.py` on 8000, `next dev` on 3000) will fail with
> `[Errno 98] Address already in use` / auto-shift to 3001. Use the demo stack:
> **API 1348**, **Web 3010**. Postgres is already up on `localhost:5432` and Redis
> on `6379` — no need to `docker compose up`.

### Start API (port 1348)

```bash
cd apps/api
setsid nohup bash run_demo_api.sh > /tmp/validbridge-api.log 2>&1 < /dev/null & disown
```

### Start Web (port 3010)

The system `node` is **v18** (Next.js needs **>=20**). Use nvm's v24.
`-H 0.0.0.0` is required, otherwise Next may bind **IPv6-only** and every
`127.0.0.1` / `demo.lvh.me` request fails (this looks like "backend not working").

```bash
cd apps/web
export PATH=/home/ogutu/.nvm/versions/node/v24.11.0/bin:$PATH
export NEXT_PUBLIC_VALIDBRIDGE_BACKEND_URL="http://lvh.me:1348/"
export NEXT_PUBLIC_VALIDBRIDGE_API_URL="http://lvh.me:1348/api/v1/"
export NEXT_PUBLIC_VALIDBRIDGE_DOMAIN="lvh.me:3010"
export NEXT_PUBLIC_VALIDBRIDGE_TOP_DOMAIN="lvh.me"
export NEXT_PUBLIC_VALIDBRIDGE_DEFAULT_ORG="default"
export NEXT_PUBLIC_COLLAB_URL="ws://lvh.me:4000"
setsid nohup bun run next dev --turbopack -p 3010 -H 0.0.0.0 > /tmp/validbridge-web.log 2>&1 < /dev/null & disown
```

### Optional Collab (port 4000) — needed only for realtime editing / boards

```bash
cd apps/collab && setsid nohup bash run_demo_collab.sh > /tmp/validbridge-collab.log 2>&1 < /dev/null & disown
```

### Open

- Web (default org **ValidBridge**): http://lvh.me:3010
- Web (demo org **Riverbend Academy**): http://demo.lvh.me:3010
- API health: http://localhost:1348/api/v1/health

Use **`lvh.me` / `demo.lvh.me`, NOT `localhost:3010`** — demo cookies are scoped
to `.lvh.me` (`localhost` will load but auth stays logged-out / "offline").

### Verify

```bash
ss -ltn | grep -E ':1348|:3010'                                    # both LISTEN
curl -s -o /dev/null -w 'api %{http_code}\n' http://localhost:1348/api/v1/health
curl -s -o /dev/null -w 'web %{http_code}\n' http://demo.lvh.me:3010
```

First page load takes ~15–20s on Turbopack cold compile; then it's fast. "web 000"
during that window is just the compile, not a crash.

### Stop / restart

```bash
fuser -k 1348/tcp 3010/tcp        # stop both (port-based; won't kill the invoking shell)
```

> Don't use `pkill -f "next dev"` / `pkill -f "uvicorn app:app"` from a script or
> `bash -c`: the pattern matches the invoking shell's own command line and kills
> it before the rest of the script runs.

Notes:
- `run_demo_collab.sh` sources `.demo-secrets` so the JWT/internal keys match the
  API. Don't run `node --import tsx src/index.ts` bare — it needs those exports.
- The demo API seeds/refreshes the demo org every 10 minutes; superadmin password
  (`admin@school.dev`) lives in `.demo-secrets` at the repo root.
- Logs land in `/tmp/validbridge-api.log`, `/tmp/validbridge-web.log`,
  `/tmp/validbridge-collab.log`.