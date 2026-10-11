import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'
import { getAPIUrl } from '@services/config/config'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function startCourse(course_uuid: string, org_slug: string,access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}trail/add_course/${course_uuid}`,
    RequestBodyWithAuthHeader('POST', null, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function removeCourse(course_uuid: string, org_slug: string,access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}trail/remove_course/${course_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function markActivityAsComplete(
  org_slug: string,
  course_uuid: string,
  activity_uuid: string,access_token:any
) {
  const result: any = await fetch(
    `${getAPIUrl()}trail/add_activity/${activity_uuid}`,
    RequestBodyWithAuthHeader('POST', null, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export type LessonQuizVerdict = {
  passed: boolean
  correct: number
  total: number
  // Per question. `explanation` is only present when it was answered correctly.
  results?: { question_id: string; correct: boolean; explanation?: string | null }[]
}

/**
 * Submit a lesson's quiz for judging. The server holds the answer key, scores
 * the answers, and completes the lesson on a pass, which opens the next one.
 */
export async function submitLessonQuiz(
  activity_uuid: string,
  answers: { question_id: string; answer_id: string }[],
  access_token: any
): Promise<LessonQuizVerdict> {
  const result: any = await fetch(
    `${getAPIUrl()}activities/${activity_uuid}/quiz/submit`,
    RequestBodyWithAuthHeader('POST', { answers }, null, access_token)
  )
  return errorHandling(result)
}

export type QuizQuestionVerdict = { correct: boolean; explanation?: string | null }

/**
 * Instant feedback for one question. The server holds the answer key, so a wrong
 * answer reveals nothing and a right one returns the explanation. Does not
 * complete the lesson; submitLessonQuiz does that.
 */
export async function checkLessonQuizQuestion(
  activity_uuid: string,
  question_id: string,
  answer_ids: string[],
  access_token: any
): Promise<QuizQuestionVerdict> {
  const result: any = await fetch(
    `${getAPIUrl()}activities/${activity_uuid}/quiz/check`,
    RequestBodyWithAuthHeader('POST', { question_id, answer_ids }, null, access_token)
  )
  return errorHandling(result)
}

export async function unmarkActivityAsComplete(
  org_slug: string,
  course_uuid: string,
  activity_uuid: string,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}trail/remove_activity/${activity_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateActivityContent(
  activity_uuid: string,
  content: any,
  access_token: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const result = await fetch(
      `${getAPIUrl()}activities/${activity_uuid}`,
      RequestBodyWithAuthHeader('PUT', { content }, null, access_token)
    )

    if (!result.ok) {
      const errorData = await result.json().catch(() => ({}))
      return {
        success: false,
        error: errorData.detail || `HTTP error ${result.status}`,
      }
    }

    const data = await result.json()
    return { success: true, data }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    }
  }
}
