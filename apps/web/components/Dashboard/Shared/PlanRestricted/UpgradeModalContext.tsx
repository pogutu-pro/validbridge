'use client'

import React, { createContext, useCallback, useContext, useState } from 'react'
import UpgradeModal from '@components/Dashboard/Shared/PlanRestricted/UpgradeModal'
import LimitErrorDialog, {
  isLimitErrorDetail,
  type LimitErrorDetail,
} from '@components/Dashboard/Shared/PlanRestricted/LimitErrorDialog'
import { isPlanLimitError } from '@services/utils/ts/errorMessage'
import { useVBAnalytics, AnalyticsEvent } from '@services/analytics'

interface ShowUpgradeOptions {
  /** Analytics attribution for where the prompt was triggered from. */
  source?: string
  /** The gated feature (e.g. 'usergroups'), for the FeatureGateUpgradeShown event. */
  feature?: string
  /** The plan that unlocks it (e.g. 'growth' | 'business'), for analytics. */
  requiredPlan?: string
}

interface UpgradeModalContextValue {
  /** Open the shared upgrade modal, tracking a feature-gate event. */
  showUpgrade: (_options?: ShowUpgradeOptions) => void
  /**
   * Inspect an API response; if it is a plan-limit / feature-gated 403, open the
   * upgrade modal and return true (so the caller can skip its error toast).
   * Returns false for any other error, letting the caller handle it normally.
   */
  handlePlanLimit: (_res: any, _options?: ShowUpgradeOptions) => boolean
}

const UpgradeModalContext = createContext<UpgradeModalContextValue | null>(null)

/**
 * Provides a single, app-wide upgrade modal so any surface can turn a
 * "limit reached" backend error into a contextual upgrade prompt without
 * rendering its own modal. Mounted inside the dashboard layout (below
 * OrgProvider, which the modal depends on).
 */
export function UpgradeModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<string>('free_plan_banner')
  const { track } = useVBAnalytics('dashboard')

  const showUpgrade = useCallback(
    (options?: ShowUpgradeOptions) => {
      if (options?.feature) {
        track(AnalyticsEvent.FeatureGateUpgradeShown, {
          feature: options.feature,
          surface: options.source,
          required_plan: options.requiredPlan,
        })
      }
      setSource(options?.source || 'free_plan_banner')
      setOpen(true)
    },
    [track]
  )

  const [limitDetail, setLimitDetail] = useState<LimitErrorDetail | null>(null)

  const handlePlanLimit = useCallback(
    (res: any, options?: ShowUpgradeOptions) => {
      // Structured limit errors (§4.4: seats, learners, storage, …) say exactly
      // what to buy; show that instead of the generic plan comparison. Accepts
      // both a getResponseMetadata result and a thrown apiFetch error.
      const detail = res?.data?.detail ?? res?.detail
      if (isLimitErrorDetail(detail)) {
        if (options?.feature) {
          track(AnalyticsEvent.FeatureGateUpgradeShown, {
            feature: options.feature,
            surface: options.source,
            required_plan: options.requiredPlan,
          })
        }
        setLimitDetail(detail)
        return true
      }
      if (isPlanLimitError(detail)) {
        showUpgrade(options)
        return true
      }
      return false
    },
    [showUpgrade, track]
  )

  return (
    <UpgradeModalContext.Provider value={{ showUpgrade, handlePlanLimit }}>
      {children}
      <UpgradeModal open={open} source={source} onClose={() => setOpen(false)} />
      <LimitErrorDialog detail={limitDetail} onClose={() => setLimitDetail(null)} />
    </UpgradeModalContext.Provider>
  )
}

/**
 * Access the app-wide upgrade modal. Safe to call outside the provider — it
 * returns a no-op fallback (returns false / does nothing) so surfaces that can
 * render outside the dashboard shell don't crash; they simply fall back to
 * their normal error toast.
 */
export function useUpgradeModal(): UpgradeModalContextValue {
  const ctx = useContext(UpgradeModalContext)
  if (!ctx) {
    return {
      showUpgrade: () => {},
      handlePlanLimit: () => false,
    }
  }
  return ctx
}
