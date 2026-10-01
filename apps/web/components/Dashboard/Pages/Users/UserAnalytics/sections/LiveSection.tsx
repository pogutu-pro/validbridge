'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Radio } from 'lucide-react'
import { fmtDate } from '../format'
import { Card, SectionTitle, Empty } from './primitives'

const STATUS_STYLES: Record<string, string> = {
  present: 'bg-emerald-50 text-emerald-700',
  late: 'bg-amber-50 text-amber-700',
  left_early: 'bg-amber-50 text-amber-700',
  partial: 'bg-orange-50 text-orange-700',
  absent: 'bg-gray-100 text-gray-500',
}

/** LiveBridge history for one student: attendance, participation, live quiz scores. */
export default function LiveSection({ live }: { live: any }) {
  const { t } = useTranslation()
  const sessions: any[] = live?.sessions || []
  const summary = live?.summary || {}
  return (
    <Card>
      <SectionTitle icon={<Radio size={18} />} title={t('live.dossier.title')} count={sessions.length} />
      {sessions.length === 0 ? (
        <Empty label={t('live.dossier.empty')} />
      ) : (
        <>
          <p className="mb-3 text-xs text-gray-500">
            {t('live.dossier.summary', {
              attended: summary.sessions_attended ?? 0,
              attendance: summary.average_attendance_percent ?? '–',
              quiz: summary.live_quiz_average_percent ?? '–',
              participation: summary.participation ?? 0,
            })}
          </p>
          <div className="divide-y divide-gray-100">
            {sessions.map((s) => {
              const p = s.participation || {}
              return (
                <div key={s.session_uuid} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{s.title}</div>
                    <div className="text-xs text-gray-400">{s.course_name} · {fmtDate(s.started_at)}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[s.attendance_status] || ''}`}>
                    {t(`live.attendance.status_${s.attendance_status}`)}
                  </span>
                  <div className="w-full text-xs text-gray-500 sm:w-auto sm:text-end">
                    {t('live.dossier.row', {
                      attendance: s.attendance_percent ?? '–',
                      messages: p.messages ?? 0,
                      questions: p.questions ?? 0,
                      votes: p.poll_votes ?? 0,
                      quiz: s.quiz_percent ?? '–',
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}
