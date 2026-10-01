'use client'
import React from 'react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { ListChecks, ArrowRight } from '@phosphor-icons/react'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'

/**
 * Compact onboarding progress for the dark dashboard sidebar. Borderless and
 * smooth; the thin line across the TOP doubles as the progress bar. Sits in the
 * search slot and replaces it until setup is complete / dismissed, then the
 * search box returns. The next step stays visible inline (no hover needed).
 */
export default function OnboardingSidebarBox() {
  const { steps, currentStep, allCompleted, dismissed, welcomeSeen } = useOnboarding()
  const { t } = useTranslation()
  const org = useOrg() as any
  const orgSlug = org?.slug || ''

  if (dismissed || !welcomeSeen || allCompleted || !currentStep) return null

  const completedCount = steps.filter((s) => s.completed).length
  const href = getUriWithOrg(orgSlug, '/dash/onboarding')

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="relative"
    >
      <div className="relative">
        {/* Header — uppercase label, count right on the same line */}
        <div className="flex items-center gap-2">
          <ListChecks size={14} weight="bold" className="text-orange-600 shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-orange-600 flex-1 truncate">
            {t('onboarding.box_title', { defaultValue: 'Onboarding' })}
          </span>
          <span className="text-[11px] text-white/35 tabular-nums shrink-0">
            {completedCount}/{steps.length}
          </span>
        </div>

        {/* Up-next step — eyebrow + title */}
        <div className="mt-2.5">
          <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">
            {t('onboarding.up_next', { defaultValue: 'Up next' })}
          </p>
          <p className="mt-0.5 text-[12px] font-medium leading-snug text-white/80 truncate">
            {/* The step definitions in useOnboarding carry English titles as
                their source text; the translations live under
                onboarding.steps.*. Rendering currentStep.title directly showed
                English here in every language. Matches OnboardingSteps.tsx. */}
            {t(`onboarding.steps.${currentStep.id}.title`, { defaultValue: currentStep.title })}
          </p>
        </div>

        {/* CTA button */}
        <Link
          href={href}
          className="group mt-3 flex items-center justify-center gap-1.5 w-full rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-[12px] font-semibold py-2 transition-colors"
        >
          {t('onboarding.continue_setup', { defaultValue: 'Continue setup' })}
          <ArrowRight size={12} weight="bold" className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" data-dir-flip />
        </Link>
      </div>
    </motion.div>
  )
}
