import { useEffect } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent, type Room } from 'livekit-client'
import { AnalyticsEvent, useVBAnalytics } from '@services/analytics'
import { transportFromStats } from './liveMath'

async function currentTransport(room: Room): Promise<string | null> {
  const tracks = [
    ...Array.from(room.localParticipant.trackPublications.values()),
    ...Array.from(room.remoteParticipants.values()).flatMap((p) => Array.from(p.trackPublications.values())),
  ]
    .map((publication) => publication.track)
    .filter(Boolean)
  for (const track of tracks) {
    try {
      const transport = transportFromStats(await track!.getRTCStatsReport())
      if (transport) return transport
    } catch {
      /* stats are best effort */
    }
  }
  return null
}

/**
 * Report connection health to the existing analytics pipeline: which
 * transport was used and every reconnect. No media, tokens or URLs are sent.
 */
export function useConnectionTelemetry(sessionUuid: string) {
  const room = useRoomContext()
  const { track } = useVBAnalytics('live')

  useEffect(() => {
    let cancelled = false
    // Media needs a moment to negotiate; the lecturer may have nothing
    // published yet, so retry until any track reports a candidate pair.
    const attempts = [4000, 15000, 45000]
    const timers = attempts.map((delay, index) =>
      window.setTimeout(async () => {
        if (cancelled) return
        const transport = await currentTransport(room)
        if (transport && !cancelled) {
          cancelled = true
          track(AnalyticsEvent.LiveConnected, { session_uuid: sessionUuid, transport })
        } else if (index === attempts.length - 1 && !cancelled) {
          track(AnalyticsEvent.LiveConnected, { session_uuid: sessionUuid, transport: 'no_media' })
        }
      }, delay)
    )
    const onReconnecting = () => track(AnalyticsEvent.LiveReconnecting, { session_uuid: sessionUuid })
    const onReconnected = () => track(AnalyticsEvent.LiveReconnected, { session_uuid: sessionUuid })
    room.on(RoomEvent.Reconnecting, onReconnecting)
    room.on(RoomEvent.Reconnected, onReconnected)
    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
      room.off(RoomEvent.Reconnecting, onReconnecting)
      room.off(RoomEvent.Reconnected, onReconnected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per room
  }, [room, sessionUuid])
}
