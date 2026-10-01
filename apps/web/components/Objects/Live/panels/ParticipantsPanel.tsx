'use client'

import { useMemo, useState } from 'react'
import { useParticipants } from '@livekit/components-react'
import type { Participant } from 'livekit-client'
import { Hand, Mic, MicOff, MoreVertical, Search, UserPlus, UserX, Video, VideoOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import {
  lowerLiveHand,
  muteLiveParticipant,
  removeLiveParticipant,
  setLiveMediaPermission,
} from '@services/live/live'
import { useClassroom } from '../ClassroomContext'
import InviteDialog from '../InviteDialog'
import { liveErrorKey } from '../liveErrors'
import { handRaisedAt, initials, participantName, participantRole, roleLabelKey } from '../participantUtils'

function canModerate(myRole: string, target: Participant): boolean {
  if (target.isLocal) return false
  const role = participantRole(target)
  if (role === 'instructor') return false
  if (role === 'moderator') return myRole === 'instructor'
  return true
}

function ParticipantRow({ participant, onRemove }: { participant: Participant; onRemove: (_participant: Participant) => void }) {
  const { t } = useTranslation()
  const { sessionUuid, accessToken, role: myRole } = useClassroom()
  const role = participantRole(participant)
  const name = participantName(participant)
  const hand = handRaisedAt(participant) !== null
  const micOn = participant.isMicrophoneEnabled
  const camOn = participant.isCameraEnabled
  const mediaAllowed = participant.permissions?.canPublish ?? true
  const moderatable = canModerate(myRole, participant)

  const run = async (action: () => Promise<unknown>, successKey?: string) => {
    try {
      await action()
      if (successKey) toast.success(t(successKey, { name }))
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-neutral-50">
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600">
        {initials(name)}
        {participant.isSpeaking && <span className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-white bg-emerald-500" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900">
          {name}
          {participant.isLocal && <span className="text-neutral-400"> ({t('live.common.you')})</span>}
        </p>
        {role !== 'learner' && <p className="text-[11px] font-medium text-primary">{t(roleLabelKey(role))}</p>}
        {role === 'learner' && !mediaAllowed && <p className="text-[11px] text-neutral-500">{t('live.participants.media_disabled')}</p>}
      </div>
      <div className="flex items-center gap-1.5 text-neutral-400">
        {hand && <Hand className="size-4 text-amber-500" aria-label={t('live.participants.hand_raised')} />}
        {camOn ? <Video className="size-4 text-neutral-600" aria-label={t('live.controls.camera_on')} /> : <VideoOff className="size-4" aria-label={t('live.controls.camera_off')} />}
        {micOn ? <Mic className="size-4 text-neutral-600" aria-label={t('live.controls.mic_on')} /> : <MicOff className="size-4" aria-label={t('live.controls.mic_off')} />}
      </div>
      {moderatable && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('live.participants.actions_for', { name })}
            className="flex size-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {hand && (
              <DropdownMenuItem onSelect={() => run(() => lowerLiveHand(sessionUuid, participant.identity, accessToken))}>
                <Hand className="size-4" /> {t('live.participants.lower_hand')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={!micOn}
              onSelect={() => run(() => muteLiveParticipant(sessionUuid, participant.identity, 'microphone', accessToken), 'live.participants.muted_toast')}
            >
              <MicOff className="size-4" /> {t('live.participants.mute')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!camOn}
              onSelect={() => run(() => muteLiveParticipant(sessionUuid, participant.identity, 'camera', accessToken))}
            >
              <VideoOff className="size-4" /> {t('live.participants.stop_camera')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run(
                  () => setLiveMediaPermission(sessionUuid, participant.identity, !mediaAllowed, accessToken),
                  mediaAllowed ? 'live.participants.media_revoked_toast' : 'live.participants.media_allowed_toast'
                )
              }
            >
              {mediaAllowed ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              {t(mediaAllowed ? 'live.participants.revoke_media' : 'live.participants.allow_media')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={() => onRemove(participant)}>
              <UserX className="size-4" /> {t('live.participants.remove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}

export default function ParticipantsPanel() {
  const { t } = useTranslation()
  const { sessionUuid, accessToken, isStaff, classroom } = useClassroom()
  const participants = useParticipants()
  const [inviting, setInviting] = useState(false)
  const [query, setQuery] = useState('')
  const [removing, setRemoving] = useState<Participant | null>(null)
  const [busy, setBusy] = useState(false)

  const { hands, staff, learners } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (p: Participant) => !q || participantName(p).toLowerCase().includes(q)
    const filtered = participants.filter(match)
    const byName = (a: Participant, b: Participant) => participantName(a).localeCompare(participantName(b))
    return {
      hands: filtered
        .filter((p) => handRaisedAt(p) !== null)
        .sort((a, b) => (handRaisedAt(a) ?? 0) - (handRaisedAt(b) ?? 0)),
      staff: filtered.filter((p) => participantRole(p) !== 'learner').sort(byName),
      learners: filtered.filter((p) => participantRole(p) === 'learner').sort(byName),
    }
  }, [participants, query])

  const confirmRemove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await removeLiveParticipant(sessionUuid, removing.identity, accessToken)
      toast.success(t('live.participants.removed_toast', { name: participantName(removing) }))
      setRemoving(null)
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setBusy(false)
    }
  }

  const section = (title: string, list: Participant[], key: string) =>
    list.length > 0 && (
      <section key={key}>
        <h3 className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          {title} · {list.length}
        </h3>
        <ul>
          {list.map((p) => (
            <ParticipantRow key={`${key}-${p.identity}`} participant={p} onRemove={setRemoving} />
          ))}
        </ul>
      </section>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-neutral-100 p-3">
        {isStaff && (
          <button
            type="button"
            onClick={() => setInviting(true)}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-primary/10 px-4 text-sm font-semibold text-primary hover:bg-primary/15"
          >
            <UserPlus className="size-4" /> {t('live.invite.add_people')}
          </button>
        )}
        <label className="flex h-10 items-center gap-2 rounded-lg bg-neutral-50 px-3 ring-1 ring-neutral-200 focus-within:ring-2 focus-within:ring-primary/60">
          <Search className="size-4 text-neutral-400" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('live.participants.search')}
            aria-label={t('live.participants.search')}
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      </div>
      {isStaff && inviting && (
        <InviteDialog
          session={classroom.session}
          courseUuid={classroom.course_uuid}
          courseName={classroom.course_name}
          open
          onOpenChange={setInviting}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {section(t('live.participants.hands'), hands, 'hands')}
        {section(t('live.participants.staff'), staff, 'staff')}
        {section(t('live.participants.learners'), learners, 'learners')}
        {hands.length + staff.length + learners.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-neutral-500">{t('live.participants.no_match')}</p>
        )}
      </div>

      <Dialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('live.participants.remove_title', { name: removing ? participantName(removing) : '' })}</DialogTitle>
            <DialogDescription>{t('live.participants.remove_description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setRemoving(null)} className="h-10 rounded-lg px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
              {t('live.common.cancel')}
            </button>
            <button
              type="button"
              onClick={confirmRemove}
              disabled={busy}
              className={cn('h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700', busy && 'opacity-60')}
            >
              {t('live.participants.remove')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
