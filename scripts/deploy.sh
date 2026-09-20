#!/usr/bin/env bash
#
# scripts/deploy.sh — production deploy for ValidBridge (Oracle VM)
#
# Run BY the server, either:
#   - automatically from GitHub Actions (deploy-production.yml pipes this
#     file onto the VM and executes it with the exact commit SHA), or
#   - manually by an operator during an emergency (see DEPLOYMENT.md).
#
# Usage:
#   bash scripts/deploy.sh <commit-sha>
#
# Behaviour (all steps abort the deploy on failure):
#   1. Concurrency lock (flock) — never two deploys at once.
#   2. Ensures the deploy directory is a git checkout of the repo.
#   3. Fetches origin and hard-checks out the EXACT requested commit.
#      The production .env is gitignored and is never touched.
#   4. Backs up PostgreSQL (pg_dump) whenever migration files changed.
#   5. Builds new backend/frontend images WITHOUT stopping old containers.
#   6. Applies Alembic migrations with a one-off container built from the
#      new code (idempotent — no-op when already at head).
#   7. Recreates backend/frontend with the new images.
#   8. Waits for container health and verifies the app health endpoints.
#   9. On any health failure: retags the previous images back into place and
#      restores the last-working application. DB migrations are NEVER
#      auto-reverted — the pre-migration backup enables a manual restore.
#
# The images are tagged <service>:rollback before being replaced, so an
# application-only rollback is real and fast. Docker cleanup only ever prunes
# DANGLING images — never `docker system prune -a`.

set -euo pipefail

TARGET="${1:?usage: deploy.sh <commit-sha|ref>}"
WORKDIR="${SERVER_WORKDIR:-$HOME/projects/validbridge}"
GIT_REMOTE_URL="${GIT_REMOTE_URL:-https://github.com/pogutu-pro/validbridge.git}"

# Private repositories need credentials for `git fetch`. A read-only PAT can be
# passed through GIT_REMOTE_TOKEN; it travels as an HTTP Authorization header
# (git -c http.extraheader) so it never lands in the remote URL or on disk.
# For public repositories leave it unset — anonymous HTTPS works.
GIT_REMOTE_TOKEN="${GIT_REMOTE_TOKEN:-}"

# Maintenance state lives OUTSIDE the git tree so repo checkouts can never
# disturb logs, backups or the deploy lock.
MAINT_DIR="${DEPLOY_MAINTENANCE_DIR:-validbridge-deployments}"
case "$MAINT_DIR" in
  /*) MAINT="$MAINT_DIR" ;;
  *)  MAINT="$HOME/$MAINT_DIR" ;;
esac
mkdir -p "$MAINT/logs" "$MAINT/backups" "$MAINT/state"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
LOG_FILE="$MAINT/logs/deploy-$STAMP.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log() { printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { echo "ERROR: $*" >&2; cleanup_logs; exit 1; }

# ── Serialise deployments ──────────────────────────────────────────────────
exec 9>"$MAINT/deploy.lock"
if ! flock -n 9; then
  die "another deployment is in progress (lock: $MAINT/deploy.lock)"
fi

# ── Preflight ──────────────────────────────────────────────────────────────
for tool in git docker curl; do
  command -v "$tool" >/dev/null 2>&1 || die "required tool '$tool' is missing"
done
docker compose version >/dev/null 2>&1 || die "docker compose is unavailable"
command -v flock >/dev/null 2>&1 || echo "note: flock not found; relying on lock file presence only"

cleanup_logs() {
  # Capture service logs for failure diagnosis (best effort).
  if [ -n "${WORKDIR:-}" ] && [ -d "$WORKDIR" ]; then
    # shellcheck disable=SC2015
    (cd "$WORKDIR" && docker compose logs --tail 150 backend frontend > "$MAINT/logs/services-$STAMP.log" 2>&1) || true
    echo "Service logs captured at: $MAINT/logs/services-$STAMP.log"
  fi
}

log "===================================================================="
log "ValidBridge production deployment"
log "  target commit : $TARGET"
log "  workdir       : $WORKDIR"
log "  origin        : $GIT_REMOTE_URL"
log "  log           : $LOG_FILE"
log "===================================================================="

[ -d "$WORKDIR" ] || die "deploy directory does not exist: $WORKDIR"
[ -f "$WORKDIR/.env" ] || die ".env not found in $WORKDIR — refusing to deploy without production environment"
cd "$WORKDIR"

# ── Ensure a git checkout ─────────────────────────────────────────────────
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "Not a git repository yet — initializing (one-time switch from file copy to git checkout)."
  git init -q -b main
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$GIT_REMOTE_URL"
fi
git remote set-url origin "$GIT_REMOTE_URL"

log "Fetching from origin..."
if [ -n "$GIT_REMOTE_TOKEN" ]; then
  GIT_AUTH="Authorization: Basic $(printf 'x-access-token:%s' "$GIT_REMOTE_TOKEN" | base64 -w0)"
  git -c "http.extraheader=$GIT_AUTH" fetch --prune --tags origin
else
  git fetch --prune --tags origin
fi

# Resolve the target to a full SHA. Accepts short SHAs and refs.
TARGET_SHA="$(git rev-parse --verify --quiet "${TARGET}^{commit}")" || \
  TARGET_SHA="$(git rev-parse --verify --quiet "origin/${TARGET}^{commit}")" || true
if [ -z "$TARGET_SHA" ] || ! echo "$TARGET_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  die "could not resolve '$TARGET' to a commit reachable from origin"
fi
SHORT_SHA="${TARGET_SHA:0:12}"
log "Resolved target to full commit: $TARGET_SHA"

# ── Capture the previous state for rollback ───────────────────────────────
PREV_HEAD="$(git rev-parse --verify --quiet HEAD 2>/dev/null || true)"
PREV_BACKEND_IMG="$(docker inspect --format '{{.Image}}' validbridge-backend 2>/dev/null || true)"
PREV_FRONTEND_IMG="$(docker inspect --format '{{.Image}}' validbridge-frontend 2>/dev/null || true)"
COMPOSE_IMG_BACKEND="$(docker compose config --images backend 2>/dev/null || echo validbridge-backend)"
COMPOSE_IMG_FRONTEND="$(docker compose config --images frontend 2>/dev/null || echo validbridge-frontend)"
if [ -n "$PREV_BACKEND_IMG" ]; then docker tag "$PREV_BACKEND_IMG" "$COMPOSE_IMG_BACKEND:rollback" || true; fi
if [ -n "$PREV_FRONTEND_IMG" ]; then docker tag "$PREV_FRONTEND_IMG" "$COMPOSE_IMG_FRONTEND:rollback" || true; fi
{
  echo "last_deploy=$STAMP"
  echo "prev_head=${PREV_HEAD:-none}"
  echo "new_head=$TARGET_SHA"
} > "$MAINT/state/current"

# ── Database backup (only when migrations are coming) ─────────────────────
# First deploy (no previous HEAD) or any migration change -> back up first.
MIGR_DIFF=""
if [ -n "$PREV_HEAD" ] && [ "$PREV_HEAD" != "$TARGET_SHA" ]; then
  MIGR_DIFF="$(git diff --name-only "$PREV_HEAD" "$TARGET_SHA" -- apps/api/migrations/versions/ 2>/dev/null || true)"
fi

backup_db() {
  local out="$MAINT/backups/db-$STAMP-pre-$SHORT_SHA.sql.gz"
  log "Taking a pre-deploy PostgreSQL backup -> $out"
  # shellcheck disable=SC2016
  if ! docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" --no-owner --clean "$POSTGRES_DB" | gzip -1' > "$out"; then
    rm -f "$out"
    die "database backup failed — aborting before any change"
  fi
  if [ ! -s "$out" ]; then
    rm -f "$out"
    die "database backup produced an empty file — aborting before any change"
  fi
  ls -lh "$out"
}

if [ -z "$PREV_HEAD" ]; then
  log "First CI/CD deploy — backing up the existing production database before touching anything."
  backup_db
elif [ -n "$MIGR_DIFF" ]; then
  log "Migration files changed between ${PREV_HEAD:0:12} and $SHORT_SHA; backing up first."
  backup_db
else
  log "No migration changes; skipping database backup."
fi

# ── Checkout the exact commit ─────────────────────────────────────────────
log "Checking out $TARGET_SHA (branch 'deployed')..."
if ! git checkout --force -B deployed "$TARGET_SHA"; then
  log "Checkout refused — cleaning untracked files that shadow tracked paths (ignored files are preserved)."
  git clean -fd
  git checkout --force -B deployed "$TARGET_SHA"
fi
git reset --hard "$TARGET_SHA"
VERIFIED_HEAD="$(git rev-parse HEAD)"
[ "$VERIFIED_HEAD" = "$TARGET_SHA" ] || die "checkout verification failed: HEAD=$VERIFIED_HEAD expected=$TARGET_SHA"
[ -f .env ] || die "SERIOUS: .env is missing after checkout — aborting (nothing was changed on the running stack)"
log "Server is now at exact commit: $TARGET_SHA"

# ── Build the new images (old containers keep running) ────────────────────
log "Building backend and frontend images (old containers stay up)..."
docker compose build backend frontend

# ── Apply migrations from the NEW code, before any container swap ─────────
log "Applying database migrations (idempotent)..."
docker compose run --rm --no-deps --entrypoint sh backend -c "uv run alembic upgrade head"

# ── Swap the application containers ───────────────────────────────────────
log "Recreating backend and frontend with the new images..."
docker compose up -d --remove-orphans backend frontend

# ── Health verification ───────────────────────────────────────────────────
container_healthy() {
  local name="$1" status
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)"
  [ "$status" = "healthy" ]
}

wait_healthy() {
  local name="$1" attempts="${2:-48}" i=1
  while [ "$i" -le "$attempts" ]; do
    if container_healthy "$name"; then
      echo "  $name: healthy (after ~$((i * 5))s)"
      return 0
    fi
    sleep 5
    i=$((i + 1))
  done
  echo "  $name: NOT healthy after ~$((attempts * 5))s" >&2
  return 1
}

endpoint_ok() {
  local url="$1" name="$2" attempts="${3:-24}" i=1
  while [ "$i" -le "$attempts" ]; do
    if curl -fsS -m 10 "$url" >/dev/null 2>&1; then
      echo "  $name: HTTP OK ($url)"
      return 0
    fi
    sleep 5
    i=$((i + 1))
  done
  echo "  $name: FAILED after ~$((attempts * 5))s ($url)" >&2
  return 1
}

HEALTH_OK=1
log "Waiting for container health..."
wait_healthy validbridge-backend  60 || HEALTH_OK=0
wait_healthy validbridge-frontend 60 || HEALTH_OK=0

if [ "$HEALTH_OK" = 1 ]; then
  log "Verifying application health endpoints (backend also checks DB connectivity)..."
  endpoint_ok "http://localhost:8000/api/v1/health" "backend"  30 || HEALTH_OK=0
  endpoint_ok "http://localhost:3000/api/health"    "frontend" 30 || HEALTH_OK=0
fi

# Optional external (public-internet) health check.
if [ "$HEALTH_OK" = 1 ] && [ -n "${CI_HEALTH_URL:-}" ]; then
  endpoint_ok "$CI_HEALTH_URL" "external" 18 || HEALTH_OK=0
fi

# ── Rollback on failure ───────────────────────────────────────────────────
if [ "$HEALTH_OK" != 1 ]; then
  log "Deployment health checks FAILED — rolling back to the previous images."
  cleanup_logs
  rollback_ok=1
  if docker image inspect "$COMPOSE_IMG_BACKEND:rollback" >/dev/null 2>&1; then
    docker tag "$COMPOSE_IMG_BACKEND:rollback" "$COMPOSE_IMG_BACKEND"
  else
    echo "  no prior backend image tagged 'rollback' available"
    rollback_ok=0
  fi
  if docker image inspect "$COMPOSE_IMG_FRONTEND:rollback" >/dev/null 2>&1; then
    docker tag "$COMPOSE_IMG_FRONTEND:rollback" "$COMPOSE_IMG_FRONTEND"
  else
    echo "  no prior frontend image tagged 'rollback' available"
    rollback_ok=0
  fi

  if [ "$rollback_ok" = 1 ]; then
    log "Restoring previous application images..."
    docker compose up -d --no-build backend frontend || true
    sleep 10
    wait_healthy validbridge-backend  40 || true
    wait_healthy validbridge-frontend 40 || true
    endpoint_ok "http://localhost:8000/api/v1/health" "backend (rollback)"  20 || true
    endpoint_ok "http://localhost:3000/api/health"    "frontend (rollback)" 20 || true
    git checkout --force -B deployed "$PREV_HEAD" 2>/dev/null || true
    if [ -n "$PREV_HEAD" ]; then
      log "Application rolled back to ${PREV_HEAD:0:12}. NOTE: the database schema has NOT been reverted;"
      log "if the new code wrote the schema, restore the pre-deploy backup at $MAINT/backups to go back fully."
    fi
  else
    echo "WARNING: rollback images were unavailable — the network is left as deployed."
  fi
  die "deployment failed (commit $TARGET_SHA); see the logs above and DEPLOYMENT.md"
fi

# ── Success: clean up and record ──────────────────────────────────────────
log "DEPLOYMENT SUCCESSFUL — running at commit $TARGET_SHA"
echo "$TARGET_SHA" > "$MAINT/state/current-sha"

# Safe cleanup: dangling images only. Never `docker system prune -a` — it can
# remove images the running stack still needs.
pruned="$(docker image prune -f 2>/dev/null | tail -1 || true)"
log "Dangling image prune: ${pruned:-nothing to prune}"
find "$MAINT/backups" -name 'db-*.sql.gz' -mtime +14 -delete 2>/dev/null || true
log "Maintenance dir: $MAINT"
log "Deploy log saved at: $LOG_FILE"

exit 0