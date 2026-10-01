'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePreviewTracks } from '@livekit/components-react'
import { Track, VideoPresets, type LocalVideoTrack } from 'livekit-client'
import { CalendarClock, Loader2, Mic, MicOff, Video, VideoOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { isStaffRole, type LiveClassroom } from '@services/live/live'
import type { MediaChoices } from './Classroom'
import { deviceErrorKey } from './ControlBar'
import LiveBridgeBrand from './LiveBridgeBrand'
import { initials, roleLabelKey } from './participantUtils'

function VideoPreview({ track }: { track: LocalVideoTrack }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return <video ref={ref} muted playsInline className="size-full -scale-x-100 object-cover" />
}

function Toggle({
  on,
  label,
  disabled,
  onClick,
  children,
}: {
  on: boolean
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-12 items-center justify-center rounded-full shadow-lg transition disabled:opacity-40',
        on ? 'bg-white text-neutral-900 hover:bg-neutral-100' : 'bg-red-600 text-white hover:bg-red-700'
      )}
    >
      {children}
    </button>
  )
}

/**
 * Device check before entering. Lecturers start with camera + microphone on;
 * learners start with both off (they can opt in, if the lecturer allows).
 */
export default function PreJoin({
  classroom,
  displayName,
  primaryLabel,
  busy,
  onJoin,
}: {
  classroom: LiveClassroom
  displayName: string
  primaryLabel: string
  busy: boolean
  onJoin: (_choices: MediaChoices) => void
}) {
  const { t } = useTranslation()
  const staff = isStaffRole(classroom.role)
  const mediaAllowed = staff || classroom.media_allowed
  const [audio, setAudio] = useState(staff)
  const [video, setVideo] = useState(staff)
  const [micError, setMicError] = useState<string | null>(null)
  const [camError, setCamError] = useState<string | null>(null)

  // Separate preview requests so a failure is attributed to the right device.
  const audioOptions = useMemo(() => ({ audio: audio && mediaAllowed, video: false }), [audio, mediaAllowed])
  const videoOptions = useMemo(
    () => ({ audio: false, video: video && mediaAllowed ? { resolution: VideoPresets.h720.resolution } : false }),
    [video, mediaAllowed]
  )
  usePreviewTracks(audioOptions, (error) => {
    setMicError(deviceErrorKey('microphone', error))
    setAudio(false)
  })
  const videoTracks = usePreviewTracks(videoOptions, (error) => {
    setCamError(deviceErrorKey('camera', error))
    setVideo(false)
  })
  const videoTrack = videoTracks?.find((track) => track.kind === Track.Kind.Video) as LocalVideoTrack | undefined

  const { session } = classroom
  const scheduled = new Date(session.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="fixed inset-0 flex flex-col overflow-y-auto bg-background" style={{ zIndex: 'var(--z-sticky)' }}>
      <header className="flex h-16 shrink-0 items-center px-4 sm:px-6">
        <LiveBridgeBrand />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-10">
        <div className="grid w-full max-w-5xl items-center gap-6 lg:grid-cols-[1.35fr_1fr] lg:gap-10">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#202124] shadow-xl">
            {videoTrack ? (
              <VideoPreview track={videoTrack} />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-3 text-neutral-400">
                <span className="flex size-20 items-center justify-center rounded-full bg-neutral-700 text-2xl font-semibold text-white">
                  {initials(displayName)}
                </span>
                <span className="text-sm">{t('live.prejoin.camera_off')}</span>
              </div>
            )}
            <span className="absolute start-4 top-4 rounded-md bg-black/50 px-2 py-1 text-sm font-medium text-white">{displayName}</span>
            <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
              <Toggle
                on={audio}
                disabled={!mediaAllowed}
                label={t(audio ? 'live.controls.mute' : 'live.controls.unmute')}
                onClick={() => {
                  setMicError(null)
                  setAudio(!audio)
                }}
              >
                {audio ? <Mic className="size-5" /> : <MicOff className="size-5" />}
              </Toggle>
              <Toggle
                on={video}
                disabled={!mediaAllowed}
                label={t(video ? 'live.controls.stop_camera' : 'live.controls.start_camera')}
                onClick={() => {
                  setCamError(null)
                  setVideo(!video)
                }}
              >
                {video ? <Video className="size-5" /> : <VideoOff className="size-5" />}
              </Toggle>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <p className="text-3xl font-normal tracking-tight text-neutral-900">{t('live.prejoin.ready')}</p>
              <h1 className="mt-3 text-lg font-semibold text-neutral-900">{session.title}</h1>
              <span className="mt-2 inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                {t(roleLabelKey(classroom.role))}
              </span>
              <p className="mt-1 text-sm text-neutral-500">{classroom.course_name}</p>
              <p className="mt-3 inline-flex items-center gap-2 text-sm text-neutral-600">
                <CalendarClock className="size-4 text-neutral-400" aria-hidden /> {scheduled}
              </p>
            </div>

            {(micError || camError) && (
              <div className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-800" role="alert">
                {micError && <p>{t(micError)}</p>}
                {camError && <p>{t(camError)}</p>}
              </div>
            )}

            <p className="text-sm leading-relaxed text-neutral-600">
              {t(!mediaAllowed ? 'live.prejoin.media_disabled' : staff ? 'live.prejoin.staff_hint' : 'live.prejoin.learner_hint')}
            </p>

            <button
              type="button"
              onClick={() => onJoin({ audio: audio && mediaAllowed, video: video && mediaAllowed })}
              disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-semibold text-primary-foreground shadow-md transition hover:bg-primary/90 hover:shadow-lg disabled:opacity-60 sm:w-auto sm:px-10"
            >
              {busy && <Loader2 className="size-5 animate-spin" />}
              {primaryLabel}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
