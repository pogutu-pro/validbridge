'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BarChart3, Check, Loader2, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useLivePolls } from '@/hooks/queries/useLive'
import { queryKeys } from '@lib/query/keys'
import { closeLivePoll, createLivePoll, voteLivePoll, type LivePoll } from '@services/live/live'
import { useClassroom } from '../ClassroomContext'
import { liveErrorKey } from '../liveErrors'
import { formatClock } from '../liveMath'
import { useCountdown } from '../useCountdown'
import PanelState from './PanelState'
import { useCanInteract } from './useCanInteract'

const MAX_OPTIONS = 6
const DURATIONS = [0, 30, 60, 120, 300]

function NewPollForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { sessionUuid, accessToken } = useClassroom()
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [duration, setDuration] = useState<number>(0)
  const [saving, setSaving] = useState(false)
  const filled = options.map((o) => o.trim()).filter(Boolean)
  const valid = question.trim().length > 0 && filled.length >= 2

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      await createLivePoll(sessionUuid, question.trim(), filled, accessToken, duration || null)
      await qc.invalidateQueries({ queryKey: queryKeys.live.polls(sessionUuid) })
      onDone()
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-3">
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value.slice(0, 300))}
        placeholder={t('live.polls.question_placeholder')}
        aria-label={t('live.polls.question_placeholder')}
        className="h-11 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      {options.map((option, index) => (
        <div key={index} className="flex gap-2">
          <input
            value={option}
            onChange={(e) => setOptions(options.map((o, i) => (i === index ? e.target.value.slice(0, 120) : o)))}
            placeholder={t('live.polls.option_placeholder', { n: index + 1 })}
            aria-label={t('live.polls.option_placeholder', { n: index + 1 })}
            className="h-11 flex-1 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          {options.length > 2 && (
            <button
              type="button"
              onClick={() => setOptions(options.filter((_, i) => i !== index))}
              aria-label={t('live.polls.remove_option')}
              className="flex size-11 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ))}
      <label className="flex items-center justify-between gap-3 text-sm text-neutral-700">
        {t('live.polls.duration')}
        <select
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-primary"
        >
          {DURATIONS.map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds ? formatClock(seconds) : t('live.polls.no_limit')}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between gap-2">
        {options.length < MAX_OPTIONS ? (
          <button
            type="button"
            onClick={() => setOptions([...options, ''])}
            className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            <Plus className="size-4" /> {t('live.polls.add_option')}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className="h-10 rounded-lg px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
            {t('live.common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('live.polls.launch')}
          </button>
        </div>
      </div>
    </div>
  )
}

function PollCard({ poll }: { poll: LivePoll }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { sessionUuid, accessToken, isStaff } = useClassroom()
  const blockedReason = useCanInteract()
  const [busy, setBusy] = useState<number | 'close' | null>(null)
  const seconds = useCountdown(poll.status === 'open' ? poll.closes_at : null)
  // The server closes the poll at closes_at; show it closed right away and
  // fetch the final state.
  const expired = seconds === 0
  const open = poll.status === 'open' && !expired
  const showResults = poll.counts !== null
  useEffect(() => {
    if (!expired || poll.status !== 'open') return
    const id = window.setTimeout(() => qc.invalidateQueries({ queryKey: queryKeys.live.polls(sessionUuid) }), 800)
    return () => window.clearTimeout(id)
  }, [expired, poll.status, qc, sessionUuid])

  const replace = (updated: LivePoll) =>
    qc.setQueryData<LivePoll[]>(queryKeys.live.polls(sessionUuid), (prev) =>
      (prev ?? []).map((p) => (p.poll_uuid === updated.poll_uuid ? updated : p))
    )

  const vote = async (index: number) => {
    setBusy(index)
    try {
      replace(await voteLivePoll(sessionUuid, poll.poll_uuid, index, accessToken))
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setBusy(null)
    }
  }

  const close = async () => {
    setBusy('close')
    try {
      replace(await closeLivePoll(sessionUuid, poll.poll_uuid, accessToken))
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={cn('rounded-xl border p-3', open ? 'border-primary/30 bg-white shadow-sm' : 'border-neutral-200 bg-neutral-50')}>
      <div className="mb-3 flex items-start gap-2">
        <p className="flex-1 text-sm font-semibold text-neutral-900">{poll.question}</p>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
            open ? 'bg-primary/10 text-primary' : 'bg-neutral-200 text-neutral-600'
          )}
        >
          {open && seconds !== null ? formatClock(seconds) : t(open ? 'live.polls.open' : 'live.polls.closed')}
        </span>
      </div>
      <div className="space-y-2">
        {poll.options.map((option, index) => {
          const count = poll.counts?.[index] ?? 0
          const percent = poll.total_votes ? Math.round((count / poll.total_votes) * 100) : 0
          const chosen = poll.my_vote === index
          const canVote = open && !isStaff && !blockedReason
          return (
            <button
              key={index}
              type="button"
              disabled={!canVote || busy !== null}
              onClick={() => vote(index)}
              aria-pressed={chosen}
              className={cn(
                'relative isolate flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-lg border px-3 py-2 text-start text-sm transition',
                chosen ? 'border-primary ring-1 ring-primary' : 'border-neutral-200',
                canVote && 'hover:border-primary/60',
                !canVote && 'cursor-default'
              )}
            >
              {showResults && (
                <span
                  className={cn('absolute inset-y-0 start-0 -z-0', chosen ? 'bg-primary/15' : 'bg-neutral-100')}
                  style={{ width: `${percent}%` }}
                  aria-hidden
                />
              )}
              <span className="relative flex-1 text-neutral-800">{option}</span>
              {busy === index && <Loader2 className="relative size-4 animate-spin text-neutral-400" />}
              {chosen && busy !== index && <Check className="relative size-4 text-primary" />}
              {showResults && <span className="relative text-xs font-semibold text-neutral-600">{percent}%</span>}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
        <span>{t('live.polls.votes', { count: poll.total_votes })}</span>
        {isStaff && open && (
          <button
            type="button"
            onClick={close}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-3 font-medium text-neutral-700 hover:bg-neutral-100"
          >
            {busy === 'close' && <Loader2 className="size-3.5 animate-spin" />}
            {t('live.polls.close')}
          </button>
        )}
        {!isStaff && open && poll.my_vote === null && <span>{t('live.polls.results_after_vote')}</span>}
      </div>
    </div>
  )
}

export default function PollsPanel() {
  const { t } = useTranslation()
  const { sessionUuid, isStaff } = useClassroom()
  const blockedReason = useCanInteract()
  const { data: polls = [], isLoading, isError, refetch } = useLivePolls(sessionUuid, { staffLiveResults: isStaff })
  const [creating, setCreating] = useState(false)

  return (
    <div className="h-full min-h-0 space-y-3 overflow-y-auto p-3">
      {isStaff &&
        (creating ? (
          <NewPollForm onDone={() => setCreating(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!!blockedReason}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 text-sm font-medium text-neutral-700 hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <Plus className="size-4" /> {t('live.polls.new')}
          </button>
        ))}
      {isLoading ? (
        <PanelState loading />
      ) : isError ? (
        <PanelState title={t('live.errors.generic')} action={{ label: t('live.common.retry'), onClick: () => refetch() }} />
      ) : polls.length === 0 ? (
        !creating && (
          <PanelState
            icon={<BarChart3 className="size-5" />}
            title={t('live.polls.empty_title')}
            description={t(isStaff ? 'live.polls.empty_staff' : 'live.polls.empty_description')}
          />
        )
      ) : (
        polls.map((poll) => <PollCard key={poll.poll_uuid} poll={poll} />)
      )}
    </div>
  )
}
