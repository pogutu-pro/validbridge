'use client'
import { useCallback } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { trackEvent } from '@services/analytics/analytics'

export function useAnalytics() {
  const org = useOrg() as any
  const session = useVBSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token

  const track = useCallback(
    (eventName: string, properties: Record<string, unknown> = {}) => {
      if (!org?.id || !accessToken) return
      trackEvent(eventName, org.id, properties, accessToken)
    },
    [org?.id, accessToken]
  )

  return { track }
}
