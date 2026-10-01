'use client'

import { useMemo } from 'react'
import { useRoomInfo } from '@livekit/components-react'
import type { StageFocus } from '@services/live/live'

export interface RoomMeta {
  focus: StageFocus
  recording: boolean
}

/**
 * Room-wide state the server publishes in LiveKit room metadata, so every
 * participant — including late joiners — sees the same thing instantly.
 */
export function useRoomMeta(): RoomMeta {
  const { metadata } = useRoomInfo()
  return useMemo(() => {
    try {
      const data = JSON.parse(metadata || '{}')
      return { focus: data?.focus === 'camera' ? 'camera' : 'presentation', recording: data?.recording === true }
    } catch {
      return { focus: 'presentation', recording: false }
    }
  }, [metadata])
}
