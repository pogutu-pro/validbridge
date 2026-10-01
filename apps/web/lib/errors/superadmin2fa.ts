// The API refuses superadmin endpoints with 403 { detail: { error_code:
// 'superadmin_2fa_required' } } when VALIDBRIDGE_SUPERADMIN_REQUIRE_2FA is on
// and the signed-in superadmin has no confirmed second factor
// (apps/api/src/security/superadmin.py::ensure_superadmin_2fa).

export const SUPERADMIN_2FA_REQUIRED = 'superadmin_2fa_required'

/** True when a response status + parsed JSON body is the "enrol in 2FA" refusal. */
export function isSuperadmin2FARequired(status: number, body: unknown): boolean {
  if (status !== 403 || !body || typeof body !== 'object') return false
  const b = body as { error_code?: unknown; detail?: unknown }
  if (b.error_code === SUPERADMIN_2FA_REQUIRED) return true
  const d = b.detail
  return (
    !!d &&
    typeof d === 'object' &&
    (d as { error_code?: unknown }).error_code === SUPERADMIN_2FA_REQUIRED
  )
}
