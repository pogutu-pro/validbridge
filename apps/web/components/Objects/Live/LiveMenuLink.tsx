'use client'

import Link from 'next/link'
import { Broadcast } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useMyLiveLessons } from '@/hooks/queries/useLive'
import { getUriWithOrg } from '@services/config/config'

/** Mobile menu entry to the learner's live lessons, flagged while one is live. */
export default function LiveMenuLink({ orgslug, onNavigate }: { orgslug: string; onNavigate?: () => void }) {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const org = useOrg() as any
  const { data } = useMyLiveLessons(org?.id)
  if (session?.status !== 'authenticated') return null
  const liveNow = !!data?.sessions.some((s) => s.status === 'live')
  return (
    <Link
      href={getUriWithOrg(orgslug, '/live')}
      onClick={onNavigate}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white font-semibold text-neutral-800 shadow-sm"
    >
      <Broadcast size={20} weight="fill" className="text-primary" />
      {t('live.my.title')}
      {liveNow && (
        <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white">
          {t('live.status.live')}
        </span>
      )}
    </Link>
  )
}
