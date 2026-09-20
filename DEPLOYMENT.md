# ValidBridge — CI/CD & Production Deployment

> Last updated 2026-09-20. The production host is a single Oracle VM
> (`84.12.116.16`, Ubuntu 24.04) running the bundled `docker-compose.yml`
> (containers `validbridge-db`, `validbridge-redis`, `validbridge-backend`,
> `validbridge-frontend`). TLS is Cloudflare-terminated; nginx on the host
> routes `:3000` (frontend) and `:8000` (backend).

## How it works

```
 git push origin main
        │
        ▼
  .github/workflows/ci.yml        ◀── full validation on every push/PR:
  ─────────────────────             lockfiles · ruff · API pytest ·
        │                          web lint · typecheck · web tests ·
        │ (must ALL pass)           docker compose config + image builds ·
        │                          dependency review (PRs only)
        ▼
  .github/workflows/deploy-production.yml
  ────────────────────────────────  workflow_run → runs ONLY when the CI
        │                           workflow completes successfully on main.
        │                           Deploys the *exact* SHA CI validated.
        ▼
  scripts/deploy.sh on the VM    ◀── back up DB (if migrations change),
                                     build images, run Alembic, swap
                                     containers, health-check, rollback on
                                     failure. Never touches the server .env.
```

Three guarantees:

1. **An exact, CI-validated commit is deployed.** The deploy workflow triggers
   on `workflow_run` of the `CI` workflow (branch `main`, conclusion
   `success`) and checks out/consumes `workflow_run.head_sha` — the same SHA
   CI just validated. There are no path filters, so a broken change can never
   slip through a "docs-only" or "small" push.
2. **Only one deployment at a time.** `concurrency: production-deploy` with
   `cancel-in-progress: false` makes later runs wait instead of racing. The
   server-side `flock` in `deploy.sh` is the second line of defence.
3. **Failure rolls back the application automatically.** `deploy.sh` tags the
   current images `:rollback` **before** building, and restores them if health
   checks fail. The database is **never** auto-reverted; see §Rollback.

## Files

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Validation gate (lockfiles, ruff, pytest, ESLint, typecheck, web tests, Docker builds, dependency review). |
| `.github/workflows/deploy-production.yml` | Deploys to the VM only after CI passes. Also supports manual re-deploy. |
| `scripts/deploy.sh` | Everything that happens **on the server**: git checkout, DB backup, image build, migrations, container swap, health check, rollback. |

Design notes worth keeping in mind:

- **ruff is pinned to 0.15.9** in CI, deliberately. The project's lint config
  lives at the top level of `[tool.ruff]` in `apps/api/pyproject.toml`, which
  newer ruff majors no longer honour — an unpinned run floods the tree with
  thousands of unrelated findings.
- **Web lint is report-only for the whole project and strict on PR-changed
  files.** The `lint` script is `eslint . || true` in the repo, so CI *runs*
  ESLint itself and only turns a hard failure (exit 2) into a red, keeping a
  misconfigured/lint-debt state visible while new change debt is blocked.
- **Full API pytest, not just a smoke slice**, runs with coverage (threshold
  25%) and `TESTING=true`. ffmpeg is installed in CI so video/HLS tests run
  rather than silently skipping.
- **Docker images are built but never pushed in CI.** `docker-validation`
  builds backend/web/collab with BuildKit cache to prove the exact production
  Dockerfiles compile. Publishing happens only as part of a deploy.

## One-time setup on GitHub

Go to **Settings → Secrets and variables → Actions** on the repository.

This repo stores the deployment config under an `ORACLE_`-prefixed naming scheme
(and keeps them as **secrets**). GitHub automatically masks secret values in
workflow logs and the Summary tab — storing `ORACLE_VPS_HOST` / `ORACLE_VPS_USER`
as secrets is fine; if you ever prefer plain values, move them to **Variables**
and change the `secrets.*` references to `vars.*` in the workflow.

**Secrets**:

| Secret | Value |
|---|---|
| `ORACLE_VPS_SSH_KEY` | a deploy SSH private key the VM will accept (see below). |
| `ORACLE_VPS_HOST` | `84.12.116.16` |
| `ORACLE_VPS_USER` | `ubuntu` *(defaults to `ubuntu` if unset)* |
| `SERVER_WORKDIR` | `/home/ubuntu/projects/validbridge` |
| `SSH_KNOWN_HOSTS` *(optional but recommended)* | the VM's host key line(s). If omitted, CI falls back to `ssh-keyscan` — fine for normal use, but TOFU for recovery. |

**Variables** *(optional, defaults are fine)*:

| Variable | Value |
|---|---|
| `ORACLE_VPS_PORT` | `22` *(default if unset)* |
| `GIT_REMOTE_URL` | `https://github.com/pogutu-pro/validbridge.git` *(default if unset, override if you fork)* |

### Creating the deploy key

On the VM (or any machine you trust):

```
ssh-keygen -t ed25519 -C "validbridge-cicd" -f ~/.ssh/id_validbridge_deploy -N ""
```

Add the **public** key to the VM's `~/.ssh/authorized_keys`:

```
echo "command=\"true\",no-agent-forwarding,no-port-forwarding" >> /dev/null  # optional hardening
cat ~/.ssh/id_validbridge_deploy.pub >> ~/.ssh/authorized_keys
```

Paste the **private** key file contents into the `SSH_PRIVATE_KEY` secret.
> The runner connects with strict host-key checking. If the VM later gets
> re-provisioned with a new host key, update `SSH_KNOWN_HOSTS` or the run will
> fail fast instead of silently MITM-ing.

## Deploying

### Normal deploy (recommended)

Merge/push to `main`. Nothing else to do:

1. `CI` runs all checks.
2. On success, `Deploy Production` runs automatically for that exact commit.
3. The deployment report is posted to the workflow run's **Summary** tab
   (commit, server, user, result).

On the server, `deploy.sh` performs, in order:

1. Serialises via `flock` (second deployment attempt → hard fail, no queue
   thrash).
2. Converts the deploy dir to a git checkout if it isn't one already (the
   current VM dir is a plain file copy — the first CI/CD deploy does this
   **once**), then fetches origin and hard-checks out the exact SHA. The
   production `.env` is gitignored and is **never** written or deleted.
   Tracked files are overwritten to match the commit; untracked ignored files
   (keys, node_modules, `.next`) are left alone.
3. Takes a `pg_dump` backup **before** anything changes, but **only when
   migration files changed** (or on the first deploy) — so unneeded deploy
   time isn't spent dumping an unchanged schema.
4. Builds `backend` + `frontend` images while the old containers keep serving.
5. Applies migrations from the **new** code via a one-off container
   (`alembic upgrade head`, idempotent) **before** any container swap, so new
   code never runs against an un-migrated DB.
6. Recreates `backend`/`frontend` with the new images (`db`/`redis` untouched).
7. Waits for container health, then curls
   `http://localhost:8000/api/v1/health` (which also checks DB connectivity)
   and `http://localhost:3000/api/health`.

State and artifacts live **outside** the git tree at
`~/validbridge-deployments/`: `logs/`, `backups/` (DB dumps, kept 14 days),
`state/` (last deployed SHA). Every run appends a full log there.

### Manual / emergency deploy

Open **Actions → Deploy Production → Run workflow** and enter a ref. The
default `main` re-deploys the current main even if the automatic run was
missed (e.g. transient runner failure).

### Deploying a specific older commit

Manual run with a full or short SHA. CI-validated is preferable, but the
script will deploy any reachable commit; use this for recovery, then restore
the DB backup if the older code does not match the schema (see next section).

## Rollback

### Automatic (on failed health checks)

`deploy.sh` tags the currently-running images as `<service>:rollback` before
building. If container or endpoint health fails after the swap, it:

1. Re-tags the previous images back into place.
2. `docker compose up -d --no-build backend frontend`.
3. Re-runs health checks and restores `git` state to the previous HEAD.
4. Leaves the failure log and captured service logs in
   `~/validbridge-deployments/logs/`.

**The database schema is never automatically reverted** — that decision is
deliberate and documented in the script. If the failed deploy had already
applied migrations, the old images may not be compatible with the new schema.
Recover with the pre-deploy backup (below) — the dump is taken *before*
migration if any migration files changed, so it is always restorable.

### Manual database restore

```
gunzip -c ~/validbridge-deployments/backups/db-<stamp>-pre-<sha>.sql.gz \
  | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

Then redeploy the previous commit via a manual `Deploy Production` run.

### Image rollback by hand

```
docker tag validbridge-backend:rollback  validbridge-backend
docker tag validbridge-frontend:rollback validbridge-frontend
docker compose up -d --no-build backend frontend
```

## Operating rules & notes

- **Never run `docker system prune -a` on the VM.** `deploy.sh` prunes only
  dangling images after a successful deploy. `-a` can delete images the
  running stack still references.
- **In-flight HLS transcodes and HLS queue jobs** keep running through a
  deploy (they live in Redis / in-process on the API pod). A backend restart
  can interrupt an in-process transcode; the queue retries it.
- **Do not hand-edit files in `~/projects/validbridge`.** Anything that is not
  committed and pushed to `main` is wiped on the next deploy's checkout. The
  only exceptions are gitignored files (`.env`, local keys, `node_modules/`,
  `.next/`).
- **.env edits** are the one manual change that survives deploys — and the one
  that cannot be done through CI. After editing it, run
  `docker compose up -d backend` (add `frontend` if a `NEXT_PUBLIC_*` value
  changed). See `infra.md` §11 for env follow-ups.
- **First deploy does extra work**: it initialises git in the deploy dir,
  backs up the database once, and verifies the checkout. Expect the first run
  to take longer.
- **Migrations are expected to be additive/compatible** (revision-based). The
  pipeline does not support zero-downtime blue/green or long-running upgrade
  windows; a deploy means a brief backend+frontend restart.
- **Do not alter the deploy workflow's `concurrency` group or the CI gate.**
  They are the load-bearing parts of the "CI-validated commit only" guarantee.