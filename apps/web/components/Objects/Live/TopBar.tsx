'use client'

import { useEffect, useState } from 'react'
import { useParticipants } from '@livekit/components-react'
import { Settings, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useClassroom } from './ClassroomContext'
import DeviceSettingsDialog from './DeviceSettingsDialog'
import LiveBridgeBrand from './LiveBridgeBrand'
import { useRoomMeta } from './roomMetadata'

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const total = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000))
  const h = Math.floor(total / 3600)
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return <span className="tabular-nums">{h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`}</span>
}

export default function TopBar() {
  const { t } = useTranslation()
  const { classroom, isDesktop, openPanel } = useClassroom()
  const participants = useParticipants()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { session } = classroom
  const live = session.status === 'live'
  const { recording } = useRoomMeta()

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-3 text-white sm:px-5">
      <LiveBridgeBrand compact={!isDesktop} className="text-white" />
      <span className="hidden h-6 w-px bg-white/20 lg:block" aria-hidden />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold sm:text-base">{session.title}</h1>
        <p className="truncate text-xs text-white/55">{classroom.course_name}</p>
      </div>
      {recording && (
        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white"
          title={t('live.recording.indicator_hint')}
        >
          <span className="size-2 animate-pulse rounded-full bg-red-500" aria-hidden />
          {t('live.recording.indicator')}
        </span>
      )}
      {live ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-red-500" />
          </span>
          {t('live.status.live')}
          {session.started_at && <Elapsed since={session.started_at} />}
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
          {t('live.status.not_live_yet')}
        </span>
      )}
      <button
        type="button"
        onClick={() => openPanel('people')}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-white/80 hover:bg-white/10 lg:hidden"
        aria-label={t('live.participants.count', { count: participants.length })}
      >
        <Users className="size-4" aria-hidden />
        <span className="tabular-nums">{participants.length}</span>
      </button>
      {!isDesktop && (
        <>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('live.controls.settings')}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
          >
            <Settings className="size-5" />
          </button>
          <DeviceSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </>
      )}
    </header>
  )
}
