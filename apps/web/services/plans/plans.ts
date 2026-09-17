/**
 * Plan utilities for the frontend.
 *
 * All plan data (feature configs, limits, requirements) lives in the API.
 * The frontend reads `resolved_features` from the org config returned by the API.
 *
 * This file only provides:
 *   - PlanLevel type
 *   - Plan hierarchy for UI comparisons (plan badges, upgrade prompts)
 *   - Deployment mode helpers (OSS/EE bypass)
 */

// Plan ids MUST match the backend (src/security/features_utils/plans.py): the
// family tier is 'personal-family', not 'family'. Using 'family' broke
// PLAN_HIERARCHY.indexOf() (→ -1) so planMeetsRequirement() denied every gated
// feature for those orgs.
export type PlanLevel = 'free' | 'personal' | 'personal-family' | 'standard' | 'pro' | 'enterprise' | 'oss'

// Plan hierarchy for SaaS mode (lower index = lower tier).
// 'oss' is kept as a display-only type value (not in hierarchy) for OSS mode label rendering.
export const PLAN_HIERARCHY: PlanLevel[] = ['free', 'personal', 'personal-family', 'standard', 'pro', 'enterprise']

// Features blocked in OSS mode — require EE or SaaS/enterprise plan
const OSS_BLOCKED_FEATURES = new Set(['sso', 'audit_logs', 'payments', 'analytics_advanced', 'scorm'])

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
