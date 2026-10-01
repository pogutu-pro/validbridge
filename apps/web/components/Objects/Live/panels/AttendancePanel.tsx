'use client'

import { ClipboardList } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useLiveAttendance } from '@/hooks/queries/useLive'
import type { AttendanceStatus } from '@services/live/live'
import { useClassroom } from '../ClassroomContext'
import { formatDuration } from '../liveMath'
import { initials, roleLabelKey } from '../participantUtils'
import PanelState from './PanelState'

const STATUS_STYLES: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-50 text-emerald-700',
  late: 'bg-amber-50 text-amber-700',
  left_early: 'bg-amber-50 text-amber-700',
  partial: 'bg-orange-50 text-orange-700',
  absent: 'bg-neutral-100 text-neutral-500',
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const { t } = useTranslation()
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', STATUS_STYLES[status])}>
      {t(`live.attendance.status_${status}`)}
    </span>
  )
}

/**
 * Automatic attendance from LiveKit's server-side join/leave events. Staff
 * only; refreshes every 15s while open.
 */
export default function AttendancePanel() {
  const { t } = useTranslation()
  const { sessionUuid, isStaff } = useClassroom()
  const { data, isLoading, isError, refetch } = useLiveAttendance(sessionUuid, isStaff)

  if (isLoading) return <PanelState loading />
  if (isError || !data) {
    return <PanelState title={t('live.errors.generic')} action={{ label: t('live.common.retry'), onClick: () => refetch() }} />
  }

  const { summary } = data
  const presentNow = data.participants.filter((p) => p.is_connected && p.role === 'learner').length
  const stats = [
    { label: t('live.attendance.present_now'), value: presentNow },
    {
      label: t('live.attendance.average'),
      value: summary.average_attendance_percent === null ? '–' : `${Math.round(summary.average_attendance_percent)}%`,
    },
    { label: t('live.attendance.enrolled'), value: data.enrolled_count },
  ]
  const breakdown: { status: AttendanceStatus; value: number }[] = [
    { status: 'present', value: summary.present },
    { status: 'late', value: summary.late },
    { status: 'left_early', value: summary.left_early },
    { status: 'partial', value: summary.partial },
    { status: 'absent', value: summary.absent },
  ]

  return (
    <div className="h-full min-h-0 overflow-y-auto p-3">
      <div className="mb-2 grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-neutral-50 p-3 text-center">
            <p className="text-lg font-semibold text-neutral-900">{s.value}</p>
            <p className="text-[11px] leading-tight text-neutral-500">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {breakdown.map(({ status, value }) => (
          <span key={status} className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', STATUS_STYLES[status])}>
            {t(`live.attendance.status_${status}`)} · {value}
          </span>
        ))}
      </div>

      {data.participants.length === 0 && data.absent.length === 0 ? (
        <PanelState icon={<ClipboardList className="size-5" />} title={t('live.attendance.empty')} />
      ) : (
        <ul className="space-y-1">
          {data.participants.map((p) => {
            const name = `${p.first_name} ${p.last_name}`.trim() || p.username
            const staff = p.role !== 'learner'
            const details = [
              p.late_by_seconds > 60 && t('live.attendance.late_by', { time: formatDuration(p.late_by_seconds) }),
              p.left_early_by_seconds > 60 && t('live.attendance.left_early_by', { time: formatDuration(p.left_early_by_seconds) }),
              p.connection_count > 1 && t('live.attendance.connections', { count: p.connection_count }),
            ].filter(Boolean)
            return (
              <li key={p.user_uuid} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-semibold text-neutral-600">
                  {initials(name)}
                  {p.is_connected && <span className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-white bg-emerald-500" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-neutral-900">{name}</p>
                    {!staff && <StatusBadge status={p.attendance_status} />}
                  </div>
                  <p className="truncate text-[11px] text-neutral-500">
                    {staff ? t(roleLabelKey(p.role)) : details.join(' · ') || t('live.attendance.on_time')}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-sm font-medium text-neutral-800">{formatDuration(p.duration_seconds)}</p>
                  {p.attendance_percent !== null && <p className="text-[11px] text-neutral-500">{Math.round(p.attendance_percent)}%</p>}
                </div>
              </li>
            )
          })}
          {data.absent.map((a) => {
            const name = `${a.first_name} ${a.last_name}`.trim() || a.username
            return (
              <li key={a.user_uuid} className="flex items-center gap-3 rounded-xl px-2 py-2 opacity-70">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-semibold text-neutral-500">
                  {initials(name)}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm text-neutral-700">{name}</p>
                <StatusBadge status="absent" />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
