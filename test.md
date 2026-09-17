# ValidBridge Local Demo — Credentials & Notes

Dev instance for the localhost presentation. All services run locally; no external
third-party keys are required (except optionally a hosted Judge0 for code execution,
see below).

## Running services

| Service  | URL                                       | Notes                                  |
| -------- | ----------------------------------------- | -------------------------------------- |
| Web      | http://lvh.me:3010                        | default org (ValidBridge)              |
| Web      | http://demo.lvh.me:3010                   | demo org (Riverbend Academy)           |
| API      | http://localhost:1348 (/api/v1)           | uvicorn via run_demo_api.sh            |
| Collab   | ws://lvh.me:4000                          | Hocuspocus realtime (course editing)   |

`lvh.me` resolves to 127.0.0.1, so any `demo.lvh.me` subdomain works without hosts
edits. Multi-tenancy is on: `demo.*` routes to the demo org.

## Login credentials

> All logins below are verified working against the running instance. This build
> is ungated (`get_deployment_mode()` → `ee`), so SaaS email-verification is NOT
> enforced — even `admin@validbridge.dev` (`email_verified = false`) signs in.

### Demo organization — Riverbend Academy (`demo.lvh.me:3010`)

> **Sign in at `http://demo.lvh.me:3010/login`** for these accounts — NOT
> `http://lvh.me:3010/login`. The latter is the *default* org (ValidBridge);
> these accounts are members of the demo org only, so on the default org they
> render as "You're viewing ValidBridge as a guest".

Role demo users (password `demo1234` for all; seeded by `cli.py demo-roles`):

| Role              | Email                             | Password   |
| ----------------- | --------------------------------- | ---------- |
| Admin             | `role-admin@demo.example.com`     | `demo1234` |
| Maintainer        | `role-maintainer@demo.example.com` | `demo1234` |
| Instructor        | `role-instructor@demo.example.com` | `demo1234` |
| Learner (student) | `role-learner@demo.example.com`   | `demo1234` |

> The **student demo role** is `role-learner@demo.example.com` — this is the
> "User" role in the demo org (Riverbend Academy). Use it to experience the demo
> as a learner/student. Its DB role is `User` (`userorganization.role_id` → 4).

Superadmin of the demo org's default *platform* org:

| Role       | Email              | Password             |
| ---------- | ------------------ | -------------------- |
| Superadmin | `admin@school.dev` | `wcWLouRQXzAz-4DG`   |

(The superadmin password is generated on first run and lives in `.demo-secrets`
at the repo root — gitignored. If it ever changes, read it from there.)

> The 40 seeded `demo-XX@demo.example.com` students (`demo_*` usernames) have
> unusable passwords on purpose — they are progress/analytics props, not logins.
> Use `role-learner@demo.example.com` to experience the demo as a learner.

### Default organization — ValidBridge (`lvh.me:3010`)

| Role                       | Email                        | Password          |
| -------------------------- | ---------------------------- | ----------------- |
| Administrator (superadmin) | `admin@validbridge.dev`      | `ValidBridge123!` |
| Maintainer                 | `maintainer@validbridge.dev` | `Maintainer123!`  |
| Instructor                 | `instructor@validbridge.dev` | `Instructor123!`  |
| Learner (student)          | `student@validbridge.dev`    | `Student123!`     |

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

## Manual service startup

```bash
# API (port 1348)
cd apps/api && ./run_demo_api.sh

# Collab / Hocuspocus (port 4000) — script now runs node+tsx (NOT Bun: loader bug)
cd apps/collab && ./run_demo_collab.sh

# Web (port 3010) — standalone build runs with node, not `next start`
cd apps/web/.next/standalone && HOSTNAME=0.0.0.0 PORT=3010 node server.js
```

Notes:
- `run_demo_collab.sh` sources `.demo-secrets` so the JWT/internal keys match the
  API. Don't run `node --import tsx src/index.ts` bare — it needs those exports.
- The web server reads `runtime-config.json` (server-side) and
  `public/runtime-config.js` (client-side) from `.next/standalone`. Both must
  point the client at `http://localhost:1348` (see the checked-in files).

Logs land in `/tmp/opencode/validbridge-api.log`, `…collab.log`, `…web.log`.