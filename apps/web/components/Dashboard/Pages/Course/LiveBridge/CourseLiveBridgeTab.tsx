'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  BarChart3,
  CalendarPlus,
  CircleHelp,
  Clock,
  GraduationCap,
  PlayCircle,
  Radio,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { StatCard } from '@/components/ui/stat-card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  useCourseLiveRecordings,
  useLiveCourseOverview,
  useLiveLearnerEngagement,
  useLiveSessionReport,
} from '@/hooks/queries/useLive'
import { getUriWithOrg } from '@services/config/config'
import type {
  AttendanceStatus,
  LiveRecording,
  LiveSession,
  LiveSessionReport,
} from '@services/live/live'
import { ScheduleDialog } from '@components/Objects/Live/CourseLiveSessions'
import InviteDialog from '@components/Objects/Live/InviteDialog'
import { formatDuration } from '@components/Objects/Live/liveMath'

const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? '–' : `${Math.round(value)}%`
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '–'

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-neutral-100 text-neutral-600',
  ready: 'bg-amber-50 text-amber-700',
  live: 'bg-red-50 text-red-600',
  ended: 'bg-neutral-100 text-neutral-600',
  processing: 'bg-blue-50 text-blue-700',
  completed: 'bg-emerald-50 text-emerald-700',
}

const ATTENDANCE_STYLES: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-50 text-emerald-700',
  late: 'bg-amber-50 text-amber-700',
  left_early: 'bg-amber-50 text-amber-700',
  partial: 'bg-orange-50 text-orange-700',
  absent: 'bg-neutral-100 text-neutral-500',
}

function Pill({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
        className
      )}
    >
      {children}
    </span>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-neutral-500">{text}</p>
}

// ---------------------------------------------------------------------------
// Session report (drill-down)
// ---------------------------------------------------------------------------

function RecordingLinks({
  recordings,
  orgslug,
  shortCourse,
}: {
  recordings: LiveRecording[]
  orgslug: string
  shortCourse: string
}) {
  const { t } = useTranslation()
  if (!recordings.length)
    return <Empty text={t('live.dashboard.no_recordings')} />
  return (
    <ul className="divide-y divide-neutral-100">
      {recordings.map((r) => (
        <li key={r.recording_uuid} className="flex items-center gap-3 py-2">
          <PlayCircle className="size-4 text-neutral-400" aria-hidden />
          <span className="flex-1 text-sm text-neutral-800">
            {when(r.started_at)}
            {r.duration_seconds
              ? ` · ${formatDuration(r.duration_seconds)}`
              : ''}
          </span>
          {r.status === 'ready' && r.activity_uuid ? (
            <Link
              className="text-xs font-medium text-primary hover:underline"
              href={getUriWithOrg(
                orgslug,
                `/course/${shortCourse}/activity/${r.activity_uuid.replace(/^activity_/, '')}`
              )}
            >
              {t(
                r.published
                  ? 'live.recording.watch'
                  : 'live.dashboard.review_draft'
              )}
            </Link>
          ) : (
            <Pill
              className={
                r.status === 'failed'
                  ? 'bg-red-50 text-red-600'
                  : 'bg-neutral-100 text-neutral-600'
              }
            >
              {t(`live.recording.state_${r.status}`)}
            </Pill>
          )}
        </li>
      ))}
    </ul>
  )
}

function SessionReportView({
  report,
  orgslug,
  shortCourse,
}: {
  report: LiveSessionReport
  orgslug: string
  shortCourse: string
}) {
  const { t } = useTranslation()
  const p = report.participation
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Users />}
          label={t('live.dashboard.attendees')}
          value={`${report.attendees} / ${report.enrolled}`}
          hint={t('live.dashboard.rate', {
            value: pct(report.attendance_rate),
          })}
        />
        <StatCard
          icon={<Clock />}
          tone="blue"
          label={t('live.dashboard.avg_attendance')}
          value={pct(report.average_attendance_percent)}
          hint={
            report.average_duration_seconds !== null
              ? t('live.dashboard.avg_duration', {
                  value: formatDuration(report.average_duration_seconds),
                })
              : undefined
          }
        />
        <StatCard
          icon={<UserCheck />}
          tone="amber"
          label={t('live.dashboard.late_early')}
          value={`${report.late_arrivals} / ${report.early_departures}`}
          hint={t('live.dashboard.partial_absent', {
            partial: report.partial,
            absent: report.absent,
          })}
        />
        <StatCard
          icon={<CircleHelp />}
          tone="green"
          label={t('live.dashboard.participation')}
          value={pct(report.participation_rate)}
          hint={t('live.dashboard.participating', {
            count: report.participating_learners,
          })}
        />
      </div>
      <p className="text-xs text-neutral-500">
        {t('live.dashboard.participation_breakdown', {
          messages: p.messages,
          questions: p.questions,
          answered: report.questions_answered,
          votes: p.poll_votes,
          answers: p.quiz_answers,
          hands: p.hand_raises,
        })}
        {report.duration_seconds !== null &&
          ` · ${t('live.dashboard.lesson_length', { value: formatDuration(report.duration_seconds) })}`}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('live.dashboard.polls')}>
          {report.polls.length === 0 ? (
            <Empty text={t('live.dashboard.no_polls')} />
          ) : (
            <ul className="space-y-4">
              {report.polls.map((poll) => (
                <li key={poll.poll_uuid}>
                  <p className="text-sm font-medium text-neutral-900">
                    {poll.question}
                  </p>
                  <p className="mb-2 text-xs text-neutral-500">
                    {t('live.dashboard.poll_votes', {
                      count: poll.total_votes,
                      rate: pct(poll.response_rate),
                    })}
                  </p>
                  {poll.options.map((option, i) => {
                    const share = poll.total_votes
                      ? (poll.counts[i] / poll.total_votes) * 100
                      : 0
                    return (
                      <div
                        key={i}
                        className="relative isolate mb-1 overflow-hidden rounded-md border border-neutral-200 px-2 py-1 text-xs"
                      >
                        <span
                          className="absolute inset-y-0 start-0 -z-10 bg-primary/10"
                          style={{ width: `${share}%` }}
                          aria-hidden
                        />
                        <span className="flex justify-between gap-2">
                          <span>{option}</span>
                          <span className="font-semibold">
                            {poll.counts[i]}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t('live.dashboard.quizzes')}>
          {report.quizzes.length === 0 ? (
            <Empty text={t('live.dashboard.no_quizzes')} />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {report.quizzes.map((quiz) => (
                <li key={quiz.quiz_uuid} className="py-2">
                  <p className="text-sm font-medium text-neutral-900">
                    {quiz.title}
                  </p>
                  <p className="text-xs text-neutral-600">
                    {t('live.quiz.summary', {
                      count: quiz.participants,
                      correct: quiz.correct,
                      incorrect: quiz.incorrect,
                      average: quiz.average_percent ?? 0,
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title={t('live.dashboard.recordings')}>
        <RecordingLinks
          recordings={report.recordings}
          orgslug={orgslug}
          shortCourse={shortCourse}
        />
      </Section>

      <Section title={t('live.dashboard.learners')}>
        {report.learners.length === 0 ? (
          <Empty text={t('live.attendance.empty')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('live.dashboard.col_learner')}</TableHead>
                <TableHead>{t('live.dashboard.col_status')}</TableHead>
                <TableHead className="text-end">
                  {t('live.dashboard.col_attended')}
                </TableHead>
                <TableHead className="text-end">
                  {t('live.dashboard.col_late')}
                </TableHead>
                <TableHead className="text-end">
                  {t('live.dashboard.col_participation')}
                </TableHead>
                <TableHead className="text-end">
                  {t('live.dashboard.col_quiz')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.learners.map((l) => {
                const total =
                  l.participation.messages +
                  l.participation.questions +
                  l.participation.poll_votes +
                  l.participation.quiz_answers +
                  l.participation.hand_raises
                return (
                  <TableRow key={l.user_uuid}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell>
                      <Pill className={ATTENDANCE_STYLES[l.attendance_status]}>
                        {t(`live.attendance.status_${l.attendance_status}`)}
                      </Pill>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {pct(l.attendance_percent)} ·{' '}
                      {formatDuration(l.duration_seconds)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {l.late_by_seconds > 60
                        ? formatDuration(l.late_by_seconds)
                        : '–'}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {total}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {pct(l.quiz_percent)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  )
}

function SessionReportPanel({
  sessionUuid,
  orgslug,
  shortCourse,
  onBack,
}: {
  sessionUuid: string
  orgslug: string
  shortCourse: string
  onBack: () => void
}) {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useLiveSessionReport(sessionUuid)
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900"
      >
        <ArrowLeft className="size-4" /> {t('live.dashboard.all_sessions')}
      </button>
      {isLoading ? (
        <Empty text={t('live.states.preparing')} />
      ) : isError || !data ? (
        <Empty text={t('live.errors.generic')} />
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              {data.session.title}
            </h2>
            <p className="text-sm text-neutral-500">
              {when(data.session.started_at ?? data.session.scheduled_at)} ·{' '}
              <Pill className={STATUS_STYLES[data.session.status]}>
                {t(`live.dashboard.status_${data.session.status}`)}
              </Pill>
            </p>
          </div>
          <SessionReportView
            report={data}
            orgslug={orgslug}
            shortCourse={shortCourse}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview + learners
// ---------------------------------------------------------------------------

type InviteTarget = Pick<
  LiveSession,
  'session_uuid' | 'title' | 'scheduled_at' | 'status'
>

function Overview({
  courseUuid,
  orgslug,
  shortCourse,
  onOpen,
  onInvite,
}: {
  courseUuid: string
  orgslug: string
  shortCourse: string
  onOpen: (_uuid: string) => void
  onInvite: (_session: InviteTarget) => void
}) {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useLiveCourseOverview(courseUuid)
  const { data: recordings = [] } = useCourseLiveRecordings(courseUuid)
  if (isLoading) return <Empty text={t('live.states.preparing')} />
  if (isError || !data) return <Empty text={t('live.errors.generic')} />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Radio />}
          label={t('live.dashboard.sessions')}
          value={data.sessions_held}
          hint={t('live.dashboard.upcoming', { count: data.sessions_upcoming })}
        />
        <StatCard
          icon={<Users />}
          tone="blue"
          label={t('live.dashboard.avg_attendance_rate')}
          value={pct(data.average_attendance_rate)}
          hint={t('live.dashboard.enrolled', { count: data.enrolled })}
        />
        <StatCard
          icon={<Clock />}
          tone="amber"
          label={t('live.dashboard.avg_attendance')}
          value={pct(data.average_attendance_percent)}
          hint={t('live.dashboard.late_early_hint', {
            late: data.late_arrivals,
            early: data.early_departures,
          })}
        />
        <StatCard
          icon={<GraduationCap />}
          tone="green"
          label={t('live.dashboard.live_quiz_avg')}
          value={pct(data.live_quiz_average_percent)}
          hint={t('live.dashboard.engagement_hint', {
            questions: data.total_questions,
            votes: data.total_poll_votes,
          })}
        />
      </div>
      <Section title={t('live.dashboard.sessions')}>
        {data.sessions.length === 0 ? (
          <Empty text={t('live.course.empty_staff')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('live.dashboard.col_lesson')}</TableHead>
                <TableHead>{t('live.dashboard.col_status')}</TableHead>
                <TableHead className="text-end">
                  {t('live.dashboard.col_attendees')}
                </TableHead>
                <TableHead className="text-end">
                  {t('live.dashboard.col_attended')}
                </TableHead>
                <TableHead className="text-end">
                  {t('live.dashboard.col_questions')}
                </TableHead>
                <TableHead className="text-end">
                  {t('live.dashboard.col_quiz')}
                </TableHead>
                <TableHead>{t('live.dashboard.col_recording')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sessions.map((s) => {
                const joinable =
                  s.status === 'scheduled' ||
                  s.status === 'ready' ||
                  s.status === 'live'
                return (
                  <TableRow key={s.session_uuid}>
                    <TableCell>
                      <p className="font-medium text-neutral-900">{s.title}</p>
                      <p className="text-xs text-neutral-500">
                        {when(s.started_at ?? s.scheduled_at)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Pill className={STATUS_STYLES[s.status]}>
                        {t(`live.dashboard.status_${s.status}`)}
                      </Pill>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {s.attendees}
                      {s.attendance_rate !== null && (
                        <span className="text-neutral-400">
                          {' '}
                          · {pct(s.attendance_rate)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {pct(s.average_attendance_percent)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {s.questions}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {pct(s.quiz_average_percent)}
                    </TableCell>
                    <TableCell className="text-xs text-neutral-600">
                      {s.recording_status === 'none'
                        ? '–'
                        : t(`live.dashboard.recording_${s.recording_status}`)}
                    </TableCell>
                    <TableCell className="text-end">
                      {joinable ? (
                        <span className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => onInvite(s)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-primary"
                          >
                            <UserPlus className="size-3.5" />{' '}
                            {t('live.invite.button')}
                          </button>
                          <Link
                            href={getUriWithOrg(
                              orgslug,
                              `/course/${shortCourse}/live/${s.session_uuid.replace(/^livesession_/, '')}`
                            )}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            {t('live.dashboard.open_classroom')}
                          </Link>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpen(s.session_uuid)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          {t('live.dashboard.view_report')}
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section title={t('live.dashboard.recordings')}>
        <RecordingLinks
          recordings={recordings}
          orgslug={orgslug}
          shortCourse={shortCourse}
        />
      </Section>
    </div>
  )
}

function Learners({ courseUuid }: { courseUuid: string }) {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useLiveLearnerEngagement(courseUuid)
  if (isLoading) return <Empty text={t('live.states.preparing')} />
  if (isError || !data) return <Empty text={t('live.errors.generic')} />
  return (
    <Section title={t('live.dashboard.engagement_title')}>
      <p className="mb-3 text-xs text-neutral-500">
        {t('live.dashboard.engagement_description')}
      </p>
      {data.length === 0 ? (
        <Empty text={t('live.dashboard.no_learners')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('live.dashboard.col_learner')}</TableHead>
              <TableHead className="text-end">
                {t('live.dashboard.col_progress')}
              </TableHead>
              <TableHead className="text-end">
                {t('live.dashboard.col_assignments')}
              </TableHead>
              <TableHead className="text-end">
                {t('live.dashboard.col_quizzes')}
              </TableHead>
              <TableHead className="text-end">
                {t('live.dashboard.col_live_attendance')}
              </TableHead>
              <TableHead className="text-end">
                {t('live.dashboard.col_participation')}
              </TableHead>
              <TableHead className="text-end">
                {t('live.dashboard.col_last_active')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((l) => (
              <TableRow key={l.user_uuid}>
                <TableCell>
                  <p className="font-medium text-neutral-900">{l.name}</p>
                  <p className="text-xs text-neutral-500">@{l.username}</p>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {pct(l.progress_percent)}
                  <span className="block text-[11px] text-neutral-400">
                    {l.activities_completed}/{l.activities_total}
                  </span>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {pct(l.assignment_average_percent)}
                  <span className="block text-[11px] text-neutral-400">
                    {l.assignments_submitted}/{l.assignments_total}
                  </span>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {pct(l.quiz_average_percent)}
                  <span className="block text-[11px] text-neutral-400">
                    {t('live.dashboard.live_short', {
                      value: pct(l.live_quiz_average_percent),
                    })}
                  </span>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {l.live_sessions_attended}/{l.live_sessions_held}
                  <span className="block text-[11px] text-neutral-400">
                    {pct(l.live_average_attendance_percent)}
                  </span>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {l.live_participation}
                </TableCell>
                <TableCell className="text-end text-xs text-neutral-600">
                  {l.last_active_on
                    ? new Date(l.last_active_on).toLocaleDateString()
                    : '–'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  )
}

/** Course dashboard → LiveBridge: sessions, recordings, reports, engagement. */
export default function CourseLiveBridgeTab({
  courseUuid,
  orgslug,
}: {
  courseUuid: string
  orgslug: string
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const selected = searchParams.get('session')
  const [scheduling, setScheduling] = useState(false)
  const [inviting, setInviting] = useState<InviteTarget | null>(null)
  const shortCourse = courseUuid.replace(/^course_/, '')
  const base = getUriWithOrg(
    orgslug,
    `/dash/courses/course/${shortCourse}/live`
  )
  const open = (uuid: string | null) =>
    router.push(uuid ? `${base}?session=${encodeURIComponent(uuid)}` : base)

  return (
    <div className="space-y-4 p-4 sm:p-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
            <BarChart3 className="size-5 text-primary" aria-hidden /> LiveBridge
          </h2>
          <p className="text-sm text-neutral-500">
            {t('live.dashboard.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setScheduling(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <CalendarPlus className="size-4" /> {t('live.schedule.title')}
        </button>
      </div>
      {selected ? (
        <SessionReportPanel
          sessionUuid={selected}
          orgslug={orgslug}
          shortCourse={shortCourse}
          onBack={() => open(null)}
        />
      ) : (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">
              {t('live.dashboard.tab_overview')}
            </TabsTrigger>
            <TabsTrigger value="learners">
              {t('live.dashboard.tab_learners')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <Overview
              courseUuid={courseUuid}
              orgslug={orgslug}
              shortCourse={shortCourse}
              onOpen={open}
              onInvite={setInviting}
            />
          </TabsContent>
          <TabsContent value="learners" className="mt-4">
            <Learners courseUuid={courseUuid} />
          </TabsContent>
        </Tabs>
      )}
      <ScheduleDialog
        courseUuid={courseUuid}
        open={scheduling}
        onOpenChange={setScheduling}
        onCreated={setInviting}
      />
      {inviting && (
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
