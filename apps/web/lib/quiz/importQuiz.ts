import { QUIZ_RESPONSE_MULTIPLE, QUIZ_RESPONSE_SINGLE } from './modes'

export interface ImportedAnswer {
  answer_id: string
  answer: string
  correct: boolean
}

export interface ImportedQuestion {
  question_id: string
  question: string
  type: 'multiple_choice'
  response_type: 'single' | 'multiple'
  explanation?: string
  answers: ImportedAnswer[]
}

export interface ImportResult {
  questions: ImportedQuestion[]
  skipped: number
}

const asIndexes = (raw: unknown): number[] =>
  (Array.isArray(raw) ? raw : [raw]).filter(
    (n): n is number => typeof n === 'number' && Number.isInteger(n)
  )

/**
 * Turn pasted quiz JSON into Quiz block questions.
 *
 * Accepts the simple authoring shape
 *   { question, options: string[], correct: number | number[], explanation? }
 * either as a bare array or under a `questions` key, and the block's own shape
 * (`answers: [{ answer, correct }]`). Extra keys such as `stage` are ignored.
 * A question that cannot be used (no text, fewer than two options, or no valid
 * correct answer) is skipped and counted, never half-imported: a question with
 * no correct answer would be unanswerable.
 */
export function convertImportedQuiz(raw: unknown, newId: () => string): ImportResult {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).questions)
      ? (raw as any).questions
      : null
  if (!list) {
    throw new Error('Expected a list of questions, or an object with a "questions" list.')
  }

  const questions: ImportedQuestion[] = []
  let skipped = 0

  for (const item of list) {
    const text = typeof item?.question === 'string' ? item.question.trim() : ''
    let answers: ImportedAnswer[] = []

    if (Array.isArray(item?.answers)) {
      answers = item.answers
        .filter((a: any) => typeof a?.answer === 'string' && a.answer.trim())
        .map((a: any) => ({ answer_id: newId(), answer: a.answer.trim(), correct: !!a.correct }))
    } else if (Array.isArray(item?.options)) {
      const correct = new Set(asIndexes(item.correct))
      answers = item.options
        .map((o: unknown, i: number) => ({ text: typeof o === 'string' ? o.trim() : '', i }))
        .filter((o: { text: string }) => o.text)
        .map((o: { text: string; i: number }) => ({
          answer_id: newId(),
          answer: o.text,
          correct: correct.has(o.i),
        }))
    }

    const correctCount = answers.filter((a) => a.correct).length
    if (!text || answers.length < 2 || correctCount === 0) {
      skipped += 1
      continue
    }

    const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : ''
    questions.push({
      question_id: newId(),
      question: text,
      type: 'multiple_choice',
      response_type: correctCount >= 2 ? QUIZ_RESPONSE_MULTIPLE : QUIZ_RESPONSE_SINGLE,
      ...(explanation ? { explanation } : {}),
      answers,
    })
  }

  return { questions, skipped }
}
