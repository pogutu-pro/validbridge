'use client'

import { useMemo } from 'react'
import {
  isTrackReference,
  useSpeakingParticipants,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { VideoOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { StageFocus } from '@services/live/live'
import ParticipantTile from './ParticipantTile'
import { useRoomMeta } from './roomMetadata'
import { participantRole } from './participantUtils'

/**
 * Only a handful of tiles are ever rendered. With ~100 learners (cameras off
 * by default) the stage shows staff, whoever is speaking and anyone with a
 * camera on, capped per layout. Tracks that are not attached to a rendered
 * element are paused by adaptiveStream, so off-stage video costs nothing.
 */
const MAX_TILES_DESKTOP = 9
const MAX_TILES_MOBILE = 4
const MAX_FILMSTRIP_DESKTOP = 4
const MAX_FILMSTRIP_MOBILE = 3

function useFeaturedCameras(limit: number) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  )
  const speakers = useSpeakingParticipants()

  return useMemo(() => {
    const speakerOrder = new Map(speakers.map((p, i) => [p.identity, i]))
    const screen = tracks.find(
      (t) => t.source === Track.Source.ScreenShare && isTrackReference(t) && !t.publication.isMuted
    )

    const scored: { ref: TrackReferenceOrPlaceholder; score: number }[] = []
    for (const ref of tracks) {
      if (ref.source !== Track.Source.Camera) continue
      const role = participantRole(ref.participant)
      const cameraOn = isTrackReference(ref) && !ref.publication.isMuted
      const speakingRank = speakerOrder.get(ref.participant.identity)
      let score = 0
      if (role === 'instructor') score += 1000
      else if (role === 'moderator') score += 500
      if (speakingRank !== undefined) score += 300 - Math.min(speakingRank, 50)
      if (cameraOn) score += 100
      if (score > 0) scored.push({ ref, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return { screen, cameras: scored.slice(0, limit).map((s) => s.ref) }
  }, [tracks, speakers, limit])
}

function gridClass(count: number, isDesktop: boolean): string {
  if (count <= 1) return 'grid-cols-1'
  if (count === 2) return isDesktop ? 'grid-cols-2' : 'grid-cols-1 grid-rows-2'
  return 'grid-cols-2'
}

/** The lecturer's choice while presenting, from LiveKit room metadata. */
export function useStageFocus(): StageFocus {
  return useRoomMeta().focus
}

export default function Stage({ isDesktop }: { isDesktop: boolean }) {
  const { t } = useTranslation()
  const limit = isDesktop ? MAX_TILES_DESKTOP : MAX_TILES_MOBILE
  const { screen, cameras } = useFeaturedCameras(limit)
  const focus = useStageFocus()

  if (screen) {
    // "presentation": the shared screen is the main stage, cameras in a strip.
    // "camera": the lecturer on the main stage, the presentation in the strip.
    const cameraFocus = focus === 'camera' && cameras.length > 0
    const main = cameraFocus ? cameras[0] : screen
    const others = cameraFocus ? [screen, ...cameras.slice(1)] : cameras
    const strip = others.slice(0, isDesktop ? MAX_FILMSTRIP_DESKTOP : MAX_FILMSTRIP_MOBILE)
    return (
      <div className={cn('flex size-full min-h-0 gap-2', isDesktop ? 'flex-row' : 'flex-col')}>
        <ParticipantTile trackRef={main} className="min-h-0 flex-1 bg-black" />
        {strip.length > 0 && (
          <div
            className={cn(
              'flex shrink-0 gap-2',
              isDesktop ? 'w-52 flex-col overflow-y-auto' : 'h-24 flex-row overflow-x-auto'
            )}
          >
            {strip.map((ref) => (
              <ParticipantTile
                key={`${ref.participant.identity}-${ref.source}`}
                trackRef={ref}
                compact
                className={isDesktop ? 'aspect-video w-full shrink-0' : 'h-full w-36 shrink-0'}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (cameras.length === 0) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 rounded-xl text-center text-neutral-400">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-neutral-800">
          <VideoOff className="size-6" aria-hidden />
        </span>
        <p className="max-w-xs text-sm">{t('live.stage.no_video')}</p>
      </div>
    )
  }

  // Spotlight: the lecturer (or loudest speaker) large, everyone else in a strip.
  if (cameras.length > 4) {
    const [main, ...rest] = cameras
    return (
      <div className={cn('flex size-full min-h-0 gap-2', isDesktop ? 'flex-row' : 'flex-col')}>
        <ParticipantTile trackRef={main} className="min-h-0 flex-1" />
        <div
          className={cn(
            'grid shrink-0 gap-2',
            isDesktop ? 'w-60 auto-rows-min grid-cols-1 overflow-y-auto' : 'h-24 auto-cols-[9rem] grid-flow-col overflow-x-auto'
          )}
        >
          {rest.map((ref) => (
            <ParticipantTile
              key={ref.participant.identity}
              trackRef={ref}
              compact
              className={isDesktop ? 'aspect-video w-full' : 'h-full'}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('grid size-full min-h-0 auto-rows-fr gap-2', gridClass(cameras.length, isDesktop))}>
      {cameras.map((ref) => (
        <ParticipantTile key={ref.participant.identity} trackRef={ref} className="size-full" />
      ))}
    </div>
  )
}
