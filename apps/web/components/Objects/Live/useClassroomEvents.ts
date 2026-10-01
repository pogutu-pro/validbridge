'use client'

import { useEffect, useRef } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent, type RemoteParticipant } from 'livekit-client'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { queryKeys } from '@lib/query/keys'
import { LIVE_TOPICS, type LiveMessage, type LivePoll } from '@services/live/live'
import { useClassroom } from './ClassroomContext'
import { removeMessage, upsertMessage } from './liveCache'
import { mergePollResults } from './liveMath'

const decoder = new TextDecoder()

/**
 * Applies server broadcasts to local state. Only messages sent by the server
 * (no sending participant) are trusted; anything a participant publishes on a
 * vb.* topic is ignored.
 */
export function useClassroomEvents() {
  const room = useRoomContext()
  const qc = useQueryClient()
  const { t } = useTranslation()
  const ctx = useClassroom()
  // Handlers read the latest context without re-subscribing on every render.
  const ctxRef = useRef(ctx)
  useEffect(() => {
    ctxRef.current = ctx
  }, [ctx])

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (participant || !topic?.startsWith('vb.')) return
      let data: any
      try {
        data = JSON.parse(decoder.decode(payload))
      } catch {
        return
      }
      const current = ctxRef.current
      const { sessionUuid } = current
      const panelShowing = (tab: string) => current.panelOpen && current.tab === tab

      switch (topic) {
        case LIVE_TOPICS.messages: {
          if (data.type === 'created' || data.type === 'updated') {
            const message = data.message as LiveMessage
            upsertMessage(qc, sessionUuid, message)
            const unreadTab = message.kind === 'chat' ? 'chat' : 'questions'
            if (
              data.type === 'created' &&
              message.author?.user_uuid !== current.userUuid &&
              !panelShowing(unreadTab) &&
              (message.kind === 'chat' || current.isStaff)
            ) {
              current.bumpUnread(unreadTab)
            }
          } else if (data.type === 'deleted') {
            removeMessage(qc, sessionUuid, data.kind, data.message_uuid)
          }
          break
        }
        case LIVE_TOPICS.polls: {
          if (data.type === 'results') {
            // Live counts: merged in place, no refetch (see mergePollResults).
            qc.setQueryData<LivePoll[]>(queryKeys.live.polls(sessionUuid), (prev) => mergePollResults(prev, data))
            break
          }
          qc.invalidateQueries({ queryKey: queryKeys.live.polls(sessionUuid) })
          if (data.type === 'created' && !current.isStaff) {
            if (!panelShowing('polls')) current.bumpUnread('polls')
            toast(t('live.polls.new_poll_toast'), { icon: '📊' })
          }
          break
        }
        case LIVE_TOPICS.quiz: {
          // Staff refresh on every (throttled) progress tick; learners only
          // when a question opens or the quiz finishes.
          if (data.type === 'progress' && !current.isStaff) break
          qc.invalidateQueries({ queryKey: queryKeys.live.quiz(sessionUuid) })
          if (data.type === 'question' && !current.isStaff && !panelShowing('quiz')) current.bumpUnread('quiz')
          break
        }
        case LIVE_TOPICS.reactions: {
          if (typeof data.emoji !== 'string') break
          const sender = room.remoteParticipants.get(data.identity) ?? (data.identity === room.localParticipant.identity ? room.localParticipant : undefined)
          current.pushReaction({ emoji: data.emoji, name: sender?.name || '' })
          break
        }
        case LIVE_TOPICS.moderation: {
          if (data.type === 'muted') {
            toast(t(data.source === 'camera' ? 'live.moderation.camera_stopped_by_lecturer' : 'live.moderation.muted_by_lecturer'))
          } else if (data.type === 'media') {
            toast(t(data.allowed ? 'live.moderation.media_allowed' : 'live.moderation.media_revoked'))
            qc.invalidateQueries({ queryKey: queryKeys.live.classroom(sessionUuid) })
          }
          break
        }
      }
    }
    room.on(RoomEvent.DataReceived, onData)
    return () => {
      room.off(RoomEvent.DataReceived, onData)
    }
  }, [room, qc, t])
}
