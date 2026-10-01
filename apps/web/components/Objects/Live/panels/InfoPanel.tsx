'use client'

import { CalendarClock, GraduationCap, Headphones, ShieldCheck, Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useClassroom } from '../ClassroomContext'
import { roleLabelKey } from '../participantUtils'

function formatDateTime(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export default function InfoPanel() {
  const { t } = useTranslation()
  const { classroom, role } = useClassroom()
  const { session } = classroom

  const rows = [
    { icon: GraduationCap, label: t('live.info.course'), value: classroom.course_name },
    { icon: CalendarClock, label: t('live.info.scheduled'), value: formatDateTime(session.scheduled_at) },
    { icon: CalendarClock, label: t('live.info.started'), value: formatDateTime(session.started_at) },
    { icon: ShieldCheck, label: t('live.info.your_role'), value: t(roleLabelKey(role)) },
  ].filter((row) => row.value)

  return (
    <div className="h-full min-h-0 space-y-5 overflow-y-auto p-4">
      <div>
        <h2 className="text-base font-semibold text-neutral-900">{session.title}</h2>
        {session.description && (
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-neutral-600">{session.description}</p>
        )}
      </div>
      <dl className="space-y-3">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-neutral-400" aria-hidden />
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</dt>
              <dd className="text-sm text-neutral-800">{value}</dd>
            </div>
          </div>
        ))}
      </dl>
      <div className="space-y-2 rounded-xl bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600">
        <p className="flex gap-2">
          <Headphones className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('live.info.tip_audio')}
        </p>
        <p className="flex gap-2">
          <Wifi className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('live.info.tip_network')}
        </p>
      </div>
    </div>
  )
}
