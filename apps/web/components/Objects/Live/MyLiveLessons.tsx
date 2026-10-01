'use client'

import Link from 'next/link'
import { ArrowRight, CalendarClock, PlayCircle, Radio, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useOrg } from '@components/Contexts/OrgContext'
import { useMyLiveLessons } from '@/hooks/queries/useLive'
import { getUriWithOrg } from '@services/config/config'
import { liveClassroomPath, type LiveMyLessons } from '@services/live/live'
import { formatDuration } from './liveMath'

type Session = LiveMyLessons['sessions'][number]

/** "in 3 hours", "tomorrow", … — relative to now, in the user's language. */
export function relativeStart(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const minutes = Math.round(diff / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}

function DateBlock({ iso }: { iso: string }) {
  const d = new Date(iso)
  return (
    <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary">
      <span className="text-[10px] font-semibold uppercase leading-none">{d.toLocaleDateString([], { month: 'short' })}</span>
      <span className="text-lg font-bold leading-tight">{d.getDate()}</span>
    </div>
  )
}

function LiveNowCard({ session, orgslug }: { session: Session; orgslug: string }) {
  const { t } = useTranslation()
  return (
    <div className="relative overflow-hidden rounded-2xl bg-neutral-900 p-5 text-white shadow-lg sm:p-6">
      <div className="absolute -end-10 -top-10 size-40 rounded-full bg-primary/30 blur-3xl" aria-hidden />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
            {t('live.status.live_now')}
          </span>
          <h3 className="mt-3 truncate text-lg font-semibold sm:text-xl">{session.title}</h3>
          <p className="truncate text-sm text-white/60">{session.course_name}</p>
        </div>
        <Link
          href={getUriWithOrg(orgslug, liveClassroomPath(session.course_uuid, session.session_uuid))}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md transition hover:bg-primary/90"
        >
          <Video className="size-4" /> {t(session.is_staff ? 'live.my.enter' : 'live.course.join_now')}
        </Link>
      </div>
    </div>
  )
}

function UpcomingRow({ session, orgslug }: { session: Session; orgslug: string }) {
  const { t } = useTranslation()
  const time = new Date(session.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <li>
      <Link
        href={getUriWithOrg(orgslug, liveClassroomPath(session.course_uuid, session.session_uuid))}
        className="group flex items-center gap-3 rounded-xl p-2.5 transition hover:bg-neutral-50"
      >
        <DateBlock iso={session.scheduled_at} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">{session.title}</p>
          <p className="truncate text-xs text-neutral-500">
            {session.course_name} · {time} · {session.status === 'ready' ? t('live.my.starting') : relativeStart(session.scheduled_at)}
          </p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-primary rtl:rotate-180" />
      </Link>
    </li>
  )
}

/**
 * The learner's live lessons across every course they take (or teach):
 * live now, upcoming, and recordings to catch up on.
 */
export default function MyLiveLessons({ orgslug, variant = 'full' }: { orgslug: string; variant?: 'full' | 'compact' }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { data, isLoading } = useMyLiveLessons(org?.id)

  if (isLoading || !data) {
    return variant === 'full' ? <div className="h-40 animate-pulse rounded-2xl bg-neutral-100" /> : null
  }

  const live = data.sessions.filter((s) => s.status === 'live')
  const upcoming = data.sessions.filter((s) => s.status !== 'live')
  const compact = variant === 'compact'
  const shownUpcoming = compact ? upcoming.slice(0, 3) : upcoming
  const shownRecordings = compact ? data.recordings.slice(0, 3) : data.recordings
  const nothing = live.length === 0 && upcoming.length === 0 && data.recordings.length === 0

  // On the learning dashboard stay out of the way until there is something to show.
  if (compact && nothing) return null

  return (
    <section className="space-y-4" aria-label={t('live.my.title')}>
      {compact && (
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
            <Radio className="size-4 text-primary" aria-hidden /> {t('live.my.title')}
          </h2>
          <Link href={getUriWithOrg(orgslug, '/live')} className="text-sm font-medium text-primary hover:underline">
            {t('live.my.see_all')}
          </Link>
        </div>
      )}

      {live.map((s) => (
        <LiveNowCard key={s.session_uuid} session={s} orgslug={orgslug} />
      ))}

      {nothing ? (
        <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-neutral-200 bg-white/60 px-6 py-14 text-center">
          <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Radio className="size-6" />
          </span>
          <h3 className="text-lg font-semibold text-neutral-800">{t('live.my.empty_title')}</h3>
          <p className="mt-1 max-w-sm text-sm text-neutral-500">{t('live.my.empty_description')}</p>
        </div>
      ) : (
        <div className={cn('grid gap-4', !compact && shownUpcoming.length > 0 && shownRecordings.length > 0 && 'lg:grid-cols-2')}>
          {shownUpcoming.length > 0 && (
            <div className="rounded-2xl bg-white p-4 nice-shadow">
              <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-neutral-900">
                <CalendarClock className="size-4 text-neutral-400" aria-hidden /> {t('live.my.upcoming')}
              </h3>
              <ul className="divide-y divide-neutral-100">
                {shownUpcoming.map((s) => (
                  <UpcomingRow key={s.session_uuid} session={s} orgslug={orgslug} />
                ))}
              </ul>
            </div>
          )}
          {shownRecordings.length > 0 && (
            <div className="rounded-2xl bg-white p-4 nice-shadow">
              <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-neutral-900">
                <PlayCircle className="size-4 text-neutral-400" aria-hidden /> {t('live.my.catch_up')}
              </h3>
              <ul className="divide-y divide-neutral-100">
                {shownRecordings.map((r) => (
                  <li key={r.recording_uuid}>
                    <Link
                      href={getUriWithOrg(
                        orgslug,
                        `/course/${r.course_uuid.replace(/^course_/, '')}/activity/${r.activity_uuid.replace(/^activity_/, '')}`
                      )}
                      className="group flex items-center gap-3 rounded-xl p-2.5 transition hover:bg-neutral-50"
                    >
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
                        <PlayCircle className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-neutral-900">{r.session_title}</p>
                        <p className="truncate text-xs text-neutral-500">
                          {r.course_name}
                          {r.duration_seconds ? ` · ${formatDuration(r.duration_seconds)}` : ''}
                        </p>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-primary rtl:rotate-180" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
