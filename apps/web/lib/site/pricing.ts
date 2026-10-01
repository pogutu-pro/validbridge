// Plans, usage prices and packs shown on the public site (/pricing, the landing
// page's pricing section, /llms.txt and the cost calculator).
//
// This mirrors the backend catalogue in
// `apps/api/src/services/billing/catalog_defaults.py`; keep the two in step.
// It will later be fetched from `GET /api/v1/billing/catalog` (cached) instead
// of being hard-coded here. Amounts are KES cents, like the backend.
//
// No imports on purpose: the calculator tests load this file directly.

export type PlanId = 'public-education' | 'starter' | 'growth' | 'business' | 'enterprise'
export type Billing = 'monthly' | 'yearly'

/** A plan allowance: a number, no cap, or agreed in an Enterprise contract. */
export type Allowance = number | 'unlimited' | 'agreed'

/** Approximate exchange rate used only to show "≈ $" next to KES prices. */
export const KES_PER_USD = 129

/** Paying 12 months upfront takes this share off the base price and seats. */
export const YEARLY_DISCOUNT = 0.15

export interface SitePlan {
  id: PlanId
  name: string
  /** Who the plan is for. */
  audience: string
  /** Monthly base price in KES cents; null = custom (Enterprise). */
  priceCents: number | null
  /** Needs verification before it is granted (Public Education). */
  requiresApproval: boolean
  seats: {
    included: Allowance
    /** Price of each extra instructor seat per month; null = seats can't be added. */
    extraCents: number | null
  }
  learners: {
    /** Active learners each instructor seat adds; null when a flat total applies. */
    perInstructor: number | null
    /** Flat cap on active learners (Starter); null when per instructor or agreed. */
    total: number | null
  }
  storageGb: Allowance
  liveHours: Allowance
  simultaneousLive: Allowance
  premiumAiCredits: Allowance
  codeRuns: Allowance
  /** Email beyond the essentials: bring your own key or buy managed email, or it's included. */
  email: 'byo-or-addon' | 'included'
  /** API, webhooks, Zapier and custom domain. */
  integrations: boolean
  badge: 'stays' | 'removable' | 'removed'
  /** Days live recordings are kept; null = kept while the course exists. */
  recordingRetentionDays: number | null
  sso: boolean
  support: 'Community' | 'Standard' | 'Priority' | 'Dedicated'
  cta: 'apply' | 'signup' | 'contact'
  popular?: boolean
}

export const PLANS: SitePlan[] = [
  {
    id: 'public-education',
    name: 'Public Education',
    audience: 'Verified public schools, TVETs, universities and government training centres',
    priceCents: 0,
    requiresApproval: true,
    seats: { included: 'unlimited', extraCents: null },
    learners: { perInstructor: 200, total: null },
    storageGb: 2,
    liveHours: 10,
    simultaneousLive: 2,
    premiumAiCredits: 0,
    codeRuns: 2000,
    email: 'byo-or-addon',
    integrations: false,
    badge: 'stays',
    recordingRetentionDays: 90,
    sso: false,
    support: 'Community',
    cta: 'apply',
  },
  {
    id: 'starter',
    name: 'Starter',
    audience: 'Anyone trying ValidBridge, and solo teachers starting out',
    priceCents: 0,
    requiresApproval: false,
    seats: { included: 1, extraCents: null },
    learners: { perInstructor: null, total: 50 },
    storageGb: 1,
    liveHours: 2,
    simultaneousLive: 1,
    premiumAiCredits: 0,
    codeRuns: 200,
    email: 'byo-or-addon',
    integrations: false,
    badge: 'stays',
    recordingRetentionDays: 90,
    sso: false,
    support: 'Community',
    cta: 'signup',
  },
  {
    id: 'growth',
    name: 'Growth',
    audience: 'Academies, trainers and training organizations',
    priceCents: 350_000,
    requiresApproval: false,
    seats: { included: 3, extraCents: 50_000 },
    learners: { perInstructor: 200, total: null },
    storageGb: 10,
    liveHours: 30,
    simultaneousLive: 3,
    premiumAiCredits: 300,
    codeRuns: 5000,
    email: 'byo-or-addon',
    integrations: true,
    badge: 'removable',
    recordingRetentionDays: null,
    sso: false,
    support: 'Standard',
    cta: 'signup',
    popular: true,
  },
  {
    id: 'business',
    name: 'Business',
    audience: 'Established schools, colleges and institutions',
    priceCents: 950_000,
    requiresApproval: false,
    seats: { included: 10, extraCents: 40_000 },
    learners: { perInstructor: 200, total: null },
    storageGb: 50,
    liveHours: 100,
    simultaneousLive: 10,
    premiumAiCredits: 1500,
    codeRuns: 20_000,
    email: 'included',
    integrations: true,
    badge: 'removed',
    recordingRetentionDays: null,
    sso: false,
    support: 'Priority',
    cta: 'signup',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    audience: 'Institutions that need more seats, storage and dedicated support. Larger deals are agreed with you',
    priceCents: 1_754_700,
    requiresApproval: false,
    seats: { included: 25, extraCents: 35_000 },
    learners: { perInstructor: 200, total: null },
    storageGb: 250,
    liveHours: 300,
    simultaneousLive: 10,
    premiumAiCredits: 5000,
    codeRuns: 50000,
    email: 'included',
    integrations: true,
    badge: 'removed',
    recordingRetentionDays: null,
    sso: false,
    support: 'Dedicated',
    cta: 'signup',
  },
]

export function getPlan(id: PlanId): SitePlan {
  const plan = PLANS.find((p) => p.id === id)
  if (!plan) throw new Error(`Unknown plan: ${id}`)
  return plan
}

// — usage prices, packs and add-ons —

export interface Pack {
  /** Units in the pack (credits, hours, runs). */
  size: number
  priceCents: number
}

/** Storage above the plan allowance, per GB per month. */
export const STORAGE_GB_CENTS = 1_500

/** Premium AI credits: one-time packs that never expire. */
export const AI_CREDIT_PACKS: Pack[] = [
  { size: 100, priceCents: 15_000 },
  { size: 500, priceCents: 65_000 },
  { size: 1000, priceCents: 120_000 },
]

/** Live class hours: one-time packs that never expire. */
export const LIVE_HOUR_PACKS: Pack[] = [
  { size: 10, priceCents: 30_000 },
  { size: 50, priceCents: 120_000 },
  { size: 100, priceCents: 200_000 },
]

/** Code runs: one-time packs that never expire. */
export const CODE_RUN_PACKS: Pack[] = [{ size: 5000, priceCents: 20_000 }]

/** LiveBridge Unlimited: monthly add-on per instructor seat, fair use about this many hours each. */
export const LIVE_UNLIMITED = { perInstructorCents: 35_000, fairUseHours: 60 } as const

/**
 * Monthly live hours per instructor above which LiveBridge Unlimited beats hour
 * packs (KES 350 against the 50-hour pack's KES 24 an hour ≈ 15 h).
 */
export const LIVE_UNLIMITED_BREAK_EVEN_HOURS = 15

/** Managed email: monthly add-on with an included volume and a price per extra block. */
export const MANAGED_EMAIL = { monthlyCents: 90_000, includedEmails: 5000, extraBlockEmails: 5000, extraBlockCents: 30_000 } as const

/** Remove the "Powered by ValidBridge" badge (Growth). */
export const REMOVE_BADGE_CENTS = 50_000

/** Single sign-on: optional monthly add-on on any paid plan (no plan includes it). */
export const SSO_ADDON_CENTS = 2_000_000

/** Everything every plan includes at no charge, Public Education and Starter too. */
export const FREE_ON_EVERY_PLAN: { title: string; detail: string }[] = [
  { title: 'Unlimited courses', detail: 'The full editor, every block type and real-time co-editing.' },
  { title: 'Assessments and grading', detail: 'Quizzes, assignments with every task type, formative mode and grading.' },
  { title: 'Certificates', detail: 'Every certificate has a QR code and a public verify page.' },
  { title: 'Advanced analytics', detail: 'Organization, course and learner analytics, with exports.' },
  { title: 'Communities', detail: 'Discussion communities and boards for every course.' },
  { title: 'Roles and security', detail: 'Roles and permissions, user groups, invite-only sign-up, 2FA and audit logs.' },
  { title: 'Content versioning', detail: 'Every change to a course is kept, so you can go back.' },
  { title: 'Course sales, 0% fee', detail: 'Sell with your own Paystack account. We take no cut.' },
  { title: 'AI on our own model', detail: 'Lesson drafts, quizzes, feedback and the assistant, under fair use.' },
  { title: 'Essential email', detail: 'Verification, password reset, magic links, invitations and receipts.' },
]

// — formatting —

const KES = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 })

/** "KES 3,500" from cents. */
export function formatKes(cents: number): string {
  return `KES ${KES.format(Math.round(cents / 100))}`
}

/** "3,500" from cents, without the currency. */
export function formatKesAmount(cents: number): string {
  return KES.format(Math.round(cents / 100))
}

/** Approximate USD, "≈ $27", from KES cents. */
export function formatUsdApprox(cents: number): string {
  return `≈ $${Math.round(cents / 100 / KES_PER_USD).toLocaleString('en-US')}`
}

/** Monthly-equivalent price for a billing period (yearly = 15% off). */
export function monthlyPriceCents(baseCents: number, billing: Billing): number {
  return billing === 'yearly' ? Math.round(baseCents * (1 - YEARLY_DISCOUNT)) : baseCents
}

/** Amount billed once a year for a monthly base price. */
export function yearlyTotalCents(baseCents: number): number {
  return monthlyPriceCents(baseCents, 'yearly') * 12
}

/** Keeps "KES 500" on one line. */
function nbsp(text: string): string {
  return text.replace(/ /g, ' ')
}

function count(n: number): string {
  return n.toLocaleString('en-US')
}

/** Short allowance lines for a plan card. */
export function planHighlights(plan: SitePlan): string[] {
  const lines: string[] = []
  const seats = plan.seats.included
  if (seats === 'unlimited') lines.push('Unlimited instructors')
  else if (typeof seats === 'number') {
    const base = `${seats} instructor${seats === 1 ? '' : 's'} included`
    lines.push(plan.seats.extraCents ? `${base}, +${nbsp(formatKes(plan.seats.extraCents))} each` : base)
  }
  if (plan.learners.total) lines.push(`${count(plan.learners.total)} active learners`)
  else if (plan.learners.perInstructor) lines.push(`${count(plan.learners.perInstructor)} active learners per instructor`)
  lines.push(`${plan.storageGb} GB storage`)
  lines.push(`${plan.liveHours} live class hours a month`)
  lines.push(
    plan.premiumAiCredits
      ? `${count(plan.premiumAiCredits as number)} premium AI credits a month`
      : 'Premium AI: buy credit packs as you need them',
  )
  lines.push('Genie navigation assistant: free')
  if (plan.integrations) lines.push('API, webhooks, Zapier and custom domain')
  if (plan.integrations) lines.push('SCORM course import')
  if (plan.email === 'included') lines.push('Managed email included')
  if (plan.badge === 'removed') lines.push('No ValidBridge badge')
  if (plan.badge === 'removable') lines.push(`Remove the badge for ${nbsp(formatKes(REMOVE_BADGE_CENTS))}/mo`)
  lines.push(`${plan.support} support`)
  if (plan.id === 'enterprise') {
    lines.push('Single sign-on available as an add-on')
    lines.push('Custom deals for larger institutions')
  }
  return lines
}

/** One row of the plan comparison table: a label and one value per plan (same order as PLANS). */
export type ComparisonValue = string | boolean
export interface ComparisonRow {
  label: string
  values: ComparisonValue[]
}

function allowanceLabel(value: Allowance, unit = ''): string {
  if (value === 'unlimited') return 'Unlimited'
  if (value === 'agreed') return 'Agreed'
  return `${count(value)}${unit}`
}

export function comparisonRows(plans: SitePlan[] = PLANS): ComparisonRow[] {
  const row = (label: string, fn: (_plan: SitePlan) => ComparisonValue): ComparisonRow => ({ label, values: plans.map(fn) })
  return [
    row('Price per month', (p) => (p.priceCents === null ? 'Custom' : p.priceCents === 0 ? 'Free' : formatKes(p.priceCents))),
    row('Instructor seats included', (p) => allowanceLabel(p.seats.included)),
    row('Extra instructor seat', (p) =>
      p.seats.extraCents ? `${formatKes(p.seats.extraCents)}/mo` : p.id === 'enterprise' ? 'Agreed' : false,
    ),
    row('Active learners', (p) =>
      p.learners.total
        ? count(p.learners.total)
        : p.learners.perInstructor
          ? `${count(p.learners.perInstructor)} per instructor`
          : 'Agreed',
    ),
    row('Storage', (p) => allowanceLabel(p.storageGb, ' GB')),
    row('Live class hours a month', (p) => allowanceLabel(p.liveHours)),
    row('Simultaneous live classes', (p) => allowanceLabel(p.simultaneousLive)),
    row('Premium AI credits a month', (p) => (p.premiumAiCredits === 0 ? 'Buy packs' : allowanceLabel(p.premiumAiCredits))),
    row('Genie help assistant', () => 'Free'),
    row('Code runs a month', (p) => allowanceLabel(p.codeRuns)),
    row('Email beyond the essentials', (p) =>
      p.email === 'included' ? 'Managed, included' : `Your own key, or ${formatKes(MANAGED_EMAIL.monthlyCents)}/mo`,
    ),
    row('API, webhooks and Zapier', (p) => p.integrations),
    row('Custom domain', (p) => p.integrations),
    row('SCORM import (1.2 and 2004)', (p) => p.integrations),
    row('"Powered by ValidBridge" badge', (p) =>
      p.badge === 'stays' ? 'Shown' : p.badge === 'removable' ? `${formatKes(REMOVE_BADGE_CENTS)}/mo to remove` : 'Removed',
    ),
    row('Recording retention', (p) =>
      p.recordingRetentionDays === null
        ? 'Kept'
        : p.id === 'public-education'
          ? `${p.recordingRetentionDays} days, or keep with paid storage`
          : `${p.recordingRetentionDays} days`,
    ),
    row('Single sign-on (SSO)', (p) =>
      p.id === 'public-education' || p.id === 'starter' ? false : `${formatKes(SSO_ADDON_CENTS)}/mo add-on`,
    ),
    row('Support', (p) => p.support),
  ]
}
