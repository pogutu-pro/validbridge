#!/bin/bash
# Local demo stack — Web frontend.
#
# The web talks to the demo API on port 1348 (not the OSS default of 8000) and
# must serve the demo org on the `demo.lvh.me` subdomain, so multi-org tenancy
# and the lvh.me domains are exported here rather than left to the repo-root
# `.env` (which `bun run` auto-loads and which holds the OSS defaults).
#
# Usage:
#   bash run_demo_web.sh            # production: next build + next start -p 3010
#   bash run_demo_web.sh --dev      # development: next dev --turbopack -p 3010
set -euo pipefail
cd "$(dirname "$0")"

export NEXT_PUBLIC_VALIDBRIDGE_BACKEND_URL="http://lvh.me:1348/"
export NEXT_PUBLIC_VALIDBRIDGE_API_URL="http://lvh.me:1348/api/v1/"
export NEXT_PUBLIC_VALIDBRIDGE_DOMAIN="lvh.me:3010"
export NEXT_PUBLIC_VALIDBRIDGE_TOP_DOMAIN="lvh.me"
export NEXT_PUBLIC_VALIDBRIDGE_DEFAULT_ORG="default"
export NEXT_PUBLIC_COLLAB_URL="ws://lvh.me:4000"

# Write the CLIENT-side runtime config from the NEXT_PUBLIC_* env. The
# next.config.js block that does this in dev is skipped for `next build`
# (NODE_ENV=production), so without this the static file would keep the OSS
# defaults (port 8000) and every client-side call would miss the demo API.
node -e '
  const fs = require("fs");
  const cfg = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("NEXT_PUBLIC_")) cfg[k] = process.env[k];
  }
  fs.writeFileSync(
    "public/runtime-config.js",
    `window.__RUNTIME_CONFIG__ = ${JSON.stringify(cfg)};\n`,
  );
'

if [ "${1:-}" = "--dev" ]; then
  exec bun run next dev --turbopack -p 3010
fi

# Production build (idempotent) then serve.
bun run next build
exec bun run next start -p 3010
