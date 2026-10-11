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
  // Called once every question has been answered correctly, with the right
  // selection for each. For learners this completes the lesson on the server.
  onFinished: (_selections: { question_id: string; answer_id: string }[]) => Promise<void>
}

const letter = (i: number) => String.fromCharCode('A'.charCodeAt(0) + i)

// One question per page. The learner picks an answer and is told straight away:
// a correct answer shows the explanation as a success message and unlocks the
// next question; a wrong one lets them try again without revealing the answer.
// Finishing the last question completes the quiz.
export default function QuizTakeView({ questions, checkQuestion, onFinished }: QuizTakeViewProps) {
  const [index, setIndex] = React.useState(0)
  const [selected, setSelected] = React.useState<string[]>([])
  const [verdict, setVerdict] = React.useState<QuestionVerdict | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [finishing, setFinishing] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [rightSelections, setRightSelections] = React.useState<Record<string, string[]>>({})

  const total = questions.length
  const question = questions[index]

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
  const answeredRight = !!verdict?.correct
  const answeredWrong = !!verdict && !verdict.correct
  const isLast = index === total - 1

  const runCheck = async (ids: string[]) => {
    setChecking(true)
    try {
      const result = await checkQuestion(question, ids)
      setVerdict(result)
      if (result.correct) {
        setRightSelections((prev) => ({ ...prev, [question.question_id]: ids }))
      }
    } catch (error: any) {
      toast.error(error?.message || 'Could not check your answer. Try again.')
    } finally {
      setChecking(false)
    }
  }

  const choose = (answerId: string) => {
    if (checking || answeredRight) return
    if (isSingle) {
      setSelected([answerId])
      void runCheck([answerId])
      return
    }
    setVerdict(null)
    setSelected((prev) =>
      prev.includes(answerId) ? prev.filter((id) => id !== answerId) : [...prev, answerId]
    )
  }

  const next = async () => {
    if (!isLast) {
      setIndex(index + 1)
      setSelected([])
      setVerdict(null)
      return
    }
    setFinishing(true)
    try {
      const selections = Object.entries(rightSelections).flatMap(([question_id, ids]) =>
        ids.map((answer_id) => ({ question_id, answer_id }))
      )
      await onFinished(selections)
      setDone(true)
    } catch (error: any) {
      toast.error(error?.message || 'Could not finish the quiz. Try again.')
    } finally {
      setFinishing(false)
    }
  }

  const restart = () => {
    setIndex(0)
    setSelected([])
    setVerdict(null)
    setRightSelections({})
    setDone(false)
  }

  if (done) {
    return (
      <div className="rounded-xl bg-emerald-50 px-5 py-6 text-emerald-900 nice-shadow" role="status">
        <div className="flex items-center gap-2 text-xl font-bold">
          <CheckCircle weight="duotone" size={26} className="text-emerald-600" />
          Quiz complete
        </div>
        <p className="mt-2 text-base">
          You answered all {total} questions correctly. You can move on to the next lesson.
        </p>
        <button
          onClick={restart}
          className="mt-4 text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950"
        >
          Take it again
        </button>
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
            style={{ width: `${((index + (answeredRight ? 1 : 0)) / total) * 100}%` }}
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
        {question.answers.map((answer, i) => {
          const isSelected = selected.includes(answer.answer_id)
          const showRight = answeredRight && isSelected
          const showWrong = answeredWrong && isSelected
          return (
            <button
              key={answer.answer_id}
              type="button"
              role={isSingle ? 'radio' : 'checkbox'}
              aria-checked={isSelected}
              disabled={checking || answeredRight}
              onClick={() => choose(answer.answer_id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-start text-lg transition-colors outline-none',
                'focus-visible:ring-2 focus-visible:ring-neutral-400',
                showRight && 'border-emerald-400 bg-emerald-50 text-emerald-900',
                showWrong && 'border-red-300 bg-red-50 text-red-800',
                !showRight && !showWrong && isSelected && 'border-neutral-800 bg-white',
                !showRight && !showWrong && !isSelected && 'border-neutral-200 bg-white hover:bg-neutral-100',
                (checking || answeredRight) && 'cursor-default'
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

      {!isSingle && !answeredRight && (
        <button
          onClick={() => void runCheck(selected)}
          disabled={checking || selected.length === 0}
          className="mt-4 rounded-lg bg-neutral-900 px-4 py-2.5 text-base font-semibold text-white transition-colors hover:bg-neutral-800 disabled:opacity-40"
        >
          {checking ? 'Checking…' : 'Check answer'}
        </button>
      )}

      {/* Result */}
      {answeredRight && (
        <div role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-base text-emerald-900">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle weight="duotone" size={20} className="text-emerald-600" />
            Correct!
          </div>
          {verdict?.explanation && <p className="mt-1 leading-relaxed">{verdict.explanation}</p>}
          <button
            onClick={() => void next()}
            disabled={finishing}
            className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-base font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {finishing ? 'Finishing…' : isLast ? 'Finish quiz' : 'Next question'}
          </button>
        </div>
      )}
      {answeredWrong && (
        <div role="status" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-red-700">
          Not quite. {isSingle ? 'Pick another answer.' : 'Change your selection and check again.'}
        </div>
      )}
    </div>
  )
}
