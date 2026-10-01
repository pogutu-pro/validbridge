// The org's premium AI credit balance (GET /orgs/{id}/ai-credits). Any member
// may read it, so the dashboard and the student course tutor can both say when
// the school has run out. Genie, the help assistant, never uses credits.

import { useQuery } from '@tanstack/react-query'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getAPIUrl } from '@services/config/config'

export interface AiCreditsSummary {
  plan: string
  base_credits: number | 'unlimited'
  purchased_credits: number
  total_credits: number | 'unlimited'
  used_credits: number
  remaining_credits: number | 'unlimited'
}

async function fetchAiCredits(orgId: number, token?: string): Promise<AiCreditsSummary | null> {
  const res = await fetch(`${getAPIUrl()}orgs/${orgId}/ai-credits`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    cache: 'no-store',
  })
  return res.ok ? ((await res.json()) as AiCreditsSummary) : null
}

/** True once the balance is known and nothing is left. Unknown or unlimited → false. */
export function useAiCreditsExhausted(orgId: number | undefined): boolean {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const { data } = useQuery({
    queryKey: ['ai-credits', orgId],
    queryFn: () => fetchAiCredits(orgId as number, token),
    enabled: !!orgId && !!token,
    staleTime: 60_000,
    retry: false,
  })
  return typeof data?.remaining_credits === 'number' && data.remaining_credits <= 0
}
