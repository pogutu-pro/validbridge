// Monthly cost estimate for the pricing page calculator. Pure functions over
// the site catalogue (./pricing.ts), so the numbers can be unit-tested and
// later checked against the server's invoice preview.
//
// Rules: base price; extra instructor seats beyond the plan's; storage above
// the allowance per GB; live hours above the allowance from the cheapest pack
// mix, or LiveBridge Unlimited per instructor when chosen; premium AI credits
// above the allowance from the cheapest pack mix; managed email unless the
// plan includes it; badge removal on Growth only. Packs are one-time, so they
// count only in months they're bought.

import {
  AI_CREDIT_PACKS,
  LIVE_HOUR_PACKS,
  LIVE_UNLIMITED,
  MANAGED_EMAIL,
  REMOVE_BADGE_CENTS,
  STORAGE_GB_CENTS,
  YEARLY_DISCOUNT,
  getPlan,
  type Pack,
  type PlanId,
} from './pricing'

export interface CalculatorInput {
  planId: PlanId
  instructors: number
  storageGb: number
  liveHours: number
  premiumAiCredits: number
  managedEmail: boolean
  removeBadge: boolean
  liveUnlimited: boolean
}

export type LineItemId = 'base' | 'seats' | 'storage' | 'live' | 'ai' | 'email' | 'badge'

export interface LineItem {
  id: LineItemId
  label: string
  /** How the amount was worked out, e.g. "3 × KES 500". */
  detail: string
  cents: number
}

export interface PackMix {
  cents: number
  /** Packs bought, largest first; only sizes with a count above zero. */
  packs: { size: number; count: number }[]
  /** Units the packs cover (at least the units asked for). */
  units: number
}

export type Estimate =
  | { kind: 'quote' }
  | {
      kind: 'estimate'
      lines: LineItem[]
      totalCents: number
      /** What paying yearly would save each month (15% off base and seats). */
      yearlySavingsCents: number
      /** When the other live option is cheaper: which one and by how much each month. */
      liveTip: { option: 'unlimited' | 'packs'; savesCents: number } | null
      notes: string[]
    }

/** Upper bound on units the calculator prices, to keep the search small. */
export const MAX_UNITS = 1_000_000

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * The cheapest set of packs that covers at least `units` (packs are bought
 * whole, so a bigger pack can beat several small ones). Exact: a small
 * dynamic programme over steps of the packs' common divisor.
 */
export function cheapestPackMix(units: number, packs: Pack[]): PackMix {
  const need = Math.min(Math.max(0, Math.ceil(units)), MAX_UNITS)
  if (need === 0 || packs.length === 0) return { cents: 0, packs: [], units: 0 }
  const step = packs.map((p) => p.size).reduce(gcd)
  const n = Math.ceil(need / step)
  const cost = new Array<number>(n + 1).fill(Infinity)
  const pick = new Array<number>(n + 1).fill(-1)
  cost[0] = 0
  for (let u = 1; u <= n; u++) {
    packs.forEach((p, i) => {
      const c = p.priceCents + cost[Math.max(0, u - p.size / step)]
      // Prefer the larger pack on a tie (fewer packs, more units).
      if (c < cost[u] || (c === cost[u] && pick[u] >= 0 && p.size > packs[pick[u]].size)) {
        cost[u] = c
        pick[u] = i
      }
    })
  }
  const counts = new Map<number, number>()
  let covered = 0
  for (let u = n; u > 0; ) {
    const p = packs[pick[u]]
    counts.set(p.size, (counts.get(p.size) ?? 0) + 1)
    covered += p.size
    u = Math.max(0, u - p.size / step)
  }
  return {
    cents: cost[n],
    packs: [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([size, count]) => ({ size, count })),
    units: covered,
  }
}

const fmt = (cents: number) => `KES ${Math.round(cents / 100).toLocaleString('en-US')}`
const num = (n: number) => n.toLocaleString('en-US')

function packDetail(mix: PackMix, unit: string): string {
  return mix.packs.map((p) => `${p.count} × ${num(p.size)} ${unit} pack`).join(' + ')
}

function whole(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

export function estimateMonthlyCost(raw: CalculatorInput): Estimate {
  const plan = getPlan(raw.planId)
  if (plan.priceCents === null) return { kind: 'quote' }

  const input = {
    ...raw,
    instructors: Math.max(1, whole(raw.instructors)),
    storageGb: whole(raw.storageGb),
    liveHours: whole(raw.liveHours),
    premiumAiCredits: whole(raw.premiumAiCredits),
  }
  const lines: LineItem[] = []
  const notes: string[] = []

  lines.push({ id: 'base', label: `${plan.name} plan`, detail: plan.priceCents === 0 ? 'Free' : 'Monthly base price', cents: plan.priceCents })

  // Instructor seats
  let seatsCents = 0
  const included = plan.seats.included
  if (typeof included === 'number' && input.instructors > included) {
    const extra = input.instructors - included
    if (plan.seats.extraCents) {
      seatsCents = extra * plan.seats.extraCents
      lines.push({
        id: 'seats',
        label: 'Extra instructor seats',
        detail: `${num(extra)} × ${fmt(plan.seats.extraCents)}`,
        cents: seatsCents,
      })
    } else {
      notes.push(`${plan.name} includes ${num(included)} instructor${included === 1 ? '' : 's'}. For more, choose Growth or Business.`)
    }
  }

  // Storage above the allowance
  const storageAllowance = typeof plan.storageGb === 'number' ? plan.storageGb : 0
  const extraGb = Math.max(0, input.storageGb - storageAllowance)
  if (extraGb > 0) {
    lines.push({
      id: 'storage',
      label: 'Extra storage',
      detail: `${num(extraGb)} GB × ${fmt(STORAGE_GB_CENTS)}`,
      cents: extraGb * STORAGE_GB_CENTS,
    })
  }

  // Live classes: hour packs, or LiveBridge Unlimited per instructor
  const liveAllowance = typeof plan.liveHours === 'number' ? plan.liveHours : 0
  const extraHours = Math.max(0, input.liveHours - liveAllowance)
  const packs = cheapestPackMix(extraHours, LIVE_HOUR_PACKS)
  const unlimitedCents = input.instructors * LIVE_UNLIMITED.perInstructorCents
  let liveTip: { option: 'unlimited' | 'packs'; savesCents: number } | null = null
  if (input.liveUnlimited) {
    lines.push({
      id: 'live',
      label: 'LiveBridge Unlimited',
      detail: `${num(input.instructors)} × ${fmt(LIVE_UNLIMITED.perInstructorCents)}`,
      cents: unlimitedCents,
    })
    if (packs.cents < unlimitedCents) liveTip = { option: 'packs', savesCents: unlimitedCents - packs.cents }
    if (input.liveHours > input.instructors * LIVE_UNLIMITED.fairUseHours) {
      notes.push(`LiveBridge Unlimited is fair use, about ${LIVE_UNLIMITED.fairUseHours} hours per instructor a month.`)
    }
  } else if (packs.cents > 0) {
    lines.push({ id: 'live', label: 'Live class hours', detail: packDetail(packs, 'h'), cents: packs.cents })
    if (unlimitedCents < packs.cents) liveTip = { option: 'unlimited', savesCents: packs.cents - unlimitedCents }
  }

  // Premium AI credits above the allowance
  const aiAllowance = typeof plan.premiumAiCredits === 'number' ? plan.premiumAiCredits : 0
  const ai = cheapestPackMix(Math.max(0, input.premiumAiCredits - aiAllowance), AI_CREDIT_PACKS)
  if (ai.cents > 0) {
    lines.push({ id: 'ai', label: 'Premium AI credits', detail: packDetail(ai, 'credit'), cents: ai.cents })
  }

  // Managed email
  if (input.managedEmail) {
    if (plan.email === 'included') {
      lines.push({ id: 'email', label: 'Managed email', detail: `Included in ${plan.name}`, cents: 0 })
    } else {
      lines.push({
        id: 'email',
        label: 'Managed email',
        detail: `Up to ${num(MANAGED_EMAIL.includedEmails)} emails a month`,
        cents: MANAGED_EMAIL.monthlyCents,
      })
    }
  }

  // "Powered by ValidBridge" badge
  if (input.removeBadge) {
    if (plan.badge === 'removable') {
      lines.push({ id: 'badge', label: 'Remove the ValidBridge badge', detail: 'Monthly add-on', cents: REMOVE_BADGE_CENTS })
    } else if (plan.badge === 'removed') {
      lines.push({ id: 'badge', label: 'Remove the ValidBridge badge', detail: `Included in ${plan.name}`, cents: 0 })
    } else {
      notes.push(`The ValidBridge badge stays on ${plan.name}. Growth can remove it; Business removes it.`)
    }
  }

  const totalCents = lines.reduce((sum, l) => sum + l.cents, 0)
  const yearlySavingsCents = Math.round((plan.priceCents + seatsCents) * YEARLY_DISCOUNT)
  if (ai.cents > 0 || (!input.liveUnlimited && packs.cents > 0)) {
    notes.push('Packs are one-time purchases that never expire, so they only count in months you buy them.')
  }
  return { kind: 'estimate', lines, totalCents, yearlySavingsCents, liveTip, notes }
}
