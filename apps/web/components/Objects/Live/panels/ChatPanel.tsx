'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useLiveMessages } from '@/hooks/queries/useLive'
import { deleteLiveMessage, sendLiveMessage, type LiveMessage } from '@services/live/live'
import { useClassroom } from '../ClassroomContext'
import { removeMessage, upsertMessage } from '../liveCache'
import { liveErrorKey } from '../liveErrors'
import { initials, roleLabelKey } from '../participantUtils'
import Composer from './Composer'
import PanelState from './PanelState'
import { useCanInteract } from './useCanInteract'

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ChatPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { sessionUuid, accessToken, isStaff, userUuid } = useClassroom()
  const { data: messages = [], isLoading, isError, refetch } = useLiveMessages(sessionUuid, 'chat')
  const blockedReason = useCanInteract()
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const onScroll = () => {
    const el = listRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const send = async (body: string) => {
    try {
      const message = await sendLiveMessage(sessionUuid, 'chat', body, accessToken)
      stickToBottom.current = true
      upsertMessage(qc, sessionUuid, message)
      return true
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
      return false
    }
  }

  const remove = async (message: LiveMessage) => {
    try {
      await deleteLiveMessage(sessionUuid, message.message_uuid, accessToken)
      removeMessage(qc, sessionUuid, 'chat', message.message_uuid)
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <PanelState loading />
        ) : isError ? (
          <PanelState title={t('live.errors.generic')} action={{ label: t('live.common.retry'), onClick: () => refetch() }} />
        ) : messages.length === 0 ? (
          <PanelState icon={<MessageSquare className="size-5" />} title={t('live.chat.empty_title')} description={t('live.chat.empty_description')} />
        ) : (
          messages.map((message) => {
            const mine = message.author?.user_uuid === userUuid
            const authorRole = message.author?.role ?? 'learner'
            return (
              <div key={message.message_uuid} className="group flex gap-2.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-semibold text-neutral-600">
                  {initials(message.author?.display_name ?? '?')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-sm font-semibold text-neutral-900">
                      {mine ? t('live.common.you') : message.author?.display_name ?? t('live.chat.former_participant')}
                    </span>
                    {authorRole !== 'learner' && (
                      <span className="rounded bg-primary/10 px-1.5 text-[10px] font-semibold uppercase text-primary">
                        {t(roleLabelKey(authorRole))}
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] text-neutral-400">{time(message.created_at)}</span>
                    {(mine || isStaff) && (
                      <button
                        type="button"
                        onClick={() => remove(message)}
                        aria-label={t('live.chat.delete')}
                        className="ms-auto rounded p-1 text-neutral-400 opacity-0 transition hover:bg-neutral-100 hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <p className={cn('whitespace-pre-wrap break-words text-sm text-neutral-700', mine && 'text-neutral-900')}>
                    {message.body}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>
      <Composer placeholder={t('live.chat.placeholder')} disabledReason={blockedReason} onSend={send} />
    </div>
  )
}
