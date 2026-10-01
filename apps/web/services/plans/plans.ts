/**
 * Plan utilities for the frontend.
 *
 * All plan data (feature configs, limits, requirements) lives in the API.
 * The frontend reads `resolved_features` from the org config returned by the API.
 *
 * This file only provides:
 *   - PlanLevel type
 *   - Plan hierarchy and labels for UI (plan badges, upgrade prompts)
 *   - Deployment mode helpers (OSS/EE bypass)
 */

// Plan ids MUST match the backend (src/security/features_utils/plans.py).
// 'oss' is a display-only value for self-hosted OSS mode (not a real plan).
export type PlanLevel =
  | 'public-education'
  | 'starter'
  | 'growth'
  | 'business'
  | 'enterprise'
  | 'oss'

// Display / upgrade order (lowest first).
export const PLAN_HIERARCHY: PlanLevel[] = ['public-education', 'starter', 'growth', 'business', 'enterprise']

// Plan given to new organizations and used for unknown values.
export const DEFAULT_PLAN: PlanLevel = 'starter'

// Rank for requirement checks. Public Education and Starter are both entry
// tiers and share a rank (mirrors PLAN_RANK in the API).
export const PLAN_RANK: Record<string, number> = {
  'public-education': 0,
  starter: 0,
  growth: 1,
  business: 2,
  enterprise: 3,
}

// Plans with no base price.
export const FREE_PLANS: ReadonlySet<string> = new Set(['public-education', 'starter'])

export const PLAN_LABELS: Record<string, string> = {
  'public-education': 'Public Education',
  starter: 'Starter',
  growth: 'Growth',
  business: 'Business',
  enterprise: 'Enterprise',
  oss: 'OSS',
}

/** Human-readable plan name (unknown values fall back to the raw id). */
export function planLabel(plan: string | null | undefined): string {
  if (!plan) return PLAN_LABELS[DEFAULT_PLAN]
  return PLAN_LABELS[plan] ?? plan
}

/**
 * The org's plan id as stored in its config. MUST match the backend's
 * `_get_plan_from_config`: `config.plan` on v2 configs and `config.cloud.plan`
 * on v1 (legacy) ones. Use this to show the plan; `usePlan()` always answers
 * 'enterprise' because interface gating is off (the server enforces plans).
 */
export function resolvePlanIdFromOrg(org: any): PlanLevel {
  const config = org?.config?.config
  const isV2 =
    typeof config?.config_version === 'string' && config.config_version.startsWith('2')
  const plan = isV2 ? config?.plan : config?.cloud?.plan
  return plan in PLAN_RANK ? (plan as PlanLevel) : DEFAULT_PLAN
}

/** True for paid plans (Growth, Business, Enterprise). */
export function isPaidPlan(plan: string | null | undefined): boolean {
  return !!plan && plan in PLAN_RANK && !FREE_PLANS.has(plan)
}

/**
 * Check if the current plan meets or exceeds the required plan level.
 *
 * Gating is disabled in this build: every plan is treated as meeting every
 * requirement.
 */
export function planMeetsRequirement(
  currentPlan: PlanLevel,
  requiredPlan: PlanLevel
): boolean {
  return true
}

/**
 * Check if a feature is available.
 *
 * Gating is disabled in this build: every feature is available.
 */
export function isFeatureAvailable(featureKey: string, _currentPlan?: PlanLevel): boolean {
  return true
}
