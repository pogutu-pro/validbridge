'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CreditCard } from 'lucide-react'

export const BILLING_SUPPORT_EMAIL = 'support@validbridge.co.ke'

/**
 * Placeholder shown on the hub billing pages while platform billing moves to
 * Paystack. Organizations keep working on their current plan in the meantime.
 */
export default function BillingComingSoon() {
  const { t } = useTranslation()
  return (
    <div className="bg-white nice-shadow rounded-2xl p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.04] text-black/50">
        <CreditCard size={22} />
      </div>
      <h1 className="font-black tracking-tight text-2xl text-gray-900">
        {t('billing.upgrading_title', { defaultValue: 'Billing is being upgraded' })}
      </h1>
      <p className="mt-2 text-sm text-black/50 max-w-md mx-auto leading-relaxed">
        {t('billing.upgrading_body', {
          defaultValue: 'Plans and payments will be available here soon.',
        })}
      </p>
      <p className="mt-4 text-sm text-black/50">
        {t('billing.upgrading_questions', { defaultValue: 'Questions:' })}{' '}
        <a
          href={`mailto:${BILLING_SUPPORT_EMAIL}`}
          className="font-semibold text-gray-900 underline underline-offset-2"
        >
          {BILLING_SUPPORT_EMAIL}
        </a>
      </p>
    </div>
  )
}
