import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

/*
 Sequential chapter progression.

 Mirrors the API contract in `src/services/courses/progression.py`. The types
 are deliberately duplicated rather than imported from a shared schema package
 because this repo has no cross-app type generation, and a loose `any` here
 would let a renamed field reach a learner as an unexplained lock.
*/

export type ProgressionRequirement = 'submitted' | 'passed'

export type ProgressionPolicy = {
  enabled?: boolean
  require_pass?: boolean
  never_block?: boolean
}

export type BlockingAssessment = {
  assignment_uuid: string
  title: string
  chapter_id: number
  state: 'pending' | 'failed'
}

export type ChapterGate = {
  chapter_id: number
  locked: boolean
  reason: string | null
  message: string | null
  blocking: BlockingAssessment[]
  prerequisite_chapter_ids: number[]
}

export type CourseProgression = {
  course_id: number
  enabled: boolean
  require_pass: boolean
  never_block: boolean
  chapters: ChapterGate[]
}

/**
 * Fetches progression state for the signed-in learner.
 *
 * Returns null when the course has no policy configured. Callers should treat
 * that as "nothing is gated" and render normally — the endpoint already reports
 * every chapter as unlocked in that case, so `enabled` is only needed to decide
 * whether to show UI at all.
 */
export async function getCourseProgression(
  course_id: number,
  access_token: string,
  next?: any
): Promise<CourseProgression | null> {
  const result = await fetch(
    `${getAPIUrl()}chapters/course/${course_id}/progression`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  return errorHandling(result)
}
