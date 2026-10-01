'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Video, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useMyLiveLessons } from '@/hooks/queries/useLive'
import { getUriWithOrg } from '@services/config/config'
import { liveClassroomPath } from '@services/live/live'

const DISMISS_KEY = 'vb-live-banner-dismissed'

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]')
  } catch {
    return []
  }
}

/** Site-wide nudge while one of the user's lessons is live — like a meeting
 * "join now" toast. Dismissible per lesson for the browser session. */
export default function LiveNowBanner({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const pathname = usePathname() || ''
  const { data } = useMyLiveLessons(org?.id)
  const [dismissed, setDismissed] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readDismissed()))

  const live = data?.sessions.find((s) => s.status === 'live' && !dismissed.includes(s.session_uuid))
  if (!live || pathname.includes('/live')) return null

  const dismiss = () => {
    const next = [...dismissed, live.session_uuid]
    setDismissed(next)
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-4 mx-auto flex max-w-lg items-center gap-3 rounded-2xl bg-neutral-900 p-3 ps-4 text-white shadow-2xl sm:inset-x-auto sm:end-6 sm:bottom-6"
      style={{ zIndex: 'var(--z-overlay)' }}
    >
      <span className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{live.title}</p>
        <p className="truncate text-xs text-white/60">{t('live.my.banner', { course: live.course_name })}</p>
      </div>
      <Link
        href={getUriWithOrg(orgslug, liveClassroomPath(live.course_uuid, live.session_uuid))}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
      >
        <Video className="size-4" /> {t('live.course.join_now')}
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('live.my.dismiss')}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
