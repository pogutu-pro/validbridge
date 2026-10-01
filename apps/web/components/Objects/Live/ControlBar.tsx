'use client'

import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import {
  useLocalParticipant,
  useLocalParticipantPermissions,
  useParticipantAttributes,
  useParticipants,
  useTrackToggle,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { useQueryClient } from '@tanstack/react-query'
import {
  CircleDot,
  Hand,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  MoreVertical,
  PhoneOff,
  Settings,
  SmilePlus,
  Square,
  Video,
  VideoOff,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { queryKeys } from '@lib/query/keys'
import {
  HAND_ATTRIBUTE,
  LIVE_REACTIONS,
  sendLiveReaction,
  setLiveHand,
  startLiveRecording,
  stopLiveRecording,
} from '@services/live/live'
import { useClassroom, type PanelTab, type UnreadTab } from './ClassroomContext'
import { useVisibleTabs } from './ClassroomPanels'
import DeviceSettingsDialog from './DeviceSettingsDialog'
import { liveErrorKey } from './liveErrors'
import { useRoomMeta } from './roomMetadata'

// ParticipantPermission.canPublishSources uses LiveKit's TrackSource enum.
const SOURCE_CAMERA = 1
const SOURCE_MICROPHONE = 2
const SOURCE_SCREEN_SHARE = 3

function useCanPublish(source: number): boolean {
  const permissions = useLocalParticipantPermissions()
  if (!permissions?.canPublish) return false
  const sources = permissions.canPublishSources ?? []
  return sources.length === 0 || sources.includes(source as never)
}

/** Friendly, never-raw text for a getUserMedia/getDisplayMedia failure. */
export function deviceErrorKey(kind: 'microphone' | 'camera' | 'screen', error: unknown): string | null {
  const name = (error as { name?: string })?.name
  if (kind === 'screen' && (name === 'NotAllowedError' || name === 'AbortError')) return null // picker cancelled
  if (name === 'NotAllowedError' || name === 'SecurityError') return `live.devices.${kind}_denied`
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `live.devices.${kind}_missing`
  if (name === 'NotReadableError') return `live.devices.${kind}_busy`
  return `live.devices.${kind}_unavailable`
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Tone = 'default' | 'off' | 'active' | 'highlight'

const TONES: Record<Tone, string> = {
  // Meet-like: grey round buttons on the dark room; red when a device is off.
  default: 'bg-[#3c4043] text-white hover:bg-[#4a4e52]',
  off: 'bg-red-500 text-white hover:bg-red-600',
  active: 'bg-primary text-primary-foreground hover:bg-primary/90',
  highlight: 'bg-amber-400 text-neutral-900 hover:bg-amber-300',
}

interface ControlButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string
  active?: boolean
  tone?: Tone
  showLabel: boolean
  badge?: number
  size?: 'md' | 'sm'
  children: ReactNode
}

// forwardRef + prop spreading so Radix triggers (asChild) can wrap it directly.
const ControlButton = forwardRef<HTMLButtonElement, ControlButtonProps>(function ControlButton(
  { label, active = true, tone = 'default', showLabel, badge, size = 'md', children, className, ...rest },
  ref
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={cn('group relative flex shrink-0 flex-col items-center gap-1 outline-none disabled:opacity-40', showLabel && 'w-16', className)}
      {...rest}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-white/70',
          size === 'md' ? 'size-12' : 'size-10',
          TONES[tone]
        )}
      >
        {children}
      </span>
      {showLabel && <span className="max-w-full truncate text-[11px] font-medium text-white/80">{label}</span>}
      {!!badge && badge > 0 && (
        <span className="absolute -end-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white ring-2 ring-[#202124]">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
  if (showLabel) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
})

function MicButton({ showLabel }: { showLabel: boolean }) {
  const { t } = useTranslation()
  const allowed = useCanPublish(SOURCE_MICROPHONE)
  const { enabled, toggle, pending } = useTrackToggle({
    source: Track.Source.Microphone,
    onDeviceError: (error) => {
      const key = deviceErrorKey('microphone', error)
      if (key) toast.error(t(key))
    },
  })
  return (
    <ControlButton
      label={t(!allowed ? 'live.controls.mic_not_allowed' : enabled ? 'live.controls.mute' : 'live.controls.unmute')}
      onClick={() => void toggle()}
      active={enabled}
      tone={enabled ? 'default' : 'off'}
      disabled={pending || !allowed}
      showLabel={showLabel}
    >
      {enabled ? <Mic className="size-5" /> : <MicOff className="size-5" />}
    </ControlButton>
  )
}

function CameraButton({ showLabel }: { showLabel: boolean }) {
  const { t } = useTranslation()
  const allowed = useCanPublish(SOURCE_CAMERA)
  const { enabled, toggle, pending } = useTrackToggle({
    source: Track.Source.Camera,
    onDeviceError: (error) => {
      const key = deviceErrorKey('camera', error)
      if (key) toast.error(t(key))
    },
  })
  return (
    <ControlButton
      label={t(!allowed ? 'live.controls.camera_not_allowed' : enabled ? 'live.controls.stop_camera' : 'live.controls.start_camera')}
      onClick={() => void toggle()}
      active={enabled}
      tone={enabled ? 'default' : 'off'}
      disabled={pending || !allowed}
      showLabel={showLabel}
    >
      {enabled ? <Video className="size-5" /> : <VideoOff className="size-5" />}
    </ControlButton>
  )
}

export function screenShareSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices
}

function ScreenShareButton({ showLabel }: { showLabel: boolean }) {
  const { t } = useTranslation()
  const allowed = useCanPublish(SOURCE_SCREEN_SHARE)
  const { enabled, toggle, pending } = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: { audio: true, selfBrowserSurface: 'exclude' },
    onDeviceError: (error) => {
      const key = deviceErrorKey('screen', error)
      if (key) toast.error(t(key))
    },
  })
  if (!allowed || !screenShareSupported()) return null
  return (
    <ControlButton
      label={t(enabled ? 'live.controls.stop_share' : 'live.controls.share')}
      onClick={() => void toggle()}
      active={enabled}
      tone={enabled ? 'active' : 'default'}
      disabled={pending}
      showLabel={showLabel}
    >
      {enabled ? <MonitorX className="size-5" /> : <MonitorUp className="size-5" />}
    </ControlButton>
  )
}

/** Lecturer: start/stop recording. Shown only where recording is set up. */
function RecordButton({ showLabel }: { showLabel: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { classroom, sessionUuid, accessToken } = useClassroom()
  const { recording } = useRoomMeta()
  const [pending, setPending] = useState(false)
  if (!classroom.recording_available) return null

  const toggle = async () => {
    setPending(true)
    try {
      if (recording) {
        await stopLiveRecording(sessionUuid, accessToken)
        toast.success(t('live.recording.stopped_toast'))
      } else {
        await startLiveRecording(sessionUuid, accessToken)
        toast.success(t('live.recording.started_toast'))
      }
      qc.invalidateQueries({ queryKey: queryKeys.live.classroom(sessionUuid) })
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <ControlButton
      label={t(recording ? 'live.recording.stop' : 'live.recording.start')}
      onClick={toggle}
      active={recording}
      tone={recording ? 'off' : 'default'}
      disabled={pending}
      showLabel={showLabel}
    >
      {recording ? <Square className="size-4 fill-current" /> : <CircleDot className="size-5" />}
    </ControlButton>
  )
}

function HandButton({ showLabel }: { showLabel: boolean }) {
  const { t } = useTranslation()
  const { sessionUuid, accessToken } = useClassroom()
  const { localParticipant } = useLocalParticipant()
  const { attributes } = useParticipantAttributes({ participant: localParticipant })
  const raised = !!attributes?.[HAND_ATTRIBUTE]
  const [pending, setPending] = useState(false)

  const toggle = async () => {
    setPending(true)
    try {
      await setLiveHand(sessionUuid, !raised, accessToken)
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <ControlButton
      label={t(raised ? 'live.controls.lower_hand' : 'live.controls.raise_hand')}
      onClick={toggle}
      active={raised}
      tone={raised ? 'highlight' : 'default'}
      disabled={pending}
      showLabel={showLabel}
    >
      <Hand className="size-5" />
    </ControlButton>
  )
}

function ReactionsButton({ showLabel }: { showLabel: boolean }) {
  const { t } = useTranslation()
  const { sessionUuid, accessToken } = useClassroom()
  const [open, setOpen] = useState(false)

  const react = async (emoji: string) => {
    setOpen(false)
    try {
      await sendLiveReaction(sessionUuid, emoji, accessToken)
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ControlButton label={t('live.controls.react')} showLabel={showLabel} active={open} tone={open ? 'active' : 'default'}>
          <SmilePlus className="size-5" />
        </ControlButton>
      </PopoverTrigger>
      {/* Teams-style: a single row of reactions floating above the bar. */}
      <PopoverContent side="top" sideOffset={12} className="w-auto rounded-full border-0 bg-[#3c4043] p-1.5 shadow-2xl">
        <div className="flex gap-0.5">
          {LIVE_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => react(emoji)}
              className="flex size-11 items-center justify-center rounded-full text-2xl transition hover:scale-125 hover:bg-white/10 active:scale-95"
              aria-label={t('live.controls.react_with', { emoji })}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Red "hang up" button. Lecturers choose between leaving and ending for all. */
function LeaveButton({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const { isStaff, leave, endForEveryone } = useClassroom()
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)

  const face = (
    <span className="flex flex-col items-center gap-1">
      <span
        className={cn(
          'flex h-12 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600',
          compact ? 'w-12' : 'w-16'
        )}
      >
        <PhoneOff className="size-5" />
      </span>
      {compact && <span className="text-[11px] font-medium text-white/80">{t('live.controls.leave')}</span>}
    </span>
  )

  const end = async () => {
    setEnding(true)
    try {
      await endForEveryone()
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
      setEnding(false)
    }
  }

  if (!isStaff) {
    return (
      <button type="button" onClick={leave} aria-label={t('live.controls.leave')} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/70">
        {face}
      </button>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={t('live.controls.leave_or_end')} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          {face}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-64">
          <DropdownMenuItem onSelect={leave} className="flex-col items-start gap-0.5 py-2">
            <span className="font-medium">{t('live.controls.leave_lesson')}</span>
            <span className="text-xs text-neutral-500">{t('live.controls.leave_lesson_hint')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirmEnd(true)} className="flex-col items-start gap-0.5 py-2 text-red-600 focus:text-red-600">
            <span className="font-medium">{t('live.controls.end_lesson')}</span>
            <span className="text-xs text-neutral-500">{t('live.controls.end_lesson_hint')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirmEnd} onOpenChange={(open) => !ending && setConfirmEnd(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('live.controls.end_confirm_title')}</DialogTitle>
            <DialogDescription>{t('live.controls.end_confirm_description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setConfirmEnd(false)} disabled={ending} className="h-10 rounded-lg px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
              {t('live.common.cancel')}
            </button>
            <button
              type="button"
              onClick={end}
              disabled={ending}
              className="h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {t('live.controls.end_lesson')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Bar zones
// ---------------------------------------------------------------------------

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  return <span className="tabular-nums">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
}

/** Meet's bottom-right cluster: one icon per panel, with counts/unread badges. */
function PanelButtons() {
  const { t } = useTranslation()
  const { panelOpen, tab, openPanel, closePanel, unread } = useClassroom()
  const participants = useParticipants()
  const tabs = useVisibleTabs()
  return (
    <div className="flex items-center gap-1">
      {tabs.map(({ id, icon: Icon, labelKey }) => {
        const selected = panelOpen && tab === id
        const count = id in unread ? unread[id as UnreadTab] : 0
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => (selected ? closePanel() : openPanel(id as PanelTab))}
                aria-pressed={selected}
                aria-label={t(labelKey)}
                className={cn(
                  'relative flex size-11 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                  selected ? 'bg-primary/20 text-primary' : 'text-white/85 hover:bg-white/10'
                )}
              >
                <Icon className="size-5" />
                {id === 'people' && (
                  <span className="absolute -end-0.5 -top-0.5 min-w-5 rounded-full bg-[#3c4043] px-1 text-center text-[10px] font-semibold leading-5 text-white">
                    {participants.length}
                  </span>
                )}
                {count > 0 && !selected && (
                  <span className="absolute end-1.5 top-1.5 size-2.5 rounded-full bg-primary ring-2 ring-[#202124]" aria-hidden />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {t(labelKey)}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

function MoreMenu({ onSettings }: { onSettings: () => void }) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ControlButton label={t('live.controls.more')} showLabel={false}>
          <MoreVertical className="size-5" />
        </ControlButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="w-56">
        <DropdownMenuItem onSelect={onSettings}>
          <Settings className="size-4" /> {t('live.controls.settings')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function ControlBar() {
  const { t } = useTranslation()
  const { isStaff, isDesktop, classroom } = useClassroom()
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (!isDesktop) {
    // Phones: five large, labelled targets. Panels live in the tab row above.
    return (
      <TooltipProvider delayDuration={300}>
        <nav
          className="flex shrink-0 items-start justify-around gap-1 bg-[#202124] px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          aria-label={t('live.controls.label')}
        >
          <MicButton showLabel />
          <CameraButton showLabel />
          {isStaff ? <ScreenShareButton showLabel /> : <HandButton showLabel />}
          {isStaff && classroom.recording_available ? <RecordButton showLabel /> : <ReactionsButton showLabel />}
          <div className="flex w-16 justify-center">
            <LeaveButton compact />
          </div>
        </nav>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <nav className="grid h-20 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-5" aria-label={t('live.controls.label')}>
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-white/90">
          <Clock />
          <span className="h-4 w-px bg-white/25" aria-hidden />
          <span className="truncate">{classroom.session.title}</span>
        </div>
        <div className="flex items-center gap-3">
          <MicButton showLabel={false} />
          <CameraButton showLabel={false} />
          {isStaff && <ScreenShareButton showLabel={false} />}
          {!isStaff && <HandButton showLabel={false} />}
          <ReactionsButton showLabel={false} />
          {isStaff && <RecordButton showLabel={false} />}
          <MoreMenu onSettings={() => setSettingsOpen(true)} />
          <LeaveButton />
        </div>
        <div className="flex justify-end">
          <PanelButtons />
        </div>
        <DeviceSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </nav>
    </TooltipProvider>
  )
}
