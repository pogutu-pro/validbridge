'use client'
import { AlertTriangle, Lock, LockOpen, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChapterGate } from '@services/courses/progression'

type ChapterLockBadgeProps = {
  gate?: ChapterGate
  className?: string
}

/**
 * Compact lock state for a chapter row.
 *
 * Three visual states, chosen to match the icon language already used in the
 * course UI (outline for neutral, amber for attention, muted for open) so a
 * locked chapter does not look like a different feature bolted on:
 *
 *   locked            Lock, solid amber - the learner cannot proceed
 *   warning only      AlertTriangle, outline amber - can proceed, should not
 *   open              LockOpen, muted - nothing to say, so say nothing
 *
 * Renders nothing when there is no gate, so a course without the feature
 * enabled produces zero visual change.
 */
export function ChapterLockBadge({ gate, className = '' }: ChapterLockBadgeProps) {
  const { t } = useTranslation()

  if (!gate) return null

  if (gate.locked) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 ${className}`}
        title={gate.message ?? t('courses.progression.locked_title')}
      >
        <Lock className='h-3.5 w-3.5 shrink-0' aria-hidden='true' />
        <span>{t('courses.progression.locked')}</span>
      </span>
    )
  }

  if (gate.reason && gate.blocking.length > 0) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 ${className}`}
        title={gate.message ?? t('courses.progression.warning_title')}
      >
        <AlertTriangle className='h-3.5 w-3.5 shrink-0' aria-hidden='true' />
        <span>{t('courses.progression.warning')}</span>
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-gray-400 ${className}`}
    >
      <LockOpen className='h-3.5 w-3.5 shrink-0' aria-hidden='true' />
      <span>{t('courses.progression.open')}</span>
    </span>
  )
}

type CourseProgressionNoticeProps = {
  gate?: ChapterGate
  courseName?: string
  onRetry?: () => void
}

/**
 * Explains a lock instead of just refusing.
 *
 * The API returns a 403 with this same information; this component is what the
 * learner sees instead of a generic error, so it names the exact assessments
 * standing between them and the chapter. A failed assessment is called out
 * separately from an unfinished one, because the remedy differs: retry versus
 * submit.
 */
export function CourseProgressionNotice({
  gate,
  courseName,
  onRetry,
}: CourseProgressionNoticeProps) {
  const { t } = useTranslation()

  if (!gate || (!gate.locked && gate.blocking.length === 0)) return null

  const failed = gate.blocking.filter((b) => b.state === 'failed')
  const pending = gate.blocking.filter((b) => b.state !== 'failed')

  return (
    <div
      role='status'
      className='rounded-lg border border-amber-200 bg-amber-50/60 p-4'
    >
      <div className='flex items-start gap-3'>
        {gate.locked ? (
          <Lock
            className='mt-0.5 h-5 w-5 shrink-0 text-amber-600'
            aria-hidden='true'
          />
        ) : (
          <AlertTriangle
            className='mt-0.5 h-5 w-5 shrink-0 text-amber-600'
            aria-hidden='true'
          />
        )}

        <div className='min-w-0 flex-1'>
          <h3 className='text-sm font-semibold text-gray-900'>
            {gate.locked
              ? t('courses.progression.notice.locked_heading')
              : t('courses.progression.notice.warning_heading')}
          </h3>

          <p className='mt-1 text-sm text-gray-600'>
            {gate.message ?? t('courses.progression.notice.fallback')}
            {courseName ? ` ${courseName}` : ''}
          </p>

          {pending.length > 0 && (
            <div className='mt-3'>
              <p className='text-xs font-medium uppercase tracking-wide text-gray-500'>
                {t('courses.progression.notice.outstanding')}
              </p>
              <ul className='mt-1 space-y-1'>
                {pending.map((item) => (
                  <li
                    key={item.assignment_uuid}
                    className='flex items-center gap-2 text-sm text-gray-700'
                  >
                    <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400' />
                    {item.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {failed.length > 0 && (
            <div className='mt-3'>
              <p className='text-xs font-medium uppercase tracking-wide text-gray-500'>
                {t('courses.progression.notice.not_passed')}
              </p>
              <ul className='mt-1 space-y-1'>
                {failed.map((item) => (
                  <li
                    key={item.assignment_uuid}
                    className='flex items-center gap-2 text-sm text-gray-700'
                  >
                    <AlertTriangle
                      className='h-3.5 w-3.5 shrink-0 text-amber-500'
                      aria-hidden='true'
                    />
                    {item.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {failed.length > 0 && onRetry && (
            <button
              type='button'
              onClick={onRetry}
              className='mt-4 inline-flex items-center gap-2 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2'
            >
              <ShieldCheck className='h-4 w-4' aria-hidden='true' />
              {t('courses.progression.notice.retry')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
