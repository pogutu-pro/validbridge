import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@lib/query/keys'
import type { LiveMessage } from '@services/live/live'

export function upsertMessage(qc: QueryClient, sessionUuid: string, message: LiveMessage) {
  qc.setQueryData<LiveMessage[]>(queryKeys.live.messages(sessionUuid, message.kind), (prev) => {
    const list = prev ?? []
    const index = list.findIndex((m) => m.message_uuid === message.message_uuid)
    if (index === -1) return [...list, message]
    const next = list.slice()
    next[index] = message
    return next
  })
}

export function removeMessage(qc: QueryClient, sessionUuid: string, kind: 'chat' | 'question', messageUuid: string) {
  qc.setQueryData<LiveMessage[]>(queryKeys.live.messages(sessionUuid, kind), (prev) =>
    (prev ?? []).filter((m) => m.message_uuid !== messageUuid)
  )
}
