'use client'
import React from 'react'
import { CheckCircle, X } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import {
  QUIZ_RESPONSE_SINGLE,
  QuizResponseType,
  resolveQuizResponseType,
} from '@/lib/quiz/modes'

export interface TakeAnswer {
  answer_id: string
  answer: string
  correct?: boolean
}

export interface TakeQuestion {
  question_id: string
  question: string
  response_type?: QuizResponseType
  answers: TakeAnswer[]
}

export interface QuestionVerdict {
  correct: boolean
  explanation?: string | null
}

interface QuizTakeViewProps {
  questions: TakeQuestion[]
  // Judge one question. For learners this asks the server, which holds the key.
  checkQuestion: (_question: TakeQuestion, _answerIds: string[]) => Promise<QuestionVerdict>
  // Called when every question was answered correctly, with the right selection
  // for each. For learners this completes the lesson on the server.
  onFinished: (_selections: { question_id: string; answer_id: string }[]) => Promise<void>
  // Go to the next lesson. Offered on the score screen once the quiz is passed.
  onNextLesson?: () => void
}

const letter = (i: number) => String.fromCharCode('A'.charCodeAt(0) + i)

// Fisher-Yates on a copy. Only the DISPLAY order changes; answer ids stay the
// same, so the server judges the same answers whatever order they were shown in.
function shuffled<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

type Outcome = { correct: boolean; answerIds: string[] }

// One question per page. Each question gets ONE try: the learner picks an answer
// and is told straight away. Right shows the explanation as a success message;
// wrong shows "Incorrect." and never reveals the answer, and the choice cannot
// be changed, so the quiz cannot be passed by clicking every option until one
// works. After the last question the learner sees their score out of the total,
// then can retake the quiz, or go to the next lesson if every answer was right.
export default function QuizTakeView({ questions, checkQuestion, onFinished, onNextLesson }: QuizTakeViewProps) {
  const [index, setIndex] = React.useState(0)
  const [selected, setSelected] = React.useState<string[]>([])
  const [checking, setChecking] = React.useState(false)
  const [finishing, setFinishing] = React.useState(false)
  const [showScore, setShowScore] = React.useState(false)
  const [outcomes, setOutcomes] = React.useState<Record<string, Outcome>>({})
  // The server's verdict for the question on screen (holds its explanation).
  const [verdictText, setVerdictText] = React.useState<QuestionVerdict | null>(null)
  // Bumped on every retake so each attempt shows the choices in a new order.
  const [attempt, setAttempt] = React.useState(0)

  const total = questions.length
  const question = questions[index]
  const outcome = question ? outcomes[question.question_id] : undefined
  const displayAnswers = React.useMemo(
    () => (question ? shuffled(question.answers) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question?.question_id, attempt]
  )

  if (total === 0) {
    return (
      <div className="rounded-xl bg-neutral-50 px-4 py-6 text-center text-base text-neutral-500 nice-shadow">
        This quiz has no questions yet.
      </div>
    )
  }

  const correctCount = (question?.answers ?? []).filter((a) => a.correct).length
  const responseType = question
    ? resolveQuizResponseType(question.response_type, correctCount)
    : QUIZ_RESPONSE_SINGLE
  const isSingle = responseType === QUIZ_RESPONSE_SINGLE
  const answered = !!outcome
  const isLast = index === total - 1

  const runCheck = async (ids: string[]) => {
    setChecking(true)
    try {
      const result = await checkQuestion(question, ids)
      setOutcomes((prev) => ({ ...prev, [question.question_id]: { correct: result.correct, answerIds: ids } }))
      setVerdictText({ correct: result.correct, explanation: result.explanation })
    } catch (error: any) {
      toast.error(error?.message || 'Could not check your answer. Try again.')
    } finally {
      setChecking(false)
    }
  }

  const choose = (answerId: string) => {
    if (checking || answered) return
    if (isSingle) {
      setSelected([answerId])
      void runCheck([answerId])
      return
    }
    setSelected((prev) =>
      prev.includes(answerId) ? prev.filter((id) => id !== answerId) : [...prev, answerId]
    )
  }

  const score = Object.values(outcomes).filter((o) => o.correct).length
  const passed = score === total

  const next = async () => {
    if (!isLast) {
      setIndex(index + 1)
      setSelected([])
      setVerdictText(null)
      return
    }
    // Last question answered: the lesson only completes when everything was right.
    if (!passed) {
      setShowScore(true)
      return
    }
    setFinishing(true)
    try {
      const selections = Object.entries(outcomes).flatMap(([question_id, o]) =>
        o.answerIds.map((answer_id) => ({ question_id, answer_id }))
      )
      await onFinished(selections)
      setShowScore(true)
    } catch (error: any) {
      toast.error(error?.message || 'Could not finish the quiz. Try again.')
    } finally {
      setFinishing(false)
    }
  }

  const retake = () => {
    setIndex(0)
    setSelected([])
    setVerdictText(null)
    setOutcomes({})
    setShowScore(false)
    setAttempt((a) => a + 1)
  }

  if (showScore) {
    const pct = Math.round((score / total) * 100)
    const toReview = questions
      .map((q, i) => (outcomes[q.question_id]?.correct ? null : i + 1))
      .filter((n): n is number => n !== null)
    return (
      <div
        role="status"
        className={cn(
          'rounded-xl px-5 py-6 nice-shadow',
          passed ? 'bg-emerald-50 text-emerald-900' : 'bg-neutral-50 text-neutral-900'
        )}
      >
        <p className="text-sm font-semibold uppercase tracking-widest opacity-60">Quiz result</p>
        <p className="mt-1 text-4xl font-bold">
          {score} <span className="text-neutral-400">/ {total}</span>
        </p>
        <div className="mt-3 h-2 w-full rounded-full bg-black/10" aria-hidden>
          <div
            className={cn('h-2 rounded-full transition-all', passed ? 'bg-emerald-500' : 'bg-neutral-700')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-3 text-lg">
          {passed
            ? 'Well done. You answered every question correctly.'
            : 'You need every question correct to unlock the next lesson.'}
        </p>
        {!passed && toReview.length > 0 && (
          <p className="mt-1 text-base text-neutral-600">
            Review question{toReview.length > 1 ? 's' : ''} {toReview.join(', ')}.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          {passed && onNextLesson && (
            <button
              onClick={onNextLesson}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-base font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              Next lesson
            </button>
          )}
          <button
            onClick={retake}
            className={cn(
              'rounded-lg px-5 py-2.5 text-base font-semibold transition-colors',
              passed
                ? 'border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100'
                : 'bg-neutral-900 text-white hover:bg-neutral-800'
            )}
          >
            Retake quiz
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-neutral-50 px-5 py-5 nice-shadow">
      {/* Progress */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between text-sm font-semibold text-neutral-500">
          <span>
            Question {index + 1} of {total}
          </span>
          {!isSingle && <span className="font-medium">Select all that apply</span>}
        </div>
        <div className="h-1.5 w-full rounded-full bg-neutral-200" aria-hidden>
          <div
            className="h-1.5 rounded-full bg-neutral-800 transition-all"
            style={{ width: `${((index + (answered ? 1 : 0)) / total) * 100}%` }}
          />
        </div>
      </div>

      <h3 className="mb-4 text-xl font-semibold leading-snug text-neutral-900 break-words">
        {question.question}
      </h3>

      {/* Choices */}
      <div
        role={isSingle ? 'radiogroup' : 'group'}
        className="space-y-2.5"
        aria-label={question.question}
      >
        {displayAnswers.map((answer, i) => {
          const isSelected = selected.includes(answer.answer_id)
          const showRight = answered && outcome?.correct && isSelected
          const showWrong = answered && !outcome?.correct && isSelected
          return (
            <button
              key={answer.answer_id}
              type="button"
              role={isSingle ? 'radio' : 'checkbox'}
              aria-checked={isSelected}
              disabled={checking || answered}
              onClick={() => choose(answer.answer_id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-start text-lg transition-colors outline-none',
                'focus-visible:ring-2 focus-visible:ring-neutral-400',
                showRight && 'border-emerald-400 bg-emerald-50 text-emerald-900',
                showWrong && 'border-red-300 bg-red-50 text-red-800',
                !showRight && !showWrong && isSelected && 'border-neutral-800 bg-white',
                !showRight && !showWrong && !isSelected && 'border-neutral-200 bg-white hover:bg-neutral-100',
                (checking || answered) && 'cursor-default'
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                  showRight
                    ? 'bg-emerald-500 text-white'
                    : showWrong
                      ? 'bg-red-500 text-white'
                      : 'bg-neutral-100 text-neutral-500'
                )}
              >
                {showRight ? <CheckCircle weight="bold" size={16} /> : showWrong ? <X weight="bold" size={16} /> : letter(i)}
              </span>
              <span className="min-w-0 break-words">{answer.answer}</span>
            </button>
          )
        })}
      </div>

      {!isSingle && !answered && (
        <button
          onClick={() => void runCheck(selected)}
          disabled={checking || selected.length === 0}
          className="mt-4 rounded-lg bg-neutral-900 px-4 py-2.5 text-base font-semibold text-white transition-colors hover:bg-neutral-800 disabled:opacity-40"
        >
          {checking ? 'Checking…' : 'Check answer'}
        </button>
      )}

      {/* Result for this question */}
      {answered && outcome?.correct && (
        <div role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-base text-emerald-900">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle weight="duotone" size={20} className="text-emerald-600" />
            Correct!
          </div>
          {verdictText?.explanation && <p className="mt-1 leading-relaxed">{verdictText.explanation}</p>}
        </div>
      )}
      {answered && !outcome?.correct && (
        <div role="status" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-base font-bold text-red-700">
          Incorrect.
        </div>
      )}
      {answered && (
        <button
          onClick={() => void next()}
          disabled={finishing}
          className="mt-4 rounded-lg bg-neutral-900 px-5 py-2.5 text-base font-semibold text-white transition-colors hover:bg-neutral-800 disabled:opacity-60"
        >
          {finishing ? 'Finishing…' : isLast ? 'See my score' : 'Next question'}
        </button>
      )}
    </div>
  )
}
