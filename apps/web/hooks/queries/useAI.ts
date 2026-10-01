'use client'

import { useQuery } from '@tanstack/react-query'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { queryKeys } from '@lib/query/keys'
import { fetchRAGChatSessions } from '@services/ai/ai'

export function useRagSessions(orgSlug: string) {
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.ai.ragSessions(orgSlug),
    queryFn: () => fetchRAGChatSessions(accessToken!, orgSlug),
    enabled: !!orgSlug && !!accessToken,
    staleTime: 60_000,
  })
}
