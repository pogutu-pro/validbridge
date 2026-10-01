// Pure onboarding helpers for /new (no React), shared with tests.

export type OnboardingRole = 'admin' | 'teacher' | 'creator' | 'company' | 'student'
/** Values accepted by the API (OrganizationCreate.onboarding.institution_type). */
export type InstitutionType =
  | 'public_school'
  | 'private_school'
  | 'tvet_college'
  | 'university'
  | 'training_company'
  | 'independent'

export interface PublicEdForm {
  apply: boolean
  institution: string
  regNumber: string
  email: string
  agree: boolean
  document: File | null
}

export const EMPTY_PUBLIC_ED: PublicEdForm = {
  apply: true,
  institution: '',
  regNumber: '',
  email: '',
  agree: false,
  document: null,
}

const SCHOOLS: { id: InstitutionType; label: string }[] = [
  { id: 'public_school', label: 'Public school' },
  { id: 'private_school', label: 'Private school' },
  { id: 'tvet_college', label: 'TVET or college' },
  { id: 'university', label: 'University' },
]

export const INSTITUTION_OPTIONS: Record<Exclude<OnboardingRole, 'student'>, { id: InstitutionType; label: string }[]> = {
  admin: [...SCHOOLS, { id: 'training_company', label: 'Training institute' }],
  teacher: [...SCHOOLS, { id: 'independent', label: 'I teach independently' }],
  creator: [
    { id: 'independent', label: 'Just me' },
    { id: 'training_company', label: 'Training company or academy' },
  ],
  company: [{ id: 'training_company', label: 'Company or organization' }],
}

/** Institution types that may apply for free Public Education access. */
export function canApplyPublicEd(t: InstitutionType | null): boolean {
  return t === 'public_school' || t === 'tvet_college' || t === 'university'
}

const OFFICIAL_SUFFIXES = ['.ac.ke', '.sc.ke', '.go.ke', '.ed.ke']
export function isOfficialEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  return OFFICIAL_SUFFIXES.some((s) => domain.endsWith(s))
}

/** The public education form is complete enough to submit. */
export function publicEdReady(f: PublicEdForm): boolean {
  return !f.apply || (f.institution.trim().length > 1 && f.regNumber.trim().length > 1 && f.agree)
}

/**
 * Turn an invite link, a school host or a bare slug into a URL to send a
 * learner to. Returns null when it doesn't look like one. `platformHost` is the
 * current hostname (e.g. validbridge.co.ke) used to expand bare slugs.
 */
export function schoolAddressToUrl(input: string, platformHost: string, protocol = 'https:'): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).toString()
    } catch {
      return null
    }
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(raw)) return `${protocol}//${raw}`
  if (/^[a-z0-9][a-z0-9-]{1,40}$/i.test(raw)) {
    const apex = platformHost.replace(/^www\./, '')
    return `${protocol}//${raw.toLowerCase()}.${apex}/signup`
  }
  return null
}
