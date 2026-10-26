import { getAPIUrl } from '@services/config/config'
import { isSuperadmin2FARequired } from '@/lib/errors/superadmin2fa'

/**
 * Whether the signed-in superadmin may use the superadmin surface right now.
 * `2fa_required` means the API wants a confirmed second factor first. Any
 * other failure is reported as `unknown` so callers fail open (the API still
 * enforces every endpoint).
 */
export async function getSuperadminAccess(
  accessToken: string
): Promise<'ok' | '2fa_required' | 'unknown'> {
  try {
    const res = await fetch(`${getAPIUrl()}ee/superadmin/status`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })
    if (res.ok) return 'ok'
    const body = await res.json().catch(() => null)
    return isSuperadmin2FARequired(res.status, body) ? '2fa_required' : 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function getSuperadminStatus(accessToken: string) {
  const res = await fetch(`${getAPIUrl()}ee/superadmin/status`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) return null
  return res.json()
}

export async function getAllOrganizations(
  accessToken: string,
  page: number = 1,
  limit: number = 20
) {
  const res = await fetch(
    `${getAPIUrl()}ee/superadmin/organizations?page=${page}&limit=${limit}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )
  if (!res.ok) throw new Error('Failed to fetch organizations')
  return res.json()
}

export async function getGlobalAnalytics(
  accessToken: string,
  days: number = 30
) {
  const res = await fetch(
    `${getAPIUrl()}ee/superadmin/analytics/global?days=${days}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )
  if (!res.ok) throw new Error('Failed to fetch global analytics')
  return res.json()
}

export async function getOrgAnalytics(
  accessToken: string,
  orgId: number,
  days: number = 30
) {
  const res = await fetch(
    `${getAPIUrl()}ee/superadmin/organizations/${orgId}/analytics?days=${days}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )
  if (!res.ok) throw new Error('Failed to fetch org analytics')
  return res.json()
}

// ── Public Education applications (superadmin review) ─────────────────────────

export type PublicEdStatus = 'pending' | 'approved' | 'rejected'

export interface PublicEdApplicationRow {
  id: number
  org_id: number
  org_name: string
  org_slug: string
  status: PublicEdStatus
  institution: string
  type: string
  reg_number?: string | null
  email_domain?: string | null
  official_domain: boolean
  has_document: boolean
  agreement_version?: string | null
  review_note?: string | null
  created_at?: string | null
  reviewed_at?: string | null
  expires_at?: string | null
}

export async function listPublicEdApplications(accessToken: string, status?: PublicEdStatus) {
  const q = status ? `?status=${status}` : ''
  const res = await fetch(`${getAPIUrl()}ee/superadmin/public-education/applications${q}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Failed to load applications')
  return (await res.json()) as { items: PublicEdApplicationRow[]; total: number }
}

export async function reviewPublicEdApplication(
  accessToken: string,
  id: number,
  decision: 'approve' | 'reject',
  reason?: string
) {
  const res = await fetch(`${getAPIUrl()}ee/superadmin/public-education/applications/${id}/${decision}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason || undefined }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail?.detail || `Failed to ${decision} application`)
  }
  return res.json()
}

/** Open the applicant's document in a new tab (fetched with auth, never cached). */
export async function openPublicEdDocument(accessToken: string, id: number) {
  const tab = window.open('', '_blank')
  const res = await fetch(`${getAPIUrl()}ee/superadmin/public-education/applications/${id}/document`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    tab?.close()
    throw new Error('Document not available')
  }
  const url = URL.createObjectURL(await res.blob())
  if (tab) tab.location.href = url
  else window.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ── Platform staff tiers and audit log ────────────────────────────────────────

export type StaffRole = 'owner' | 'support' | 'finance'

export interface StaffAccess {
  is_superadmin: boolean
  role: StaffRole | null
  capabilities: string[]
}

export interface StaffMember {
  user_uuid: string
  username: string
  email: string
  name: string
  role: StaffRole | null
  last_login_at?: string | null
}

export interface AuditRow {
  id: number
  created_at: string
  actor: string | null
  action: string
  org_id: number | null
  org_name: string | null
  resource_id: string | null
  reason: string | null
  before: unknown
  after: unknown
  ip_address: string | null
  method: string | null
  path: string | null
  status_code: number | null
}

export interface AuditFilters {
  kind?: 'actions' | 'requests'
  actor?: string
  action?: string
  q?: string
  org_id?: string
  since?: string
  until?: string
  page?: number
  limit?: number
}

const authHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
})

async function failure(res: Response, fallback: string): Promise<never> {
  const detail = await res.json().catch(() => ({}))
  throw new Error(typeof detail?.detail === 'string' ? detail.detail : fallback)
}

export async function listStaff(accessToken: string) {
  const res = await fetch(`${getAPIUrl()}ee/superadmin/staff`, { headers: authHeaders(accessToken) })
  if (!res.ok) return failure(res, 'Failed to load staff')
  return (await res.json()) as { items: StaffMember[] }
}

export async function addStaff(accessToken: string, email: string, role: 'support' | 'finance', reason: string) {
  const res = await fetch(`${getAPIUrl()}ee/superadmin/staff`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ email, role, reason }),
  })
  if (!res.ok) return failure(res, 'Failed to add staff member')
  return res.json()
}

export async function setStaffRole(
  accessToken: string,
  userUuid: string,
  role: 'support' | 'finance' | null,
  reason: string
) {
  const res = await fetch(`${getAPIUrl()}ee/superadmin/staff/${encodeURIComponent(userUuid)}`, {
    method: 'PUT',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ role, reason }),
  })
  if (!res.ok) return failure(res, 'Failed to change role')
  return res.json()
}

function auditQuery(filters: AuditFilters) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  })
  return params.toString()
}

export async function getAuditLog(accessToken: string, filters: AuditFilters) {
  const res = await fetch(`${getAPIUrl()}ee/superadmin/audit?${auditQuery(filters)}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) return failure(res, 'Failed to load the audit log')
  return (await res.json()) as { items: AuditRow[]; total: number; page: number; limit: number; role: StaffRole }
}

/** Download the filtered log as CSV (the export itself is written to the audit log). */
export async function downloadAuditCsv(accessToken: string, filters: AuditFilters) {
  const res = await fetch(`${getAPIUrl()}ee/superadmin/audit/export?${auditQuery(filters)}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) return failure(res, 'Export failed')
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
