// Carries the plan a visitor picked on the pricing page ("Choose Growth")
// through signup, email verification and org creation, so they land on the
// billing page with that plan ready to pay for, instead of silently ending up
// on the free plan. Nothing is activated by this: it only preselects a plan.
//
// Kept in localStorage because email signup crosses a verification link (new
// tab, fresh page load) that no query parameter survives.

const KEY = 'vb:plan_intent'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Plans a visitor may pick for checkout. Public Education is approved, not
 * bought, so it never becomes an intent. */
export const INTENT_PLANS = ['growth', 'business', 'enterprise'] as const
export type IntentPlan = (typeof INTENT_PLANS)[number]

export interface PlanIntent {
  plan: IntentPlan
  cycle: 'monthly' | 'yearly'
}

function isIntentPlan(value: string | null | undefined): value is IntentPlan {
  return !!value && (INTENT_PLANS as readonly string[]).includes(value)
}

/** Remember ?plan= (and ?cycle=) from the current URL, if present. */
export function capturePlanIntent(params: URLSearchParams | null | undefined): PlanIntent | null {
  const plan = params?.get('plan')
  if (!isIntentPlan(plan)) return null
  const intent: PlanIntent = { plan, cycle: params?.get('cycle') === 'yearly' ? 'yearly' : 'monthly' }
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...intent, at: Date.now() }))
  } catch {
    /* private mode / storage blocked: the intent just doesn't survive */
  }
  return intent
}

export function readPlanIntent(): PlanIntent | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isIntentPlan(parsed?.plan) || Date.now() - Number(parsed?.at || 0) > TTL_MS) {
      localStorage.removeItem(KEY)
      return null
    }
    return { plan: parsed.plan, cycle: parsed.cycle === 'yearly' ? 'yearly' : 'monthly' }
  } catch {
    return null
  }
}

export function clearPlanIntent(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** Hub billing URL for an org, with the plan preselected when given. */
export function billingUrl(orgSlug: string, intent?: PlanIntent | null): string {
  const q = new URLSearchParams({ org: orgSlug })
  if (intent) {
    q.set('plan', intent.plan)
    q.set('cycle', intent.cycle)
  }
  return `/billing?${q.toString()}`
}
