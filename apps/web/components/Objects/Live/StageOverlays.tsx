'use client'

import { useMemo, useState } from 'react'
import { isTrackReference, useConnectionState, useTracks } from '@livekit/components-react'
import { ConnectionState, Track } from 'livekit-client'
import { AnimatePresence, motion } from 'motion/react'
import { BarChart3, GraduationCap, Loader2, MonitorUp, Video } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useLivePolls, useLiveQuiz } from '@/hooks/queries/useLive'
import { setLiveStageFocus, type StageFocus } from '@services/live/live'
import { useClassroom } from './ClassroomContext'
import { formatClock, serverOffsetMs } from './liveMath'
import { liveErrorKey } from './liveErrors'
import { useStageFocus } from './Stage'
import { useCountdown } from './useCountdown'

/** Floating emoji reactions rising over the stage. */
export function ReactionsOverlay() {
  const { reactions } = useClassroom()
  return (
    <div className="pointer-events-none absolute bottom-4 end-4 h-64 w-24 overflow-hidden" aria-hidden>
      <AnimatePresence>
        {reactions.map((reaction, index) => (
          <motion.div
            key={reaction.id}
            initial={{ y: 0, opacity: 0, scale: 0.6 }}
            animate={{ y: -200, opacity: [0, 1, 1, 0], scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.6, ease: 'easeOut' }}
            className="absolute bottom-0 flex flex-col items-center"
            style={{ insetInlineEnd: `${(index * 17) % 56}px` }}
          >
            <span className="text-3xl drop-shadow">{reaction.emoji}</span>
            {reaction.name && (
              <span className="max-w-24 truncate rounded-full bg-black/50 px-1.5 text-[10px] text-white">{reaction.name}</span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/** Learners: an unanswered open poll is surfaced over the stage. */
export function PollPrompt() {
  const { t } = useTranslation()
  const { sessionUuid, isStaff, panelOpen, tab, openPanel } = useClassroom()
  const { data: polls } = useLivePolls(sessionUuid)
  const { data: quiz } = useLiveQuiz(sessionUuid)
  const quizWaiting = quiz?.status === 'running' && quiz.current && !quiz.current.closed && quiz.current.my_answer === null
  if (isStaff || quizWaiting || (panelOpen && tab === 'polls')) return null
  const pending = polls?.find((p) => p.status === 'open' && p.my_vote === null)
  if (!pending) return null
  return (
    <div className="absolute inset-x-3 bottom-3 flex justify-center sm:inset-x-auto sm:start-4 sm:bottom-4">
      <button
        type="button"
        onClick={() => openPanel('polls')}
        className="flex w-full max-w-sm items-center gap-3 rounded-2xl bg-white p-3 text-start shadow-xl ring-1 ring-black/5"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BarChart3 className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-primary">{t('live.polls.prompt_label')}</span>
          <span className="block truncate text-sm font-medium text-neutral-900">{pending.question}</span>
        </span>
        <span className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
          {t('live.polls.vote')}
        </span>
      </button>
    </div>
  )
}

export function ConnectionBanner() {
  const { t } = useTranslation()
  const state = useConnectionState()
  if (state !== ConnectionState.Reconnecting && state !== ConnectionState.SignalReconnecting) return null
  return (
    <div
      role="status"
      className="absolute inset-x-0 top-3 z-10 mx-auto flex w-fit items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-sm font-medium text-neutral-900 shadow-lg"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {t('live.connection.reconnecting')}
    </div>
  )
}

/** Lecturer: while a screen is shared, switch the room between the
 * presentation and the lecturer's camera on the main stage. */
export function StageFocusToggle() {
  const { t } = useTranslation()
  const { isStaff, sessionUuid, accessToken } = useClassroom()
  const focus = useStageFocus()
  const [pending, setPending] = useState(false)
  const shares = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false })
  const sharing = shares.some((ref) => isTrackReference(ref) && !ref.publication.isMuted)
  if (!isStaff || !sharing) return null

  const choose = async (next: StageFocus) => {
    if (next === focus || pending) return
    setPending(true)
    try {
      await setLiveStageFocus(sessionUuid, next, accessToken)
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setPending(false)
    }
  }

  const options: { id: StageFocus; icon: typeof MonitorUp; label: string }[] = [
    { id: 'presentation', icon: MonitorUp, label: t('live.stage.focus_presentation') },
    { id: 'camera', icon: Video, label: t('live.stage.focus_camera') },
  ]
  return (
    <div
      role="radiogroup"
      aria-label={t('live.stage.focus_label')}
      className="absolute start-3 top-3 z-10 flex gap-1 rounded-full bg-black/60 p-1 text-white backdrop-blur"
    >
      {options.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={focus === id}
          disabled={pending}
          onClick={() => choose(id)}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition',
            focus === id ? 'bg-white text-neutral-900' : 'text-white/80 hover:text-white'
          )}
        >
          <Icon className="size-4" aria-hidden /> {label}
        </button>
      ))}
    </div>
  )
}

/** Learners: an open quiz question they haven't answered, over the stage. */
export function QuizPrompt() {
  const { t } = useTranslation()
  const { sessionUuid, isStaff, panelOpen, tab, openPanel } = useClassroom()
  const { data: quiz, dataUpdatedAt } = useLiveQuiz(sessionUuid)
  const offset = useMemo(() => serverOffsetMs(quiz?.server_time, dataUpdatedAt), [quiz?.server_time, dataUpdatedAt])
  const running = quiz?.status === 'running' ? quiz : null
  const seconds = useCountdown(running?.question_deadline, offset)
  if (isStaff || !running?.current || (panelOpen && tab === 'quiz')) return null
  const question = running.current
  if (question.closed || question.my_answer !== null || !seconds) return null
  return (
    <div className="absolute inset-x-3 bottom-3 z-10 flex justify-center sm:inset-x-auto sm:start-4 sm:bottom-4">
      <button
        type="button"
        onClick={() => openPanel('quiz')}
        className="flex w-full max-w-sm items-center gap-3 rounded-2xl bg-white p-3 text-start shadow-xl ring-2 ring-primary"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <GraduationCap className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-primary">
            {t('live.quiz.prompt_label', { n: question.index + 1, total: running.question_count })}
          </span>
          <span className="block truncate text-sm font-medium text-neutral-900">{question.text}</span>
        </span>
        <span className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold tabular-nums text-primary-foreground">
          {formatClock(seconds)}
        </span>
      </button>
    </div>
  )
}
