#!/bin/bash
# Local demo stack — API.
#
# The demo is a *second* organization, so it needs subdomain tenancy: in single
# tenancy every path resolves to the one default org and the demo is
# unreachable. lvh.me (and every subdomain of it) resolves to 127.0.0.1, so
# demo.lvh.me works locally with no hosts-file editing.
#
# These are exported rather than left in .env because config.py reads the
# environment while parsing, and multi tenancy is rejected outright for a
# localhost domain.
#
# Secrets are generated on first run into .demo-secrets (gitignored) rather
# than written here. A signing key committed to the repository is a signing key
# every deployment that copies this file shares, however clearly it is labelled
# dev-only.
set -euo pipefail
cd "$(dirname "$0")"

SECRETS_FILE="../../.demo-secrets"
if [ ! -f "$SECRETS_FILE" ]; then
  echo "Generating local demo secrets in $(cd .. && pwd)/../.demo-secrets"
  {
    echo "VALIDBRIDGE_AUTH_JWT_SECRET_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
    echo "COLLAB_INTERNAL_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
    echo "VALIDBRIDGE_INITIAL_ADMIN_PASSWORD=$(python3 -c 'import secrets;print(secrets.token_urlsafe(12))')"
  } > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
  echo "Admin password: $(grep VALIDBRIDGE_INITIAL_ADMIN_PASSWORD "$SECRETS_FILE" | cut -d= -f2)"
fi
set -a
# shellcheck disable=SC1090
. "$SECRETS_FILE"
set +a

export VALIDBRIDGE_SQL_CONNECTION_STRING="postgresql+asyncpg://validbridge:validbridge@localhost:5432/validbridge"
export VALIDBRIDGE_REDIS_CONNECTION_STRING="redis://localhost:6379/0"
export VALIDBRIDGE_DEVELOPMENT_MODE=true

export VALIDBRIDGE_TENANCY=multi
export VALIDBRIDGE_DOMAIN="lvh.me:3010"
export VALIDBRIDGE_FRONTEND_DOMAIN="lvh.me:3010"
export VALIDBRIDGE_COOKIE_DOMAIN=".lvh.me"
# Multi tenancy is gated on "Enterprise Edition available OR SaaS mode", and
# the demo needs nothing from the Enterprise Edition, so SaaS is the simpler
# switch to flip for a local run.
export VALIDBRIDGE_SAAS=true

export VALIDBRIDGE_DEMO_ENABLED=1
export VALIDBRIDGE_DEMO_SLUG=demo
export VALIDBRIDGE_DEMO_REFRESH_MINUTES=10

export VALIDBRIDGE_INITIAL_ADMIN_EMAIL=admin@school.dev

exec uv run uvicorn app:app --host 0.0.0.0 --port 1348 --log-level info
