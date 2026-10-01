'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { BarChart3, CalendarPlus, Loader2, PlayCircle, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCourseRights } from '@components/Hooks/useCourseRights'
import { useCourseLiveRecordings, useCourseLiveSessions, useLiveAccessToken } from '@/hooks/queries/useLive'
import { queryKeys } from '@lib/query/keys'
import { getUriWithOrg } from '@services/config/config'
import { createLiveSession, isEndedStatus, type LiveRecording, type LiveSession } from '@services/live/live'
import { cn } from '@/lib/utils'
import InviteDialog from './InviteDialog'
import { formatDuration } from './liveMath'
import LiveBridgeBrand from './LiveBridgeBrand'
import { liveErrorKey } from './liveErrors'

const MAX_UPCOMING = 3
const MAX_RECORDINGS = 4

function defaultStart(): string {
  // Next full hour, formatted for <input type="datetime-local"> in local time.
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ScheduleDialog({
  courseUuid,
  open,
  onOpenChange,
  onCreated,
}: {
  courseUuid: string
  open: boolean
  onOpenChange: (_open: boolean) => void
  /** Called with the new lesson, e.g. to offer invitations straight away. */
  onCreated?: (_session: LiveSession) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const token = useLiveAccessToken()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState(defaultStart)
  const [recordAutomatically, setRecordAutomatically] = useState(false)
  const [publishRecordings, setPublishRecordings] = useState(true)
  const [saving, setSaving] = useState(false)
  const valid = title.trim().length > 0 && !!start

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const created = await createLiveSession(
        {
          course_uuid: courseUuid,
          title: title.trim(),
          description: description.trim() || undefined,
          scheduled_at: new Date(start).toISOString(),
          record_automatically: recordAutomatically,
          publish_recordings: publishRecordings,
        },
        token
      )
      await qc.invalidateQueries({ queryKey: queryKeys.live.courseSessions(courseUuid) })
      qc.invalidateQueries({ queryKey: queryKeys.live.courseOverview(courseUuid) })
      toast.success(t('live.schedule.created'))
      setTitle('')
      setDescription('')
      setStart(defaultStart())
      onOpenChange(false)
      onCreated?.(created)
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setSaving(false)
    }
  }

  const field = 'h-11 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20'
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('live.schedule.title')}</DialogTitle>
          <DialogDescription>{t('live.schedule.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="vb-live-title" className="text-sm font-medium text-neutral-800">
              {t('live.schedule.lesson_title')}
            </label>
            <input id="vb-live-title" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 200))} className={field} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="vb-live-start" className="text-sm font-medium text-neutral-800">
              {t('live.schedule.starts_at')}
            </label>
            <input id="vb-live-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="vb-live-description" className="text-sm font-medium text-neutral-800">
              {t('live.schedule.lesson_description')}
            </label>
            <textarea
              id="vb-live-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 5000))}
              rows={3}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <fieldset className="space-y-2 rounded-lg bg-neutral-50 p-3">
            <legend className="sr-only">{t('live.schedule.recording_legend')}</legend>
            <label className="flex items-start gap-3 text-sm text-neutral-800">
              <input
                type="checkbox"
                checked={recordAutomatically}
                onChange={(e) => setRecordAutomatically(e.target.checked)}
                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
              />
              <span>
                {t('live.schedule.record_automatically')}
                <span className="block text-xs text-neutral-500">{t('live.schedule.record_automatically_hint')}</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-neutral-800">
              <input
                type="checkbox"
                checked={publishRecordings}
                onChange={(e) => setPublishRecordings(e.target.checked)}
                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
              />
              <span>
                {t('live.schedule.publish_recordings')}
                <span className="block text-xs text-neutral-500">{t('live.schedule.publish_recordings_hint')}</span>
              </span>
            </label>
          </fieldset>
        </div>
        <DialogFooter className="gap-2">
          <button type="button" onClick={() => onOpenChange(false)} disabled={saving} className="h-10 rounded-lg px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
            {t('live.common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('live.schedule.submit')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SessionRow({ session, href, onInvite }: { session: LiveSession; href: string; onInvite?: () => void }) {
  const { t } = useTranslation()
  const live = session.status === 'live'
  const when = new Date(session.scheduled_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900">{session.title}</p>
        {live ? (
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-semibold text-red-600">
            <span className="size-1.5 rounded-full bg-red-500" /> {t('live.status.live_now')}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-neutral-500">{when}</p>
        )}
      </div>
      {onInvite && (
        <button
          type="button"
          onClick={onInvite}
          aria-label={t('live.invite.button')}
          title={t('live.invite.button')}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100"
        >
          <UserPlus className="size-4" />
        </button>
      )}
      <Link
        href={href}
        className={
          live
            ? 'inline-flex h-9 shrink-0 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90'
            : 'inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50'
        }
      >
        {t(live ? 'live.course.join_now' : 'live.course.open')}
      </Link>
    </li>
  )
}

function RecordingRow({ recording, orgslug, shortCourse }: { recording: LiveRecording; orgslug: string; shortCourse: string }) {
  const { t } = useTranslation()
  const ready = recording.status === 'ready' && recording.activity_uuid
  const when = recording.started_at
    ? new Date(recording.started_at).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : ''
  return (
    <li className="flex items-center gap-3 py-2.5">
      <PlayCircle className={cn('size-4 shrink-0', ready ? 'text-primary' : 'text-neutral-300')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900">{recording.session_title}</p>
        <p className="text-xs text-neutral-500">
          {when}
          {recording.duration_seconds ? ` · ${formatDuration(recording.duration_seconds)}` : ''}
          {ready && recording.published === false && ` · ${t('live.recording.draft')}`}
        </p>
      </div>
      {ready ? (
        <Link
          href={getUriWithOrg(orgslug, `/course/${shortCourse}/activity/${recording.activity_uuid!.replace(/^activity_/, '')}`)}
          className="inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50"
        >
          {t('live.recording.watch')}
        </Link>
      ) : (
        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
          {t(`live.recording.state_${recording.status}`)}
        </span>
      )}
    </li>
  )
}

/** Course page entry point: Course → Live lesson → LiveBridge classroom. */
export default function CourseLiveSessions({ courseUuid, orgslug }: { courseUuid: string; orgslug: string }) {
  const { t } = useTranslation()
  const { data: sessions, isError } = useCourseLiveSessions(courseUuid)
  const { data: recordings = [] } = useCourseLiveRecordings(courseUuid)
  const { hasPermission } = useCourseRights(courseUuid)
  const canSchedule = hasPermission('update')
  const [scheduling, setScheduling] = useState(false)
  const [inviting, setInviting] = useState<LiveSession | null>(null)

  if (isError || !sessions) return null
  const active = sessions
    .filter((s) => !isEndedStatus(s.status))
    .sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live') || a.scheduled_at.localeCompare(b.scheduled_at))
  const visible = active.slice(0, MAX_UPCOMING)
  // Learners only ever receive ready + published recordings from the API.
  const shownRecordings = recordings.slice(0, MAX_RECORDINGS)
  if (visible.length === 0 && shownRecordings.length === 0 && !canSchedule) return null

  const shortCourse = courseUuid.replace(/^course_/, '')
  const hrefFor = (s: LiveSession) =>
    getUriWithOrg(orgslug, `/course/${shortCourse}/live/${s.session_uuid.replace(/^livesession_/, '')}`)

  return (
    <div className="overflow-hidden rounded-lg bg-white p-4 shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40">
      <div className="flex items-center justify-between gap-2">
        <LiveBridgeBrand className="text-sm" />
        {canSchedule && (
          <button
            type="button"
            onClick={() => setScheduling(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            <CalendarPlus className="size-4" /> {t('live.course.schedule')}
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-neutral-500">{t('live.course.empty_staff')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-neutral-100">
          {visible.map((s) => (
            <SessionRow key={s.session_uuid} session={s} href={hrefFor(s)} onInvite={canSchedule ? () => setInviting(s) : undefined} />
          ))}
        </ul>
      )}
      {shownRecordings.length > 0 && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{t('live.recording.past_lessons')}</p>
          <ul className="mt-1 divide-y divide-neutral-100">
            {shownRecordings.map((r) => (
              <RecordingRow key={r.recording_uuid} recording={r} orgslug={orgslug} shortCourse={shortCourse} />
            ))}
          </ul>
        </div>
      )}
      {canSchedule && (
        <Link
          href={getUriWithOrg(orgslug, `/dash/courses/course/${shortCourse}/live`)}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <BarChart3 className="size-3.5" /> {t('live.course.analytics_link')}
        </Link>
      )}
      {canSchedule && (
        <ScheduleDialog courseUuid={courseUuid} open={scheduling} onOpenChange={setScheduling} onCreated={setInviting} />
      )}
      {canSchedule && inviting && (
        <InviteDialog
          session={inviting}
          courseUuid={courseUuid}
          orgslug={orgslug}
          open
          onOpenChange={(next) => !next && setInviting(null)}
        />
      )}
    </div>
  )
}
