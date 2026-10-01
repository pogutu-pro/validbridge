'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, CircleHelp, Reply, RotateCcw, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useLiveMessages } from '@/hooks/queries/useLive'
import { sendLiveMessage, updateLiveQuestion, type LiveMessage } from '@services/live/live'
import { useClassroom } from '../ClassroomContext'
import { upsertMessage } from '../liveCache'
import { liveErrorKey } from '../liveErrors'
import Composer from './Composer'
import PanelState from './PanelState'
import { useCanInteract } from './useCanInteract'

type Filter = 'open' | 'answered' | 'all'

export default function QuestionsPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { sessionUuid, accessToken, isStaff, userUuid } = useClassroom()
  const { data: questions = [], isLoading, isError, refetch } = useLiveMessages(sessionUuid, 'question')
  const blockedReason = useCanInteract()
  const [filter, setFilter] = useState<Filter>('open')

  const visible = useMemo(() => {
    const list = questions.filter((q) => {
      if (!isStaff) return q.status !== 'dismissed' || q.author?.user_uuid === userUuid
      if (filter === 'open') return q.status === 'open'
      if (filter === 'answered') return q.status === 'answered'
      return true
    })
    // Learners: open questions first, then answered.
    return isStaff ? list : [...list].sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open'))
  }, [questions, filter, isStaff, userUuid])

  const ask = async (body: string) => {
    try {
      upsertMessage(qc, sessionUuid, await sendLiveMessage(sessionUuid, 'question', body, accessToken))
      toast.success(t('live.questions.sent'))
      return true
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
      return false
    }
  }

  const setStatus = async (question: LiveMessage, status: 'open' | 'answered' | 'dismissed', answer?: string) => {
    try {
      upsertMessage(
        qc,
        sessionUuid,
        await updateLiveQuestion(sessionUuid, question.message_uuid, status, accessToken, answer)
      )
      return true
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
      return false
    }
  }
  const [replyingTo, setReplyingTo] = useState<string | null>(null)

  const openCount = questions.filter((q) => q.status === 'open').length

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isStaff && (
        <div className="flex gap-1 border-b border-neutral-100 px-3 py-2" role="tablist">
          {(['open', 'answered', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium transition',
                filter === f ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
              )}
            >
              {t(`live.questions.filter_${f}`)}
              {f === 'open' && openCount > 0 && ` · ${openCount}`}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading ? (
          <PanelState loading />
        ) : isError ? (
          <PanelState title={t('live.errors.generic')} action={{ label: t('live.common.retry'), onClick: () => refetch() }} />
        ) : visible.length === 0 ? (
          <PanelState
            icon={<CircleHelp className="size-5" />}
            title={t(isStaff ? 'live.questions.empty_staff' : 'live.questions.empty_title')}
            description={isStaff ? undefined : t('live.questions.empty_description')}
          />
        ) : (
          visible.map((q) => {
            const mine = q.author?.user_uuid === userUuid
            return (
              <div
                key={q.message_uuid}
                className={cn(
                  'rounded-xl border p-3',
                  q.status === 'answered' ? 'border-emerald-100 bg-emerald-50/50' : 'border-neutral-200 bg-white',
                  q.status === 'dismissed' && 'opacity-60'
                )}
              >
                <p className="whitespace-pre-wrap break-words text-sm text-neutral-900">{q.body}</p>
                {q.answer && (
                  <div className="mt-2 rounded-lg border-s-2 border-primary bg-white/80 px-3 py-2">
                    <p className="text-[11px] font-semibold text-primary">
                      {t('live.questions.lecturer_answer', { name: q.answered_by ?? t('live.roles.instructor') })}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm text-neutral-800">{q.answer}</p>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                  <span className="font-medium">{mine ? t('live.common.you') : q.author?.display_name}</span>
                  {q.status === 'answered' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                      <Check className="size-3" /> {t('live.questions.answered')}
                    </span>
                  )}
                  {q.status === 'dismissed' && <span>{t('live.questions.dismissed')}</span>}
                  {isStaff && (
                    <span className="ms-auto flex gap-1">
                      {q.status === 'open' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setReplyingTo(replyingTo === q.message_uuid ? null : q.message_uuid)}
                            aria-expanded={replyingTo === q.message_uuid}
                            className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50"
                          >
                            <Reply className="size-3.5" /> {t('live.questions.reply')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setStatus(q, 'answered')}
                            className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            <Check className="size-3.5" /> {t('live.questions.mark_answered')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setStatus(q, 'dismissed')}
                            aria-label={t('live.questions.dismiss')}
                            className="flex size-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
                          >
                            <X className="size-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setStatus(q, 'open')}
                          className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                        >
                          <RotateCcw className="size-3.5" /> {t('live.questions.reopen')}
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {isStaff && replyingTo === q.message_uuid && (
                  <div className="-mx-3 -mb-3 mt-2">
                    <Composer
                      placeholder={t('live.questions.reply_placeholder')}
                      onSend={async (body) => {
                        const ok = await setStatus(q, 'answered', body)
                        if (ok) setReplyingTo(null)
                        return ok
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      {!isStaff && <Composer placeholder={t('live.questions.placeholder')} disabledReason={blockedReason} onSend={ask} />}
    </div>
  )
}
