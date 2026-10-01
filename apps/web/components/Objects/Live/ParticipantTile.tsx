'use client'

import {
  VideoTrack,
  isTrackReference,
  useIsMuted,
  useIsSpeaking,
  useParticipantAttributes,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { Hand, MicOff, MonitorUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { HAND_ATTRIBUTE } from '@services/live/live'
import { avatarColor, initials, participantName, participantRole, roleLabelKey } from './participantUtils'

/**
 * One video tile, Meet-style: dark tile, coloured initials when the camera is
 * off, a name chip bottom-left, mic state top-right, an outline while
 * speaking, and a Teams-style raised-hand badge.
 */
export default function ParticipantTile({
  trackRef,
  className,
  compact = false,
}: {
  trackRef: TrackReferenceOrPlaceholder
  className?: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const participant = trackRef.participant
  const speaking = useIsSpeaking(participant)
  const { attributes } = useParticipantAttributes({ participant })
  const videoMuted = useIsMuted(trackRef)
  const micMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
    publication: participant.getTrackPublication(Track.Source.Microphone),
  })

  const isScreen = trackRef.source === Track.Source.ScreenShare
  const showVideo = isTrackReference(trackRef) && !videoMuted
  const role = participantRole(participant)
  const name = participantName(participant)
  const handUp = !!attributes?.[HAND_ATTRIBUTE]

  return (
    <div
      className={cn(
        'relative isolate flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-xl bg-[#2b2d31] transition-shadow duration-150',
        isScreen && 'bg-black',
        className
      )}
    >
      {showVideo ? (
        <VideoTrack
          trackRef={trackRef}
          className={cn(
            'size-full',
            isScreen ? 'object-contain' : 'object-cover',
            participant.isLocal && !isScreen && '-scale-x-100'
          )}
        />
      ) : (
        <div
          className={cn(
            'flex items-center justify-center rounded-full font-medium text-white shadow-inner',
            compact ? 'size-11 text-base' : 'size-20 text-3xl sm:size-24 sm:text-4xl'
          )}
          style={{ backgroundColor: avatarColor(participant.identity) }}
          aria-hidden
        >
          {initials(name)}
        </div>
      )}

      {/* Speaking outline sits above the video. */}
      {speaking && !isScreen && (
        <span className="pointer-events-none absolute inset-0 rounded-xl ring-[3px] ring-inset ring-primary" aria-hidden />
      )}

      {handUp && (
        <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-[11px] font-semibold text-neutral-900 shadow">
          <Hand className="size-3.5" aria-hidden />
          {!compact && t('live.participants.hand_raised')}
        </span>
      )}

      {!isScreen && micMuted && (
        <span
          className="absolute end-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/55 text-white"
          aria-label={t('live.controls.mic_off')}
        >
          <MicOff className="size-3.5" />
        </span>
      )}

      <div className="pointer-events-none absolute bottom-2 start-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-white backdrop-blur-sm">
        {isScreen && <MonitorUp className="size-3.5 shrink-0" aria-hidden />}
        <span className={cn('truncate font-medium', compact ? 'text-[11px]' : 'text-xs sm:text-[13px]')}>
          {isScreen ? t('live.stage.presenting', { name }) : name}
          {participant.isLocal && !isScreen && ` (${t('live.common.you')})`}
        </span>
        {!isScreen && role !== 'learner' && !compact && (
          <span className="shrink-0 rounded bg-primary px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">
            {t(roleLabelKey(role))}
          </span>
        )}
      </div>
    </div>
  )
}
