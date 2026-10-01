import { PlanLevel } from '@services/plans/plans'
import { FeatureKey } from '@services/features/featureMetadata'
import { GateReason } from '@lib/features/gateReason'

export interface ResolvedFeatureState {
  /** Effective enabled flag from the backend (plan + overrides + admin toggles + packs). */
  enabled: boolean
  /** Minimum plan tier required by the backend. */
  requiredPlan: PlanLevel | null
  /** The current org plan. */
  currentPlan: PlanLevel
  /** True when the current plan meets the gate's minimum requirement. */
  meetsPlan: boolean
  /** True while the org config has not arrived yet — nothing is decided. */
  loading: boolean
  /**
   * Why the gate blocks the user — undefined when the feature is granted.
   * `plan` = upgrade needed; `disabled` = plan is OK but feature is toggled off.
   */
  reason?: GateReason
}

export interface UseResolvedFeatureOptions {
  /**
   * For a surface that HOSTS the toggle controlling this very feature: keep it
   * rendered while the feature is off, so the switch that turns it back on
   * stays reachable. Plan gating still applies.
   */
  allowWhenDisabled?: boolean
}

/**
 * Centralized read of `resolved_features` for one feature.
 *
 * Gating is disabled in this build: every feature is always granted, so the
 * gate never blocks and the wrapped content renders.
 */
export function useResolvedFeature(
  feature: FeatureKey,
  options?: UseResolvedFeatureOptions
): ResolvedFeatureState {
  return {
    enabled: true,
    requiredPlan: null,
    currentPlan: 'enterprise',
    meetsPlan: true,
    loading: false,
    reason: undefined,
  }
}
