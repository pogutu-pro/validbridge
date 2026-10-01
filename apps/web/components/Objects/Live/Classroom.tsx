'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from '@livekit/components-react'
import { DisconnectReason, MediaDeviceFailure, VideoPresets, type RoomOptions } from 'livekit-client'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from 'usehooks-ts'
import { useLiveClassroom, useLiveAccessToken } from '@/hooks/queries/useLive'
import { endLiveSession, isStaffRole, type LiveClassroom, type LiveJoin } from '@services/live/live'
import {
  ClassroomContext,
  type ClassroomContextValue,
  type FloatingReaction,
  type PanelTab,
  type UnreadTab,
} from './ClassroomContext'
import { MobilePanelTabs, MobileSheet, SidePanel } from './ClassroomPanels'
import ControlBar from './ControlBar'
import Stage from './Stage'
import { ConnectionBanner, PollPrompt, QuizPrompt, ReactionsOverlay, StageFocusToggle } from './StageOverlays'
import TopBar from './TopBar'
import { useClassroomEvents } from './useClassroomEvents'
import { useRoomMeta } from './roomMetadata'
import { useClassroom } from './ClassroomContext'
import { useConnectionTelemetry } from './connectionTelemetry'
import { AnalyticsEvent, useVBAnalytics } from '@services/analytics'

export type ExitReason = 'left' | 'ended' | 'removed' | 'duplicate' | 'failed'

export interface MediaChoices {
  audio: boolean
  video: boolean
}

// Built once: tuned for one lecturer broadcasting to ~100 mostly-silent learners.
const ROOM_OPTIONS: RoomOptions = {
  // Only download video that is actually rendered, at the size it's rendered.
  adaptiveStream: true,
  // Publishers stop encoding simulcast layers nobody is watching.
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
  },
  disconnectOnPageLeave: true,
}

function exitReasonFor(reason?: DisconnectReason): ExitReason {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
      return 'left'
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return 'ended'
    case DisconnectReason.PARTICIPANT_REMOVED:
      return 'removed'
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'duplicate'
    default:
      return 'failed'
  }
}

const REACTION_TTL_MS = 3000
const MAX_REACTIONS = 12

function ClassroomShell({
  sessionUuid,
  initialClassroom,
  onExit,
}: {
  sessionUuid: string
  initialClassroom: LiveClassroom
  onExit: (_reason: ExitReason) => void
}) {
  const room = useRoomContext()
  const accessToken = useLiveAccessToken()
  useConnectionTelemetry(sessionUuid)
  // Client-only (loaded with ssr:false), so the query can be read synchronously.
  const isDesktop = useMediaQuery('(min-width: 1024px)', { initializeWithValue: true })
  // Keeps session status (READY → LIVE) and moderation state fresh.
  const { data } = useLiveClassroom(sessionUuid, { pollWhileWaiting: true })
  const classroom = data ?? initialClassroom

  // Desktop opens with the panel docked; mobile keeps the video full width.
  const [panelOpen, setPanelOpen] = useState(isDesktop)
  const [tab, setTab] = useState<PanelTab>('chat')
  const [unread, setUnread] = useState<Record<UnreadTab, number>>({ chat: 0, questions: 0, polls: 0, quiz: 0 })
  const [reactions, setReactions] = useState<FloatingReaction[]>([])

  // Unread counts only accrue while a tab is hidden (see useClassroomEvents),
  // so showing a tab is the one place they reset.
  const openPanel = useCallback(
    (next?: PanelTab) => {
      const shown = next ?? tab
      if (next) setTab(next)
      setPanelOpen(true)
      if (shown === 'chat' || shown === 'questions' || shown === 'polls' || shown === 'quiz') {
        setUnread((prev) => (prev[shown] ? { ...prev, [shown]: 0 } : prev))
      }
    },
    [tab]
  )
  const closePanel = useCallback(() => setPanelOpen(false), [])
  const bumpUnread = useCallback((key: UnreadTab) => setUnread((prev) => ({ ...prev, [key]: prev[key] + 1 })), [])
  const pushReaction = useCallback((reaction: Omit<FloatingReaction, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setReactions((prev) => [...prev.slice(-(MAX_REACTIONS - 1)), { ...reaction, id }])
    window.setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), REACTION_TTL_MS)
  }, [])

  const leave = useCallback(() => {
    void room.disconnect()
  }, [room])

  const endForEveryone = useCallback(async () => {
    await endLiveSession(sessionUuid, accessToken)
    await room.disconnect()
    onExit('ended')
  }, [sessionUuid, accessToken, room, onExit])

  const value: ClassroomContextValue = useMemo(
    () => ({
      sessionUuid,
      classroom,
      role: classroom.role,
      isStaff: isStaffRole(classroom.role),
      userUuid: classroom.user_uuid,
      accessToken,
      isDesktop,
      panelOpen,
      tab,
      openPanel,
      closePanel,
      unread,
      bumpUnread,
      reactions,
      pushReaction,
      leave,
      endForEveryone,
    }),
    [sessionUuid, classroom, accessToken, isDesktop, panelOpen, tab, openPanel, closePanel, unread, bumpUnread, reactions, pushReaction, leave, endForEveryone]
  )

  return (
    <ClassroomContext.Provider value={value}>
      <ClassroomEvents />
      <RecordingNotice />
      <TopBar />
      <div className="flex min-h-0 flex-1 gap-4 px-2 lg:px-4">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Stage isDesktop={isDesktop} />
            <ConnectionBanner />
            <ReactionsOverlay />
            <StageFocusToggle />
            <QuizPrompt />
            <PollPrompt />
          </div>
          {!isDesktop && (
            <div className="shrink-0 pt-2">
              <MobilePanelTabs />
            </div>
          )}
        </main>
        {isDesktop && panelOpen && <SidePanel />}
      </div>
      <ControlBar />
      {!isDesktop && <MobileSheet />}
    </ClassroomContext.Provider>
  )
}

function ClassroomEvents() {
  useClassroomEvents()
  return null
}

/** Tell everyone (not just whoever pressed Record) when recording starts,
 * including people who join a lesson that is already being recorded. */
function RecordingNotice() {
  const { t } = useTranslation()
  const { isStaff } = useClassroom()
  const { recording } = useRoomMeta()
  const announced = useRef(false)
  useEffect(() => {
    if (recording && !announced.current && !isStaff) {
      toast(t('live.recording.notice'), { icon: '⏺️', duration: 6000 })
    }
    announced.current = recording
  }, [recording, isStaff, t])
  return null
}

export default function Classroom({
  sessionUuid,
  classroom,
  connection,
  choices,
  onExit,
}: {
  sessionUuid: string
  classroom: LiveClassroom
  connection: LiveJoin
  choices: MediaChoices
  onExit: (_reason: ExitReason) => void
}) {
  const { t } = useTranslation()
  const { track } = useVBAnalytics('live')
  // A disconnect can be reported more than once (error + disconnected); only
  // the first one decides what the user sees.
  const exited = useRef(false)
  const connected = useRef(false)
  const exit = useCallback(
    (reason: ExitReason) => {
      if (exited.current) return
      exited.current = true
      onExit(reason)
    },
    [onExit]
  )

  const onDeviceFailure = useCallback(
    (failure?: MediaDeviceFailure, kind?: 'audioinput' | 'videoinput' | 'audiooutput') => {
      const device = kind === 'videoinput' ? 'camera' : 'microphone'
      const key =
        failure === MediaDeviceFailure.PermissionDenied
          ? `live.devices.${device}_denied`
          : failure === MediaDeviceFailure.NotFound
            ? `live.devices.${device}_missing`
            : failure === MediaDeviceFailure.DeviceInUse
              ? `live.devices.${device}_busy`
              : `live.devices.${device}_unavailable`
      toast.error(t(key))
    },
    [t]
  )

  return (
    <LiveKitRoom
      serverUrl={connection.server_url}
      token={connection.token}
      connect
      options={ROOM_OPTIONS}
      audio={choices.audio}
      video={choices.video}
      onConnected={() => {
        connected.current = true
      }}
      onDisconnected={(reason) => {
        if (connected.current && exitReasonFor(reason) === 'failed' && !exited.current) {
          track(AnalyticsEvent.LiveConnectionFailed, {
            session_uuid: sessionUuid,
            phase: 'in_lesson',
            reason: reason === undefined ? 'unknown' : DisconnectReason[reason],
          })
        }
        exit(exitReasonFor(reason))
      }}
      // LiveKitRoom also reports failures to publish the initial mic/camera
      // here. Those are device problems (surfaced via onMediaDeviceFailure),
      // not a reason to leave the lesson — only a failed connect is fatal.
      onError={(error) => {
        if (connected.current) return
        if (!exited.current) {
          // Name only (e.g. ConnectionError): messages can carry the server URL.
          track(AnalyticsEvent.LiveConnectionFailed, { session_uuid: sessionUuid, phase: 'connect', reason: error?.name ?? 'unknown' })
        }
        exit('failed')
      }}
      onMediaDeviceFailure={onDeviceFailure}
      // The room is dark like a meeting app; panels and dialogs stay light.
      className="fixed inset-0 flex flex-col bg-[#202124]"
      style={{ zIndex: 'var(--z-sticky)' }}
    >
      <ClassroomShell sessionUuid={sessionUuid} initialClassroom={classroom} onExit={exit} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  )
}
