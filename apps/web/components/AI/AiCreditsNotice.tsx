'use client'

import React from 'react'
import { Sparkle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useAiCreditsExhausted } from '@services/ai/credits'
import { getMainDomainUri } from '@services/config/config'

/**
 * Says plainly when the school has no AI credits left. Renders nothing while
 * credits remain.
 *
 * - `dashboard`: a banner for admins and instructors. Admins get a link to
 *   buy credits; others are told to ask an admin.
 * - `tutor`: inside the student course tutor drawer, so learners know why it
 *   won't answer.
 */
export default function AiCreditsNotice({ variant }: { variant: 'dashboard' | 'tutor' }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const exhausted = useAiCreditsExhausted(org?.id)
  const { canManageOrg } = useAdminStatus() as any
  if (!exhausted) return null

  if (variant === 'tutor') {
    return (
      <p className="mx-4 mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200">
        {t('ai.credits_out_tutor', {
          defaultValue:
            'Your school has no AI credits left, so the AI tutor will not answer right now. It will work again once your school buys more credits.',
        })}
      </p>
    )
  }

  const buyUrl = getMainDomainUri(`/billing?org=${encodeURIComponent(org?.slug ?? '')}&focus=packs`)
  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 sm:mx-6">
      <Sparkle size={18} weight="fill" className="shrink-0 text-amber-500" />
      <p className="min-w-0 flex-1">
        {t('ai.credits_out_dashboard', {
          defaultValue:
            'Your school has no AI credits left. AI tools (course tutor, quiz and course generation, AI images) will not work for anyone, including students, until you buy credits. Genie, the help assistant, stays free.',
        })}
        {!canManageOrg &&
          ' ' + t('ai.credits_ask_admin', { defaultValue: 'Ask an admin of your school to buy credits.' })}
      </p>
      {canManageOrg && (
        <a
          href={buyUrl}
          className="shrink-0 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800"
        >
          {t('ai.buy_credits', { defaultValue: 'Buy AI credits' })}
        </a>
      )}
    </div>
  )
}
