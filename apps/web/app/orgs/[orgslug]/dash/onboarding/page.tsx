'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ListChecks, CheckCircle } from '@phosphor-icons/react'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import OnboardingSteps from '@components/Dashboard/Onboarding/OnboardingSteps'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getPublicEdApplication } from '@services/organizations/orgs'

/** Status of the org's Public Education application, if any. */
function PublicEdBanner({ orgId, token }: { orgId?: number; token?: string }) {
  const [app, setApp] = useState<{ status: string } | null>(null)
  useEffect(() => {
    if (!orgId || !token) return
    getPublicEdApplication(orgId, token).then(setApp).catch(() => setApp(null))
  }, [orgId, token])
  if (!app) return null
  const copy: Record<string, string> = {
    pending: 'Your Public Education application is being reviewed. You can use ValidBridge fully while we check your details.',
    approved: 'Public Education approved. Your school is on the free Public Education plan.',
    rejected: 'We could not verify your Public Education application. Contact support@validbridge.co.ke to try again.',
  }
  return (
    <div className="mx-auto w-full max-w-3xl rounded-2xl bg-[#FFF3EC] px-5 py-4 text-sm font-medium text-[#B23907] ring-1 ring-[#FFE3D3]">
      {copy[app.status] ?? copy.pending}
    </div>
  )
}

export default function OnboardingPage() {
  const { t } = useTranslation()
  const { steps, progress, allCompleted } = useOnboarding()
  const org = useOrg() as any
  const session = useVBSession() as any
  const orgSlug = org?.slug || ''
  const completedCount = steps.filter((s) => s.completed).length
  const dashHref = getUriWithOrg(orgSlug, '/dash')

  return (
    <div className="flex w-full">
      <div className="w-full px-4 sm:px-10 tracking-tighter flex flex-col space-y-6 pb-16">
        {/* Header — inspired by the sidebar onboarding box, in light mode:
            orange label, blueprint-grid pattern, neon orange progress. */}
        <div className="relative overflow-hidden -mx-4 sm:-mx-10 px-4 sm:px-10 pt-6 pb-1">
          {/* Blueprint grid — orange, fading down */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(rgba(249,115,22,0.07) 1px, transparent 1px),
                linear-gradient(90deg, rgba(249,115,22,0.07) 1px, transparent 1px),
                linear-gradient(rgba(249,115,22,0.035) 1px, transparent 1px),
                linear-gradient(90deg, rgba(249,115,22,0.035) 1px, transparent 1px)`,
              backgroundSize: '60px 60px, 60px 60px, 15px 15px, 15px 15px',
              maskImage: 'linear-gradient(to bottom, black 0%, transparent 88%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 88%)',
            }}
          />
          {/* Orange glow blooming from the top */}
          <div
            className="absolute inset-x-0 top-0 h-28 pointer-events-none"
            style={{
              background: 'radial-gradient(70% 100% at 28% 0%, rgba(249,115,22,0.13), transparent 70%)',
            }}
          />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
            {/* Left — eyebrow + title */}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <ListChecks size={15} weight="bold" className="text-orange-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-orange-500">
                  {t('onboarding.box_title', { defaultValue: 'Onboarding' })}
                </span>
              </div>
              <h1 className="mt-2.5 font-bold text-4xl tracking-tight">
                {t('onboarding.getting_started')}
              </h1>
            </div>

            {/* Right — compact neon progress */}
            <div className="w-full sm:w-72 shrink-0 sm:pb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-700">
                  {completedCount}/{steps.length} {t('onboarding.steps_done', { defaultValue: 'steps done' })}
                </span>
                <span className="text-sm font-medium text-gray-400 tabular-nums">
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div className="h-1.5 bg-orange-100/70 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progress * 100}%`,
                    background: 'linear-gradient(90deg, #f97316 0%, #f97316 55%, #f97316 100%)',
                    boxShadow: '0 0 8px rgba(249,115,22,0.55), 0 0 2px rgba(249,115,22,0.8)',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* All-done */}
        {allCompleted && (
          <div className="w-full max-w-3xl mx-auto flex items-center gap-3 p-5 rounded-xl bg-white nice-shadow">
            <CheckCircle size={28} weight="duotone" className="text-[#FF5A1F] shrink-0" />
            <div className="flex-1">
              <p className="text-base font-semibold text-gray-900">
                {t('onboarding.all_set', { defaultValue: "You're all set" })}
              </p>
              <p className="text-sm text-gray-400">
                {t('onboarding.all_set_desc', { defaultValue: 'Setup complete.' })}
              </p>
            </div>
            <Link
              href={dashHref}
              className="shrink-0 px-4 py-2 text-sm font-semibold text-white bg-black rounded-lg hover:bg-gray-800 transition-colors"
            >
              {t('onboarding.back_to_dashboard', { defaultValue: 'Back to dashboard' })}
            </Link>
          </div>
        )}

        <PublicEdBanner orgId={org?.id} token={session?.data?.tokens?.access_token} />

        {/* Steps, centered */}
        <div className="w-full max-w-3xl mx-auto">
          <OnboardingSteps />
        </div>
      </div>
    </div>
  )
}
