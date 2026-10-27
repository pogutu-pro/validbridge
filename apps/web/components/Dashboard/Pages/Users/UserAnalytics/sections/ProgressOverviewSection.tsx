'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react'
import { fmtDate, fullName } from '../format'
import { Card, SectionTitle, ProgressBar, StatusBadge, Empty, P } from './primitives'

// Quiet for this long and a student is flagged; below this live attendance is flagged.
const INACTIVE_DAYS = 14
const LOW_ATTENDANCE_PERCENT = 60
const LATEST_GRADES = 5

function daysSince(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const t = new Date(dateStr).getTime()
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86_400_000)
}

/** Everything about how one student is doing, in one place, built from the dossier. */
export default function ProgressOverviewSection({ dossier }: { dossier: any }) {
  const { t } = useTranslation()
  const summary = dossier?.summary || {}
  const courses: any[] = dossier?.courses || []
  const assignments: any[] = dossier?.assignments || []
  const certificates: any[] = dossier?.certificates || []
  const name = fullName(dossier?.user)

  const enrolled = summary.courses_enrolled ?? courses.length
  const completed = summary.courses_completed ?? 0
  const avgProgress = summary.avg_progress_pct ?? 0

  // Things worth a teacher's attention, each one derived from data we hold.
  const attention: string[] = []
  const quietDays = daysSince(summary.last_connection)
  if (summary.last_connection == null) {
    attention.push(t(`${P}.progress.never_signed_in`, { defaultValue: 'Has not signed in yet.' }))
  } else if (quietDays != null && quietDays >= INACTIVE_DAYS) {
    attention.push(t(`${P}.progress.inactive`, { days: quietDays, defaultValue: 'Has not signed in for {{days}} days.' }))
  }
  const notStarted = courses.filter((c) => (c.progress_pct || 0) === 0 && c.status !== 'STATUS_COMPLETED')
  if (notStarted.length > 0) {
    attention.push(
      t(`${P}.progress.not_started`, {
        courses: notStarted.map((c) => c.course_name || 'Untitled course').join(', '),
        defaultValue: 'Not started: {{courses}}.',
      })
    )
  }
  const awaitingGrade = assignments.filter((a) => a.status === 'SUBMITTED').length
  if (awaitingGrade > 0) {
    attention.push(t(`${P}.progress.awaiting_grade`, { count: awaitingGrade, defaultValue: '{{count}} submitted assignment(s) waiting to be graded.' }))
  }
  const attendance = summary.avg_live_attendance_pct
  if (typeof attendance === 'number' && attendance < LOW_ATTENDANCE_PERCENT) {
    attention.push(t(`${P}.progress.low_attendance`, { percent: attendance, defaultValue: 'Live class attendance is low ({{percent}}%).' }))
  }

  // In-progress courses first, then the rest; the least advanced on top so gaps show.
  const orderedCourses = [...courses].sort((a, b) => {
    const done = (c: any) => (c.status === 'STATUS_COMPLETED' ? 1 : 0)
    return done(a) - done(b) || (a.progress_pct || 0) - (b.progress_pct || 0)
  })
  const latest = [...assignments]
    .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')))
    .slice(0, LATEST_GRADES)

  const stat = (label: string, value: React.ReactNode, sub?: string) => (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  )

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle icon={<TrendingUp size={18} />} title={t(`${P}.progress.title`, { defaultValue: 'Learning progress' })} />
        <p className="mb-4 text-sm text-gray-600">
          {enrolled === 0
            ? t(`${P}.progress.no_courses`, { name, defaultValue: '{{name}} is not enrolled in any course yet.' })
            : t(`${P}.progress.headline`, {
                name,
                completed,
                enrolled,
                progress: avgProgress,
                defaultValue: '{{name}} has completed {{completed}} of {{enrolled}} courses, with {{progress}}% average progress.',
              })}
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stat(t(`${P}.progress.avg_progress`, { defaultValue: 'Average progress' }), `${avgProgress}%`)}
          {stat(t(`${P}.progress.courses_done`, { defaultValue: 'Courses completed' }), `${completed}/${enrolled}`)}
          {stat(
            t(`${P}.progress.avg_grade`, { defaultValue: 'Average grade' }),
            summary.avg_grade_pct != null ? `${summary.avg_grade_pct}%` : '·',
            t(`${P}.progress.graded`, { count: summary.assignments_graded ?? 0, defaultValue: '{{count}} graded' })
          )}
          {stat(
            t(`${P}.progress.attendance`, { defaultValue: 'Live attendance' }),
            typeof attendance === 'number' ? `${attendance}%` : '·',
            t(`${P}.progress.sessions`, { count: summary.live_sessions_attended ?? 0, defaultValue: '{{count}} classes attended' })
          )}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          {attention.length > 0 ? <AlertTriangle size={18} className="text-amber-500" /> : <CheckCircle2 size={18} className="text-green-600" />}
          <h3 className="text-lg font-bold tracking-tight">{t(`${P}.progress.attention`, { defaultValue: 'Needs attention' })}</h3>
        </div>
        {attention.length === 0 ? (
          <p className="text-sm text-gray-500">{t(`${P}.progress.all_good`, { defaultValue: 'Nothing stands out right now.' })}</p>
        ) : (
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
            {attention.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle icon={<TrendingUp size={18} />} title={t(`${P}.progress.by_course`, { defaultValue: 'Course by course' })} count={courses.length} />
        {courses.length === 0 ? (
          <Empty label={t(`${P}.courses.empty`)} />
        ) : (
          <div className="space-y-4">
            {orderedCourses.map((c, i) => (
              <div key={i}>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="truncate font-semibold">{c.course_name || 'Untitled course'}</span>
                  <StatusBadge status={c.status} />
                </div>
                <ProgressBar pct={c.progress_pct} />
                <div className="mt-1 text-xs text-gray-500">
                  {c.progress_pct}% · {t(`${P}.courses.activities`, { done: c.activities_completed, total: c.activities_total })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle icon={<CheckCircle2 size={18} />} title={t(`${P}.progress.latest_grades`, { defaultValue: 'Latest assignments' })} />
          {latest.length === 0 ? (
            <Empty label={t(`${P}.assignments.empty`)} />
          ) : (
            <div className="divide-y divide-gray-100">
              {latest.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{a.title || a.assignment_uuid}</div>
                    <div className="text-xs text-gray-400">{[a.course_name, fmtDate(a.submitted_at)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold">{a.grade_display || (a.grade != null ? `${a.grade}` : '·')}</span>
                    <StatusBadge status={a.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle icon={<CheckCircle2 size={18} />} title={t(`${P}.certificates.title`)} count={certificates.length} />
          {certificates.length === 0 ? (
            <Empty label={t(`${P}.certificates.empty`)} />
          ) : (
            <ul className="space-y-2 text-sm">
              {certificates.map((c, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="truncate font-semibold">{c.course_name}</span>
                  <span className="shrink-0 text-xs text-gray-400">{fmtDate(c.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
