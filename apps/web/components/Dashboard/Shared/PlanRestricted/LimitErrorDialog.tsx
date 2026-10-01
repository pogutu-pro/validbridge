'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, X } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getMainDomainUri } from '@services/config/config'

/**
 * The limit error contract (pricing-implementation.md §4.4): the API refuses an
 * action that a payment would unlock with HTTP 402 (403 when the plan doesn't
 * include it) and a body the UI can act on.
 */
export interface LimitErrorDetail {
  error_code: string
  metric?: string | null
  used?: number | null
  limit?: number | null
  options?: string[]
  message?: string
}

export const LIMIT_ERROR_CODES = new Set([
  'seat_limit_reached',
  'learner_allowance_grace',
  'learner_allowance_exceeded',
  'storage_quota_exceeded',
  'live_hours_exhausted',
  'live_concurrency_limit',
  'premium_ai_credits_exhausted',
  'code_runs_exhausted',
  'email_not_enabled',
  'feature_not_in_plan',
  'billing_paused',
  'spending_limit_reached',
])

export function isLimitErrorDetail(detail: unknown): detail is LimitErrorDetail {
  return (
    !!detail &&
    typeof detail === 'object' &&
    LIMIT_ERROR_CODES.has(String((detail as any).error_code))
  )
}

const TITLES: Record<string, string> = {
  seat_limit_reached: 'All instructor seats are in use',
  learner_allowance_grace: 'You are over your learner allowance',
  learner_allowance_exceeded: 'Your learner allowance is used up',
  storage_quota_exceeded: 'Your storage is full',
  live_hours_exhausted: "This month's live hours are used up",
  live_concurrency_limit: 'Too many live classes at once',
  premium_ai_credits_exhausted: 'Premium AI credits are used up',
  code_runs_exhausted: "This month's code runs are used up",
  email_not_enabled: 'This email needs managed email',
  feature_not_in_plan: 'Not included in your plan',
  billing_paused: 'Paid features are paused',
  spending_limit_reached: 'Monthly spending limit reached',
}

// Each option the API offers → button label and the billing-page section it
// opens (the page reads ?focus=).
const OPTIONS: Record<string, { label: string; focus: string }> = {
  add_seat: { label: 'Add an instructor seat', focus: 'seats' },
  upgrade: { label: 'Upgrade plan', focus: 'plans' },
  buy_storage: { label: 'Add storage', focus: 'plans' },
  buy_live_hours: { label: 'Buy live hours', focus: 'packs' },
  live_unlimited: { label: 'Get LiveBridge Unlimited', focus: 'addons' },
  buy_ai_credits: { label: 'Buy AI credits', focus: 'packs' },
  buy_code_runs: { label: 'Buy code runs', focus: 'packs' },
  managed_email: { label: 'Turn on managed email', focus: 'addons' },
  byo_email: { label: 'Use your own email key', focus: 'addons' },
  pay_invoice: { label: 'Pay invoice', focus: 'invoices' },
  raise_spending_limit: { label: 'Change spending limit', focus: 'settings' },
}

function formatUsage(metric: string | null | undefined, value: number): string {
  if (metric === 'storage') return `${(value / 1024 ** 3).toFixed(value >= 10 * 1024 ** 3 ? 0 : 1)} GB`
  if (metric === 'live_seconds') return `${Math.round(value / 360) / 10} h`
  return value.toLocaleString('en-KE')
}

export default function LimitErrorDialog({
  detail,
  onClose,
}: {
  detail: LimitErrorDetail | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  if (!detail) return null
  const slug = org?.slug as string | undefined
  const options = (detail.options || []).filter((o) => OPTIONS[o])
  const href = (focus: string) =>
    slug ? getMainDomainUri(`/billing?org=${encodeURIComponent(slug)}&focus=${focus}`) : '#'
  const showUsage = detail.used != null && detail.limit != null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative mx-4 w-full max-w-md rounded-2xl bg-white p-6 nice-shadow">
        <button
          onClick={onClose}
          aria-label={t('common.close', { defaultValue: 'Close' })}
          className="absolute end-4 top-4 rounded-lg p-1.5 text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
        <h2 className="pe-6 text-lg font-bold tracking-tight text-gray-900">
          {t(`billing.limits.${detail.error_code}.title`, {
            defaultValue: TITLES[detail.error_code] || 'Limit reached',
          })}
        </h2>
        {detail.message && <p className="mt-2 text-sm leading-relaxed text-gray-500">{detail.message}</p>}
        {showUsage && (
          <p className="mt-3 inline-flex rounded-lg bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600">
            {t('billing.limits.usage', {
              defaultValue: '{{used}} of {{limit}} used',
              used: formatUsage(detail.metric, Number(detail.used)),
              limit: formatUsage(detail.metric, Number(detail.limit)),
            })}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2">
          {options.map((option, i) => (
            <a
              key={option}
              href={href(OPTIONS[option].focus)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                i === 0 ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              {t(`billing.limits.options.${option}`, { defaultValue: OPTIONS[option].label })}
              <ArrowRight size={14} data-dir-flip />
            </a>
          ))}
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50"
          >
            {t('common.not_now', { defaultValue: 'Not now' })}
          </button>
        </div>
      </div>
    </div>
  )
}
