'use client'
import type { PlanLevel } from '@services/plans/plans'

/**
 * Single source of truth for the current org's effective plan.
 *
 * Gating is disabled in this build: the top tier is always reported so every
 * plan-based check passes.
 */
export function usePlan(): PlanLevel {
  return 'enterprise'
}
