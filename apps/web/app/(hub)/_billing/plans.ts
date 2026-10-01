// Static plan catalog for the hub (display names, taglines, badge styling).
//
// Today it only feeds the upsell on the org usage page (OrgEditUsage). The
// rebuilt Paystack billing UI (W9) reads prices from the API price catalogue
// instead. Prices here are display fallbacks in whole KES (pricechange.md §3);
// the server always computes what is charged.

import { FREE_PLANS } from '@services/plans/plans'

export type PlanId = 'public-education' | 'starter' | 'growth' | 'business' | 'enterprise'

export interface PlanFeature {
  label: string
  badge?: string
}

export interface Plan {
  id: PlanId
  name: string
  tagline: string
  /** Base price per month in whole KES (0 = free, null = custom quote). */
  monthlyPriceKes: number | null
  popular?: boolean
  badge: string
  ctaStyle: string
  topGlow: string
  patternColor: string
  accentColor: string
  inheritsFrom?: string
  features: PlanFeature[]
}

// Brand rule: orange accent only for paid tiers; entry tiers stay neutral.
const BADGE = {
  entry:
    'bg-gradient-to-br from-gray-100 to-gray-200 text-gray-700 border-gray-200 shadow-sm shadow-gray-200/50',
  growth:
    'bg-gradient-to-br from-orange-50 to-orange-100 text-orange-700 border-orange-200 shadow-sm shadow-orange-100/50',
  business:
    'bg-gradient-to-br from-orange-100 to-orange-200 text-orange-800 border-orange-200 shadow-sm shadow-orange-200/50',
  enterprise:
    'bg-gradient-to-br from-orange-200 to-orange-300 text-orange-900 border-orange-300 shadow-sm shadow-orange-300/50',
}

export const GENERAL_PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Free to start: 1 instructor, 50 learners.',
    monthlyPriceKes: 0,
    badge: BADGE.entry,
    ctaStyle: 'bg-neutral-900 text-white hover:bg-neutral-800',
    topGlow: 'rgba(156,163,175,0.06)',
    patternColor: 'rgba(156,163,175,0.08)',
    accentColor: 'text-gray-600',
    features: [
      { label: '1 instructor seat' },
      { label: '50 active learners' },
      { label: '1 GB storage' },
      { label: '2 live class hours / month' },
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For academies and trainers.',
    monthlyPriceKes: 3500,
    popular: true,
    badge: BADGE.growth,
    ctaStyle: 'bg-orange-600 text-white hover:bg-orange-700',
    topGlow: 'rgba(234,88,12,0.05)',
    patternColor: 'rgba(234,88,12,0.06)',
    accentColor: 'text-orange-600',
    inheritsFrom: 'Starter',
    features: [
      { label: '3 instructor seats', badge: 'KES 500 per extra seat' },
      { label: '200 active learners per instructor' },
      { label: '10 GB storage' },
      { label: '30 live class hours / month' },
      { label: 'API, webhooks and Zapier' },
      { label: 'Custom domain' },
    ],
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'For established institutions.',
    monthlyPriceKes: 9500,
    badge: BADGE.business,
    ctaStyle: 'bg-orange-700 text-white hover:bg-orange-800',
    topGlow: 'rgba(194,65,12,0.05)',
    patternColor: 'rgba(194,65,12,0.06)',
    accentColor: 'text-orange-700',
    inheritsFrom: 'Growth',
    features: [
      { label: '10 instructor seats', badge: 'KES 400 per extra seat' },
      { label: '50 GB storage' },
      { label: '100 live class hours / month' },
      { label: 'Managed email included' },
      { label: '"Powered by ValidBridge" removed' },
      { label: 'Priority support' },
    ],
  },
]

export const ENTERPRISE_PLAN: Plan = {
  id: 'enterprise',
  name: 'Enterprise',
  tagline: 'Agreed limits, SSO and dedicated support.',
  monthlyPriceKes: null,
  badge: BADGE.enterprise,
  ctaStyle: 'bg-neutral-900 text-white hover:bg-neutral-800',
  topGlow: 'rgba(234,88,12,0.05)',
  patternColor: 'rgba(234,88,12,0.06)',
  accentColor: 'text-orange-800',
  inheritsFrom: 'Business',
  features: [
    { label: 'SSO (WorkOS / OIDC)' },
    { label: 'Agreed seats, storage and live hours' },
    { label: 'Dedicated support' },
  ],
}

export const ALL_PLANS: Plan[] = [...GENERAL_PLANS, ENTERPRISE_PLAN]

export function findPlan(planId: string): Plan | undefined {
  return ALL_PLANS.find((p) => p.id === planId)
}

export function isPaidPlan(id: PlanId | string | null | undefined): boolean {
  return !!id && !FREE_PLANS.has(id)
}

/** Format a whole-KES display price. null → "Custom", 0 → "Free". */
export function formatPriceKes(value: number | null | undefined): string {
  if (value == null) return 'Custom'
  if (value === 0) return 'Free'
  return `KES ${value.toLocaleString('en-KE')}`
}
