'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParticipants } from '@livekit/components-react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, Clock, GraduationCap, Loader2, Trophy, X, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useLiveQuiz, useLiveQuizSources } from '@/hooks/queries/useLive'
import { queryKeys } from '@lib/query/keys'
import {
  answerLiveQuiz,
  finishLiveQuiz,
  nextLiveQuizQuestion,
  startLiveQuiz,
  type LiveQuiz,
  type LiveQuizQuestion,
} from '@services/live/live'
import { useClassroom } from '../ClassroomContext'
import { formatClock, percentOf, serverOffsetMs } from '../liveMath'
import { liveErrorKey } from '../liveErrors'
import { participantRole } from '../participantUtils'
import { useCountdown } from '../useCountdown'
import PanelState from './PanelState'
import { useCanInteract } from './useCanInteract'

const SECONDS_CHOICES = [15, 20, 30, 45, 60, 90, 120]

function useSetQuiz() {
  const qc = useQueryClient()
  const { sessionUuid } = useClassroom()
  return (quiz: LiveQuiz | null) => qc.setQueryData(queryKeys.live.quiz(sessionUuid), quiz)
}

/** Remaining seconds for the running question, corrected for clock skew. */
function useQuestionClock(quiz: LiveQuiz, receivedAt: number) {
  const offset = useMemo(() => serverOffsetMs(quiz.server_time, receivedAt), [quiz.server_time, receivedAt])
  return useCountdown(quiz.status === 'running' ? quiz.question_deadline : null, offset)
}

function Countdown({ seconds, total }: { seconds: number | null; total: number }) {
  const { t } = useTranslation()
  if (seconds === null) return null
  const urgent = seconds <= 5
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs font-medium">
        <span className={cn('inline-flex items-center gap-1', urgent ? 'text-red-600' : 'text-neutral-500')}>
          <Clock className="size-3.5" aria-hidden />
          {seconds > 0 ? formatClock(seconds) : t('live.quiz.times_up')}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', urgent ? 'bg-red-500' : 'bg-primary')}
          style={{ width: `${Math.min(100, (seconds / Math.max(total, 1)) * 100)}%` }}
        />
      </div>
    </div>
  )
}

function StatLine({ stats }: { stats: NonNullable<LiveQuizQuestion['stats']> }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      {[
        { label: t('live.quiz.answered'), value: stats.answered },
        { label: t('live.quiz.correct'), value: stats.correct, tone: 'text-emerald-600' },
        { label: t('live.quiz.incorrect'), value: stats.incorrect, tone: 'text-red-600' },
        { label: t('live.quiz.average'), value: stats.average_percent === null ? '–' : `${stats.average_percent}%` },
      ].map((item) => (
        <div key={item.label} className="rounded-lg bg-neutral-50 px-1 py-2">
          <p className={cn('text-base font-semibold text-neutral-900', item.tone)}>{item.value}</p>
          <p className="text-[10px] leading-tight text-neutral-500">{item.label}</p>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lecturer
// ---------------------------------------------------------------------------

function QuizLauncher() {
  const { t } = useTranslation()
  const { sessionUuid, accessToken, isStaff } = useClassroom()
  const blockedReason = useCanInteract()
  const setQuiz = useSetQuiz()
  const { data: sources, isLoading, isError, refetch } = useLiveQuizSources(sessionUuid, isStaff)
  const [selected, setSelected] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(30)
  const [starting, setStarting] = useState(false)

  const launch = async () => {
    if (!selected) return
    setStarting(true)
    try {
      setQuiz(await startLiveQuiz(sessionUuid, selected, seconds, accessToken))
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setStarting(false)
    }
  }

  if (isLoading) return <PanelState loading />
  if (isError) return <PanelState title={t('live.errors.generic')} action={{ label: t('live.common.retry'), onClick: () => refetch() }} />
  if (!sources?.length) {
    return (
      <PanelState
        icon={<GraduationCap className="size-5" />}
        title={t('live.quiz.no_sources_title')}
        description={t('live.quiz.no_sources_description')}
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('live.quiz.choose')}</p>
      <div className="space-y-2" role="radiogroup" aria-label={t('live.quiz.choose')}>
        {sources.map((source) => (
          <button
            key={source.source_id}
            type="button"
            role="radio"
            aria-checked={selected === source.source_id}
            onClick={() => setSelected(source.source_id)}
            className={cn(
              'flex w-full items-start gap-3 rounded-xl border p-3 text-start transition',
              selected === source.source_id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-neutral-200 hover:border-neutral-300'
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-neutral-900">{source.title}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                {t(source.origin === 'assignment' ? 'live.quiz.from_assignment' : 'live.quiz.from_lesson')}
                {source.context && source.context !== source.title && ` · ${source.context}`}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
              {t('live.quiz.question_count', { count: source.question_count })}
            </span>
          </button>
        ))}
      </div>
      <label className="flex items-center justify-between gap-3 text-sm text-neutral-700">
        {t('live.quiz.time_per_question')}
        <select
          value={seconds}
          onChange={(e) => setSeconds(Number(e.target.value))}
          className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-primary"
        >
          {SECONDS_CHOICES.map((s) => (
            <option key={s} value={s}>
              {formatClock(s)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={launch}
        disabled={!selected || starting || !!blockedReason}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {starting && <Loader2 className="size-4 animate-spin" />}
        {t('live.quiz.launch')}
      </button>
    </div>
  )
}

function StaffRunning({ quiz, receivedAt }: { quiz: LiveQuiz; receivedAt: number }) {
  const { t } = useTranslation()
  const { sessionUuid, accessToken } = useClassroom()
  const setQuiz = useSetQuiz()
  const participants = useParticipants()
  const seconds = useQuestionClock(quiz, receivedAt)
  const [busy, setBusy] = useState<'next' | 'finish' | null>(null)
  const current = quiz.current
  const learnersHere = participants.filter((p) => participantRole(p) === 'learner').length
  const last = quiz.current_index + 1 >= quiz.question_count

  const act = async (kind: 'next' | 'finish') => {
    setBusy(kind)
    try {
      setQuiz(
        kind === 'next'
          ? await nextLiveQuizQuestion(sessionUuid, quiz.quiz_uuid, accessToken)
          : await finishLiveQuiz(sessionUuid, quiz.quiz_uuid, accessToken)
      )
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setBusy(null)
    }
  }

  if (!current) return null
  const answered = current.stats?.answered ?? 0
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          {t('live.quiz.question_of', { n: quiz.current_index + 1, total: quiz.question_count })}
        </p>
        <p className="text-xs text-neutral-500">{t('live.quiz.answered_of', { answered, total: learnersHere })}</p>
      </div>
      <Countdown seconds={seconds} total={quiz.seconds_per_question} />
      <p className="text-base font-semibold text-neutral-900">{current.text}</p>
      <ul className="space-y-2">
        {current.options.map((option) => {
          const pct = percentOf(option.picks ?? 0, answered)
          return (
            <li key={option.option_uuid} className="relative isolate overflow-hidden rounded-lg border border-neutral-200 px-3 py-2.5">
              <span
                className={cn('absolute inset-y-0 start-0 -z-10', option.correct ? 'bg-emerald-100' : 'bg-neutral-100')}
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span className="flex items-center gap-2 text-sm">
                {option.correct ? <Check className="size-4 shrink-0 text-emerald-600" aria-label={t('live.quiz.correct_answer')} /> : <span className="size-4 shrink-0" />}
                <span className="flex-1 text-neutral-800">{option.text}</span>
                <span className="text-xs font-semibold text-neutral-600">{option.picks ?? 0}</span>
              </span>
            </li>
          )
        })}
      </ul>
      {current.stats && <StatLine stats={current.stats} />}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => act('finish')}
          disabled={busy !== null}
          className="h-11 rounded-xl px-4 text-sm font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50 disabled:opacity-50"
        >
          {t('live.quiz.end_quiz')}
        </button>
        <button
          type="button"
          onClick={() => act('next')}
          disabled={busy !== null}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy === 'next' && <Loader2 className="size-4 animate-spin" />}
          {t(last ? 'live.quiz.show_results' : 'live.quiz.next_question')}
        </button>
      </div>
    </div>
  )
}

function Results({ quiz }: { quiz: LiveQuiz }) {
  const { t } = useTranslation()
  const { isStaff } = useClassroom()
  const results = quiz.results
  if (!results) return null
  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 p-3">
      <div className="flex items-center gap-2">
        <Trophy className="size-4 text-primary" aria-hidden />
        <p className="flex-1 truncate text-sm font-semibold text-neutral-900">{quiz.title}</p>
        <span className="text-[11px] font-medium uppercase text-neutral-400">{t('live.quiz.results')}</span>
      </div>
      {!isStaff && results.my_percent !== null && (
        <div className="rounded-xl bg-primary/5 p-3 text-center">
          <p className="text-3xl font-semibold text-primary">{results.my_percent}%</p>
          <p className="text-xs text-neutral-600">
            {t('live.quiz.your_score', { correct: results.my_correct ?? 0, total: quiz.question_count })}
          </p>
        </div>
      )}
      <p className="text-sm text-neutral-700">
        {t('live.quiz.summary', {
          count: results.participants,
          correct: results.correct,
          incorrect: results.incorrect,
          average: results.average_percent ?? 0,
        })}
      </p>
      {isStaff && quiz.questions && (
        <ol className="space-y-1.5">
          {quiz.questions.map((question) => (
            <li key={question.index} className="flex items-center gap-2 text-xs">
              <span className="w-5 shrink-0 text-neutral-400">{question.index + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-neutral-700">{question.text}</span>
              <span className="shrink-0 font-medium text-emerald-600">{question.stats?.correct ?? 0}</span>
              <span className="text-neutral-300">/</span>
              <span className="shrink-0 text-neutral-500">{question.stats?.answered ?? 0}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Learner
// ---------------------------------------------------------------------------

function LearnerQuestion({ quiz, receivedAt }: { quiz: LiveQuiz; receivedAt: number }) {
  const { t } = useTranslation()
  const { sessionUuid, accessToken } = useClassroom()
  const setQuiz = useSetQuiz()
  const qc = useQueryClient()
  const seconds = useQuestionClock(quiz, receivedAt)
  const question = quiz.current as LiveQuizQuestion
  const [picked, setPicked] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const answered = question.my_answer !== null
  const timeUp = seconds === 0
  const closed = question.closed
  const multiple = question.response_type === 'multiple'

  // (Keyed by quiz + question index by the parent, so each question starts
  // with a fresh selection.)

  // When the clock runs out, fetch the reveal (correct answers + your result).
  useEffect(() => {
    if (!timeUp || closed) return
    const id = window.setTimeout(
      () => qc.invalidateQueries({ queryKey: queryKeys.live.quiz(sessionUuid) }),
      600
    )
    return () => window.clearTimeout(id)
  }, [timeUp, closed, qc, sessionUuid])

  const toggle = (optionId: string) => {
    if (answered || closed || timeUp) return
    setPicked((prev) =>
      multiple ? (prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId]) : [optionId]
    )
  }

  const submit = async () => {
    if (!picked.length) return
    setSubmitting(true)
    try {
      setQuiz(await answerLiveQuiz(sessionUuid, quiz.quiz_uuid, question.index, picked, accessToken))
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
      qc.invalidateQueries({ queryKey: queryKeys.live.quiz(sessionUuid) })
    } finally {
      setSubmitting(false)
    }
  }

  const chosen = new Set(question.my_answer ?? picked)
  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">
        {t('live.quiz.question_of', { n: question.index + 1, total: quiz.question_count })}
      </p>
      {!closed && <Countdown seconds={seconds} total={quiz.seconds_per_question} />}
      <p className="text-base font-semibold text-neutral-900">{question.text}</p>
      {multiple && !closed && <p className="text-xs text-neutral-500">{t('live.quiz.select_all')}</p>}
      <div className="space-y-2" role={multiple ? 'group' : 'radiogroup'}>
        {question.options.map((option) => {
          const isChosen = chosen.has(option.option_uuid)
          const revealCorrect = closed && option.correct
          const revealWrong = closed && isChosen && !option.correct
          return (
            <button
              key={option.option_uuid}
              type="button"
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={isChosen}
              disabled={answered || closed || timeUp}
              onClick={() => toggle(option.option_uuid)}
              className={cn(
                'flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-start text-sm transition',
                revealCorrect && 'border-emerald-500 bg-emerald-50',
                revealWrong && 'border-red-400 bg-red-50',
                !closed && isChosen && 'border-primary bg-primary/5 ring-1 ring-primary',
                !closed && !isChosen && 'border-neutral-200 hover:border-neutral-300',
                (answered || timeUp) && !closed && !isChosen && 'opacity-60'
              )}
            >
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center border',
                  multiple ? 'rounded' : 'rounded-full',
                  isChosen ? 'border-primary bg-primary text-white' : 'border-neutral-300'
                )}
                aria-hidden
              >
                {isChosen && <Check className="size-3" />}
              </span>
              <span className="flex-1 text-neutral-800">{option.text}</span>
              {revealCorrect && <CheckCircle2 className="size-4 text-emerald-600" aria-label={t('live.quiz.correct_answer')} />}
              {revealWrong && <XCircle className="size-4 text-red-500" aria-hidden />}
            </button>
          )
        })}
      </div>

      {closed ? (
        <div
          className={cn(
            'flex items-center gap-2 rounded-xl p-3 text-sm font-medium',
            question.my_correct ? 'bg-emerald-50 text-emerald-700' : answered ? 'bg-red-50 text-red-700' : 'bg-neutral-100 text-neutral-600'
          )}
          role="status"
        >
          {question.my_correct ? <CheckCircle2 className="size-4" /> : answered ? <X className="size-4" /> : <Clock className="size-4" />}
          {t(question.my_correct ? 'live.quiz.you_got_it' : answered ? (question.my_score ? 'live.quiz.partly_right' : 'live.quiz.not_quite') : 'live.quiz.no_answer')}
          {question.stats && (
            <span className="ms-auto text-xs font-normal">
              {t('live.quiz.class_correct', { percent: percentOf(question.stats.correct, question.stats.answered) })}
            </span>
          )}
        </div>
      ) : answered ? (
        <p className="rounded-xl bg-neutral-100 p-3 text-center text-sm font-medium text-neutral-700" role="status">
          {t('live.quiz.locked_in')}
        </p>
      ) : timeUp ? (
        <p className="rounded-xl bg-neutral-100 p-3 text-center text-sm text-neutral-600" role="status">
          {t('live.quiz.times_up')}
        </p>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!picked.length || submitting}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {t('live.quiz.submit')}
        </button>
      )}
    </div>
  )
}

export default function QuizPanel() {
  const { t } = useTranslation()
  const { sessionUuid, isStaff } = useClassroom()
  const { data: quiz, isLoading, isError, refetch, dataUpdatedAt } = useLiveQuiz(sessionUuid)

  let body
  if (isLoading) body = <PanelState loading />
  else if (isError) body = <PanelState title={t('live.errors.generic')} action={{ label: t('live.common.retry'), onClick: () => refetch() }} />
  else if (isStaff) {
    body =
      quiz?.status === 'running' ? (
        <StaffRunning quiz={quiz} receivedAt={dataUpdatedAt} />
      ) : (
        <div className="space-y-4">
          {quiz?.status === 'finished' && <Results quiz={quiz} />}
          <QuizLauncher />
        </div>
      )
  } else if (!quiz) {
    body = <PanelState icon={<GraduationCap className="size-5" />} title={t('live.quiz.empty_title')} description={t('live.quiz.empty_description')} />
  } else if (quiz.status === 'running' && quiz.current) {
    body = <LearnerQuestion key={`${quiz.quiz_uuid}-${quiz.current.index}`} quiz={quiz} receivedAt={dataUpdatedAt} />
  } else {
    body = <Results quiz={quiz} />
  }

  return <div className="h-full min-h-0 overflow-y-auto p-3">{body}</div>
}
