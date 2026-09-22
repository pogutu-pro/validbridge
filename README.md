# ValidBridge

ValidBridge is an learning platform for authoring and delivering educational content. Course building, assessment, communities, real-time collaboration, and AI-assisted learning are unified into a single, self-hostable system.

## Architecture

The platform is composed of three independently deployable applications:

| Application | Path          | Responsibility                                                           | Stack                                                 |
| ----------- | ------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| **API**     | `apps/api`    | REST backend: authentication, courses, assignments, analytics, AI, email | FastAPI, Python, SQLModel, Alembic, PostgreSQL, Redis |
| **Web**     | `apps/web`    | Learner, instructor, and administrator interface                         | Next.js, React, Tailwind CSS, Tiptap                  |
| **Collab**  | `apps/collab` | Real-time synchronization for course editing and boards                  | Hocuspocus, Yjs, WebSocket                            |

## Capabilities

- **Courses** — structured programs composed of chapters and activities.
- **Editor** — a block-based, Notion-style content editor.
- **Assignments** — task creation, submission tracking, and grading.
- **Communities** — discussion spaces for learners.
- **Boards** — real-time collaborative whiteboards.
- **Playgrounds** — interactive simulations, diagrams, and generated elements.
- **Code** — in-browser execution with auto-grading across 30+ languages.
- **AI** — context-aware assistance for learners and instructors.
- **Certificates** — issued automatically on course completion.
- **Analytics** — engagement and performance reporting.
- **Customization** — organization branding, landing pages, and theming.
- **SEO** — metadata, sitemaps, and Open Graph support.

Payments, SSO, and multi-organization hosting are available in the Enterprise edition.

## Requirements

| Dependency                       | Version                    |
| -------------------------------- | -------------------------- |
| Node.js                          | 20 or later                |
| [Bun](https://bun.sh)            | 1.4.2 (see `.bun-version`) |
| Python                           | 3.14.7                     |
| [uv](https://docs.astral.sh/uv/) | latest                     |
| PostgreSQL                       | 16                         |
| Redis                            | 7                          |

## Configuration

Configuration is resolved from environment variables and, for the API, `apps/api/config/config.yaml`. Environment variables take precedence over the YAML file.

Start from the example file at the repository root:

```bash
cp .env.example .env
```

The root `.env` is consumed by Docker Compose. For a native backend run, the API reads `apps/api/.env` — create it with the backend-relevant values (see [Environment variables](#environment-variables)).

At minimum, set:

- `VALIDBRIDGE_AUTH_JWT_SECRET_KEY` — at least 32 characters.
- `VALIDBRIDGE_SQL_CONNECTION_STRING` — PostgreSQL connection string.
- `VALIDBRIDGE_REDIS_CONNECTION_STRING` — Redis connection string.
- `VALIDBRIDGE_INITIAL_ADMIN_EMAIL` / `VALIDBRIDGE_INITIAL_ADMIN_PASSWORD` — used to seed the first administrator.
- `VALIDBRIDGE_INITIAL_ORG_NAME` / `VALIDBRIDGE_INITIAL_ORG_SLUG` — used to seed the first organization.

## Running the application

### Quick start — run everything

With PostgreSQL and Redis reachable (see step 1), run each service in its own terminal:

```bash
# 1. Backend API — http://localhost:8000
cd apps/api && uv sync && uv run python app.py

# 2. Frontend — http://localhost:3000
cd apps/web && bun install && bun run dev

# 3. Collaboration server — ws://localhost:4000 (required for boards & real-time editing)
cd apps/collab && bun install
lsof -ti:4000 | xargs kill -9 2>/dev/null || true  # free port 4000 if occupied
node --import tsx src/index.ts
```

Open <http://localhost:3000> and log in with an account from [Default accounts](#default-accounts).

### 1. Start PostgreSQL and Redis

Ensure both services are reachable. With Docker:

```bash
docker compose up -d db redis
```

Otherwise use a local PostgreSQL 16 and Redis 7 instance (a native `postgresql` + `redis-server` on `localhost:5432` / `localhost:6379` works out of the box).

### 2. Backend API

```bash
cd apps/api
uv sync
uv run python app.py
```

`app.py` starts Uvicorn on the configured port (`VALIDBRIDGE_PORT`, default `8000`). On first start the API creates any missing schema and seeds the default organization and administrator from the `VALIDBRIDGE_INITIAL_*` variables.

For a production deployment, apply migrations explicitly before starting:

```bash
uv run alembic upgrade head
```

### 3. Frontend Web

```bash
cd apps/web
bun install
bun run dev
```

The web application listens on port **3000** and expects the API at `http://localhost:8000`.

### 4. Collaboration server (optional)

Required only for real-time course editing and boards:

```bash
cd apps/collab
bun install

# Free port 4000 if a previous collab server is still bound to it
lsof -ti:4000 | xargs kill -9 2>/dev/null || true

# Run in the foreground (Ctrl+C to stop)
node --import tsx src/index.ts
```

To keep it running after you close the terminal, start it detached:

```bash
cd apps/collab
setsid nohup node --import tsx src/index.ts > /tmp/collab.log 2>&1 < /dev/null &
```

The collaboration server listens on port **4000** (`ws://localhost:4000`).

> **Note:** run the collab server with `node --import tsx src/index.ts`, not `bun run dev`. The `tsx` CLI resolves its loader incorrectly under Bun (a Bun/`tsx` module-resolution bug), so the watcher exits with `Cannot find module './cjs/index.cjs'`. Node resolves it correctly.

**The collab server must trust the same JWT the API issues.** It verifies board tokens with `VALIDBRIDGE_AUTH_JWT_SECRET_KEY` and confirms membership by calling `VALIDBRIDGE_API_URL`, so both must match the running API. If the secret differs (or `VALIDBRIDGE_API_URL` points at the wrong port), the server still starts but every board hangs on "connecting". The defaults come from `apps/collab/.env` — keep them in sync with `apps/api/.env`.

For the local demo stack (multi-tenancy on `lvh.me`, API on `:1348`), use the wrapper, which sources `.demo-secrets` so the keys match:

```bash
cd apps/collab && ./run_demo_collab.sh
```

## Default accounts

A clean install seeds one account per role in the default organization (`ValidBridge`, slug `default`). The credentials below are the defaults used by this development instance:

| Role                       | Email                        | Password          |
| -------------------------- | ---------------------------- | ----------------- |
| Administrator (superadmin) | `admin@validbridge.dev`      | `ValidBridge123!` |
| Maintainer                 | `maintainer@validbridge.dev` | `Maintainer123!`  |
| Instructor                 | `instructor@validbridge.dev` | `Instructor123!`  |
| Learner                    | `student@validbridge.dev`    | `Student123!`     |

> **Security notice:** these accounts are for local development only. Change every password and the JWT secret before exposing an instance to any network.

To provision the first administrator on a fresh database, set `VALIDBRIDGE_INITIAL_ADMIN_EMAIL` and `VALIDBRIDGE_INITIAL_ADMIN_PASSWORD` before the API's first start.

## Environment variables

| Variable                              | Purpose                                                 |
| ------------------------------------- | ------------------------------------------------------- |
| `VALIDBRIDGE_SQL_CONNECTION_STRING`   | PostgreSQL connection string.                           |
| `VALIDBRIDGE_REDIS_CONNECTION_STRING` | Redis connection string.                                |
| `VALIDBRIDGE_AUTH_JWT_SECRET_KEY`     | Signing key for session tokens (minimum 32 characters). |
| `VALIDBRIDGE_PORT`                    | API listen port (default `1338`; `8000` in this setup). |
| `VALIDBRIDGE_DOMAIN`                  | Public domain, e.g. `localhost:3000`.                   |
| `VALIDBRIDGE_COOKIE_DOMAIN`           | Cookie scope; host-only in single-tenancy mode.         |
| `VALIDBRIDGE_INITIAL_ADMIN_EMAIL`     | Email of the seeded administrator.                      |
| `VALIDBRIDGE_INITIAL_ADMIN_PASSWORD`  | Password of the seeded administrator.                   |
| `VALIDBRIDGE_INITIAL_ORG_NAME`        | Display name of the seeded organization.                |
| `VALIDBRIDGE_INITIAL_ORG_SLUG`        | URL slug of the seeded organization.                    |
| `NEXT_PUBLIC_VALIDBRIDGE_API_URL`     | API base URL used by the web client.                    |
| `NEXT_PUBLIC_VALIDBRIDGE_BACKEND_URL` | Backend origin used by the web client.                  |
| `NEXT_PUBLIC_VALIDBRIDGE_DOMAIN`      | Public domain used by the web client.                   |

Refer to `.env.example` for the complete list.

## Database

The API owns the schema. On a fresh database it creates all tables automatically and seeds baseline data. Schema changes are tracked with Alembic:

```bash
cd apps/api
uv run alembic upgrade head          # apply all migrations
uv run alembic revision --autogenerate -m "describe change"   # create a migration
```

The schema-creation step also enables the `pgvector` extension; if it is unavailable the RAG features are disabled but the application continues to run.

## Testing

### Backend

```bash
cd apps/api
uv run pytest                                  # full suite
uv run pytest src/tests/routers                # a single directory
uv run pytest src/tests/routers/test_auth.py   # a single file
```

The backend suite runs against an in-memory SQLite database and does not require PostgreSQL or Redis.

### Frontend

```bash
cd apps/web
bun test tests
```

## CI/CD & production deployment

Continuous integration runs on every push and PR via GitHub Actions
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): lockfile drift, ruff
lint, API tests with coverage, web lint/typecheck/tests, Docker compose + image
builds, and (on PRs) dependency review.

A successful CI run on `main` automatically triggers production deployment
([`.github/workflows/deploy-production.yml`](.github/workflows/deploy-production.yml),
which drives [`scripts/deploy.sh`](scripts/deploy.sh) on
the production VM). Only the exact commit CI validated is ever deployed; the
pipeline backs up the database before schema changes, runs migrations before
swapping containers, health-checks the running stack, and rolls back the
application automatically on failure. The production `.env` is never touched by
deploys.

**See [`DEPLOYMENT.md`](DEPLOYMENT.md)** for the full setup guide, operator
procedures, and rollback instructions.

## Project structure

```
apps/
  api/      FastAPI backend — models, migrations, services, routers
  web/      Next.js frontend — dashboard, course player, editor, landing pages
  collab/   Real-time collaboration server
  e2e/      End-to-end tests
docs/       Documentation site
scripts/    Repository tooling
```

## Troubleshooting

- **"You appear to be offline" in the web app** — the API is unreachable. Confirm it is running on `http://localhost:8000` and that `NEXT_PUBLIC_VALIDBRIDGE_BACKEND_URL` points to it.
- **API fails to start on the database step** — verify `VALIDBRIDGE_SQL_CONNECTION_STRING` and that PostgreSQL is reachable. The API retries transient connection failures on startup.
- **Missing JWT secret** — set `VALIDBRIDGE_AUTH_JWT_SECRET_KEY` to a value of at least 32 characters.
- **`EADDRINUSE: address already in use :::4000`** — a previous collaboration server is still bound to port `4000`. Free it before restarting: `lsof -ti:4000 | xargs kill -9`, then start the collab server again.
- **Boards stuck on "connecting"** — the collaboration server can't authenticate against the API. Confirm it is running on port `4000` and that its `VALIDBRIDGE_AUTH_JWT_SECRET_KEY` matches the API's secret and `VALIDBRIDGE_API_URL` points at the API (for the demo, start it with `apps/collab/run_demo_collab.sh`).
- **Collaborative editing stays on "connecting"** — start the collaboration server (`apps/collab`).
