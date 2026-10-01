/**
 * Shared configuration for the E2E suite.
 *
 * The suite runs against an already-running ValidBridge instance. Start the
 * stack first (e.g. `docker compose up -d` at the repo root), then point the
 * suite at it via E2E_BASE_URL / E2E_PORT (default http://localhost:3000).
 */

const PORT = process.env.E2E_PORT || '3000'
const DOMAIN = process.env.E2E_DOMAIN || 'localhost'

/** Base URL of the running instance the browser talks to. */
export const BASE_URL =
  process.env.E2E_BASE_URL || `http://${DOMAIN}:${PORT}`

/** REST API root — used by helpers/verify.ts to read back server state.
 * Defaults to same-origin; point at a separate API origin via E2E_API_URL for
 * split web/API dev setups. */
export const API_URL = process.env.E2E_API_URL || `${BASE_URL}/api/v1`

/** Organization the install is bootstrapped with. */
export const ORG_SLUG = process.env.E2E_ORG_SLUG || 'default'

/** Bootstrapped admin / teacher account. */
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@school.dev'
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'E2eTestAdmin!234'

export { PORT, DOMAIN }

/** Deterministic unique-ish suffix for created entities (no Date.now in shared code paths is fine here — this runs in Node, not a workflow). */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

/** A fresh student identity for a test run. */
export function makeStudent(label: string) {
  const suffix = uniqueSuffix()
  return {
    // Avoid reserved TLDs (.test/.example/.localhost) — the API email
    // validator rejects them. A normal .com domain validates fine.
    email: `student-${label}-${suffix}@e2e-tests.com`,
    username: `student_${label}_${suffix}`.replace(/-/g, '_'),
    password: 'E2eStudent!234',
    firstName: 'Stu',
    lastName: label,
  }
}
