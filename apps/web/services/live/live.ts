import { getAPIUrl } from '@services/config/config'

// ---------------------------------------------------------------------------
// Types (mirror apps/api/src/db/live_sessions.py)
// ---------------------------------------------------------------------------

export type LiveSessionStatus = 'scheduled' | 'ready' | 'live' | 'ended' | 'processing' | 'completed'
export type LiveRole = 'instructor' | 'moderator' | 'learner'

export interface LiveSession {
  id: number
  session_uuid: string
  org_id: number
  course_id: number
  activity_id: number | null
  instructor_id: number | null
  title: string
  description: string | null
  status: LiveSessionStatus
  recording_status: 'none' | 'recording' | 'processing' | 'ready' | 'failed'
  record_automatically: boolean
  publish_recordings: boolean
  scheduled_at: string
  ready_at: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
}

export interface LiveClassroom {
  session: LiveSession
  course_uuid: string
  course_name: string
  role: LiveRole
  user_uuid: string
  media_allowed: boolean
  recording_available: boolean
}

export type RecordingState = 'pending' | 'recording' | 'processing' | 'ready' | 'failed'

export interface LiveRecording {
  recording_uuid: string
  session_uuid: string
  session_title: string
  status: RecordingState
  started_at: string | null
  ended_at: string | null
  ready_at: string | null
  duration_seconds: number | null
  /** The course lesson that plays it — only once ready. */
  activity_uuid: string | null
  published: boolean | null
}

export interface LiveParticipation {
  messages: number
  questions: number
  poll_votes: number
  quiz_answers: number
  hand_raises: number
}

export interface LiveSessionReport {
  session: LiveSession
  enrolled: number
  attendees: number
  attendance_rate: number | null
  average_attendance_percent: number | null
  average_duration_seconds: number | null
  late_arrivals: number
  early_departures: number
  partial: number
  absent: number
  participating_learners: number
  participation_rate: number | null
  participation: LiveParticipation
  questions_answered: number
  polls: {
    poll_uuid: string
    question: string
    options: string[]
    counts: number[]
    total_votes: number
    response_rate: number | null
    status: string
  }[]
  quizzes: {
    quiz_uuid: string
    title: string
    question_count: number
    participants: number
    correct: number
    incorrect: number
    average_percent: number | null
    status: string
  }[]
  completed: boolean
  duration_seconds: number | null
  recordings: LiveRecording[]
  learners: {
    user_id: number
    user_uuid: string
    name: string
    attendance_status: AttendanceStatus
    attendance_percent: number | null
    duration_seconds: number
    late_by_seconds: number
    left_early_by_seconds: number
    participation: LiveParticipation
    quiz_percent: number | null
  }[]
}

export interface LiveCourseOverview {
  enrolled: number
  sessions_held: number
  sessions_upcoming: number
  average_attendance_rate: number | null
  average_attendance_percent: number | null
  average_duration_seconds: number | null
  late_arrivals: number
  early_departures: number
  total_questions: number
  total_poll_votes: number
  live_quiz_average_percent: number | null
  recordings_ready: number
  sessions: {
    session_uuid: string
    title: string
    status: LiveSessionStatus
    scheduled_at: string
    started_at: string | null
    duration_seconds: number | null
    attendees: number
    attendance_rate: number | null
    average_attendance_percent: number | null
    questions: number
    quiz_average_percent: number | null
    recording_status: LiveSession['recording_status']
  }[]
}

export interface LiveLearnerEngagement {
  user_id: number
  user_uuid: string
  name: string
  username: string
  progress_percent: number
  activities_completed: number
  activities_total: number
  assignments_submitted: number
  assignments_total: number
  assignment_average_percent: number | null
  quiz_average_percent: number | null
  live_quiz_average_percent: number | null
  live_sessions_attended: number
  live_sessions_held: number
  live_attendance_rate: number | null
  live_average_attendance_percent: number | null
  live_participation: number
  last_active_on: string | null
}

export interface LiveJoin {
  server_url: string
  token: string
  expires_at: string
  role: LiveRole
}

export interface LiveMessage {
  message_uuid: string
  kind: 'chat' | 'question'
  body: string
  status: 'open' | 'answered' | 'dismissed' | null
  author: { user_uuid: string; display_name: string; role: LiveRole } | null
  created_at: string
  answered_at: string | null
  answer: string | null
  answered_by: string | null
}

export interface LivePoll {
  poll_uuid: string
  question: string
  options: string[]
  status: 'open' | 'closed'
  created_at: string
  closed_at: string | null
  duration_seconds: number | null
  closes_at: string | null
  total_votes: number
  counts: number[] | null
  my_vote: number | null
}

export interface LiveParticipantAttendance {
  user_id: number
  user_uuid: string
  username: string
  first_name: string
  last_name: string
  role: LiveRole
  joined_at: string | null
  left_at: string | null
  duration_seconds: number
  connection_count: number
  is_connected: boolean
  attendance_percent: number | null
  late_by_seconds: number
  left_early_by_seconds: number
  attendance_status: AttendanceStatus
}

export type AttendanceStatus = 'present' | 'late' | 'left_early' | 'partial' | 'absent'

export interface LiveAbsent {
  user_id: number
  user_uuid: string
  username: string
  first_name: string
  last_name: string
}

export interface LiveAttendance {
  session_uuid: string
  status: LiveSessionStatus
  started_at: string | null
  ended_at: string | null
  session_duration_seconds: number | null
  enrolled_count: number
  attended_count: number
  summary: {
    present: number
    late: number
    left_early: number
    partial: number
    absent: number
    average_attendance_percent: number | null
  }
  participants: LiveParticipantAttendance[]
  absent: LiveAbsent[]
}

export interface LiveQuizSource {
  source_id: string
  origin: 'assignment' | 'lesson'
  title: string
  context: string | null
  question_count: number
}

export interface LiveQuizOption {
  option_uuid: string
  text: string
  correct: boolean | null
  picks: number | null
}

export interface LiveQuizStats {
  answered: number
  correct: number
  incorrect: number
  average_percent: number | null
}

export interface LiveQuizQuestion {
  index: number
  text: string
  response_type: 'single' | 'multiple'
  options: LiveQuizOption[]
  closed: boolean
  my_answer: string[] | null
  my_correct: boolean | null
  my_score: number | null
  stats: LiveQuizStats | null
}

export interface LiveQuiz {
  quiz_uuid: string
  title: string
  status: 'running' | 'finished'
  question_count: number
  current_index: number
  seconds_per_question: number
  question_deadline: string | null
  server_time: string
  current: LiveQuizQuestion | null
  questions: LiveQuizQuestion[] | null
  results: {
    participants: number
    correct: number
    incorrect: number
    average_percent: number | null
    my_percent: number | null
    my_correct: number | null
  } | null
}

export const STAFF_ROLES: LiveRole[] = ['instructor', 'moderator']
export const isStaffRole = (role?: LiveRole | null) => !!role && STAFF_ROLES.includes(role)
export const isEndedStatus = (status?: LiveSessionStatus) =>
  status === 'ended' || status === 'processing' || status === 'completed'

// ---------------------------------------------------------------------------
// Errors — callers get a code, never the server's raw text
// ---------------------------------------------------------------------------

export class LiveApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

function codeFor(status: number, detail: unknown): string {
  if (detail && typeof detail === 'object' && 'code' in detail && typeof (detail as any).code === 'string') {
    return (detail as any).code
  }
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 402) return 'PAYMENT_REQUIRED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'SLOW_DOWN'
  if (status >= 500) return 'SERVER_UNAVAILABLE'
  return 'REQUEST_FAILED'
}

async function liveRequest<T>(
  path: string,
  accessToken: string | undefined,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  let res: Response
  try {
    res = await fetch(`${getAPIUrl()}live/${path}`, {
      method: init.method ?? 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new LiveApiError(0, 'NETWORK_ERROR')
  }
  if (!res.ok) {
    let detail: unknown = null
    try {
      detail = (await res.json())?.detail
    } catch {
      /* non-JSON error body */
    }
    throw new LiveApiError(res.status, codeFor(res.status, detail))
  }
  return (await res.json()) as T
}

const s = (sessionUuid: string) => `sessions/${encodeURIComponent(sessionUuid)}`

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const listCourseLiveSessions = (courseUuid: string, token?: string) =>
  liveRequest<LiveSession[]>(`sessions?course_uuid=${encodeURIComponent(courseUuid)}`, token)

export const createLiveSession = (
  body: {
    course_uuid: string
    title: string
    description?: string
    scheduled_at: string
    activity_uuid?: string
    record_automatically?: boolean
    publish_recordings?: boolean
  },
  token?: string
) => liveRequest<LiveSession>('sessions', token, { method: 'POST', body })

export const getLiveClassroom = (sessionUuid: string, token?: string) =>
  liveRequest<LiveClassroom>(`${s(sessionUuid)}/classroom`, token)

export const startLiveSession = (sessionUuid: string, token?: string) =>
  liveRequest<LiveSession>(`${s(sessionUuid)}/start`, token, { method: 'POST' })

export const joinLiveSession = (sessionUuid: string, token?: string) =>
  liveRequest<LiveJoin>(`${s(sessionUuid)}/join`, token, { method: 'POST' })

export const endLiveSession = (sessionUuid: string, token?: string) =>
  liveRequest<LiveSession>(`${s(sessionUuid)}/end`, token, { method: 'POST' })

export const sendLiveInvitations = (
  sessionUuid: string,
  body: { emails: string[]; all_enrolled: boolean; message?: string },
  token?: string
) => liveRequest<{ queued: number }>(`${s(sessionUuid)}/invitations`, token, { method: 'POST', body })

export const getLiveAttendance = (sessionUuid: string, token?: string) =>
  liveRequest<LiveAttendance>(`${s(sessionUuid)}/attendance`, token)

// ---------------------------------------------------------------------------
// Chat + questions
// ---------------------------------------------------------------------------

export const listLiveMessages = (sessionUuid: string, kind: 'chat' | 'question', token?: string) =>
  liveRequest<LiveMessage[]>(`${s(sessionUuid)}/messages?kind=${kind}`, token)

export const sendLiveMessage = (sessionUuid: string, kind: 'chat' | 'question', body: string, token?: string) =>
  liveRequest<LiveMessage>(`${s(sessionUuid)}/messages`, token, { method: 'POST', body: { kind, body } })

export const deleteLiveMessage = (sessionUuid: string, messageUuid: string, token?: string) =>
  liveRequest<{ ok: boolean }>(`${s(sessionUuid)}/messages/${encodeURIComponent(messageUuid)}`, token, {
    method: 'DELETE',
  })

export const updateLiveQuestion = (
  sessionUuid: string,
  messageUuid: string,
  status: 'open' | 'answered' | 'dismissed',
  token?: string,
  answer?: string
) =>
  liveRequest<LiveMessage>(`${s(sessionUuid)}/questions/${encodeURIComponent(messageUuid)}`, token, {
    method: 'PATCH',
    body: answer === undefined ? { status } : { status, answer },
  })

// ---------------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------------

export const listLivePolls = (sessionUuid: string, token?: string) =>
  liveRequest<LivePoll[]>(`${s(sessionUuid)}/polls`, token)

export const createLivePoll = (
  sessionUuid: string,
  question: string,
  options: string[],
  token?: string,
  durationSeconds?: number | null
) =>
  liveRequest<LivePoll>(`${s(sessionUuid)}/polls`, token, {
    method: 'POST',
    body: { question, options, duration_seconds: durationSeconds ?? null },
  })

export const closeLivePoll = (sessionUuid: string, pollUuid: string, token?: string) =>
  liveRequest<LivePoll>(`${s(sessionUuid)}/polls/${encodeURIComponent(pollUuid)}/close`, token, { method: 'POST' })

export const voteLivePoll = (sessionUuid: string, pollUuid: string, optionIndex: number, token?: string) =>
  liveRequest<LivePoll>(`${s(sessionUuid)}/polls/${encodeURIComponent(pollUuid)}/vote`, token, {
    method: 'POST',
    body: { option_index: optionIndex },
  })

// ---------------------------------------------------------------------------
// Hand, reactions, moderation
// ---------------------------------------------------------------------------

export const setLiveHand = (sessionUuid: string, raised: boolean, token?: string) =>
  liveRequest<{ ok: boolean }>(`${s(sessionUuid)}/hand`, token, { method: 'POST', body: { raised } })

export const sendLiveReaction = (sessionUuid: string, emoji: string, token?: string) =>
  liveRequest<{ ok: boolean }>(`${s(sessionUuid)}/reactions`, token, { method: 'POST', body: { emoji } })

const p = (sessionUuid: string, identity: string) =>
  `${s(sessionUuid)}/participants/${encodeURIComponent(identity)}`

export const lowerLiveHand = (sessionUuid: string, identity: string, token?: string) =>
  liveRequest<{ ok: boolean }>(`${p(sessionUuid, identity)}/lower-hand`, token, { method: 'POST' })

export const muteLiveParticipant = (
  sessionUuid: string,
  identity: string,
  source: 'microphone' | 'camera' | 'screen_share',
  token?: string
) => liveRequest<{ ok: boolean }>(`${p(sessionUuid, identity)}/mute`, token, { method: 'POST', body: { source } })

export const setLiveMediaPermission = (sessionUuid: string, identity: string, allowed: boolean, token?: string) =>
  liveRequest<{ ok: boolean }>(`${p(sessionUuid, identity)}/media`, token, { method: 'POST', body: { allowed } })

export const removeLiveParticipant = (sessionUuid: string, identity: string, token?: string) =>
  liveRequest<{ ok: boolean }>(`${p(sessionUuid, identity)}/remove`, token, { method: 'POST' })

// ---------------------------------------------------------------------------
// Stage + live quizzes
// ---------------------------------------------------------------------------

export type StageFocus = 'presentation' | 'camera'

export const setLiveStageFocus = (sessionUuid: string, focus: StageFocus, token?: string) =>
  liveRequest<{ ok: boolean }>(`${s(sessionUuid)}/stage`, token, { method: 'POST', body: { focus } })

export const listLiveQuizSources = (sessionUuid: string, token?: string) =>
  liveRequest<LiveQuizSource[]>(`${s(sessionUuid)}/quiz-sources`, token)

export const getCurrentLiveQuiz = (sessionUuid: string, token?: string) =>
  liveRequest<LiveQuiz | null>(`${s(sessionUuid)}/quizzes/current`, token)

export const startLiveQuiz = (sessionUuid: string, sourceId: string, secondsPerQuestion: number, token?: string) =>
  liveRequest<LiveQuiz>(`${s(sessionUuid)}/quizzes`, token, {
    method: 'POST',
    body: { source_id: sourceId, seconds_per_question: secondsPerQuestion },
  })

const q = (sessionUuid: string, quizUuid: string) => `${s(sessionUuid)}/quizzes/${encodeURIComponent(quizUuid)}`

export const answerLiveQuiz = (
  sessionUuid: string,
  quizUuid: string,
  questionIndex: number,
  optionUuids: string[],
  token?: string
) =>
  liveRequest<LiveQuiz>(`${q(sessionUuid, quizUuid)}/answers`, token, {
    method: 'POST',
    body: { question_index: questionIndex, option_uuids: optionUuids },
  })

export const nextLiveQuizQuestion = (sessionUuid: string, quizUuid: string, token?: string) =>
  liveRequest<LiveQuiz>(`${q(sessionUuid, quizUuid)}/next`, token, { method: 'POST' })

export const finishLiveQuiz = (sessionUuid: string, quizUuid: string, token?: string) =>
  liveRequest<LiveQuiz>(`${q(sessionUuid, quizUuid)}/finish`, token, { method: 'POST' })

// ---------------------------------------------------------------------------
// Recordings + analytics
// ---------------------------------------------------------------------------

export const startLiveRecording = (sessionUuid: string, token?: string) =>
  liveRequest<LiveRecording>(`${s(sessionUuid)}/recordings/start`, token, { method: 'POST' })

export const stopLiveRecording = (sessionUuid: string, token?: string) =>
  liveRequest<{ stopped: number }>(`${s(sessionUuid)}/recordings/stop`, token, { method: 'POST' })

export const listCourseLiveRecordings = (courseUuid: string, token?: string) =>
  liveRequest<LiveRecording[]>(`recordings?course_uuid=${encodeURIComponent(courseUuid)}`, token)

export const getLiveSessionReport = (sessionUuid: string, token?: string) =>
  liveRequest<LiveSessionReport>(`${s(sessionUuid)}/report`, token)

export const getLiveCourseOverview = (courseUuid: string, token?: string) =>
  liveRequest<LiveCourseOverview>(`courses/${encodeURIComponent(courseUuid)}/overview`, token)

export const getLiveLearnerEngagement = (courseUuid: string, token?: string) =>
  liveRequest<LiveLearnerEngagement[]>(`courses/${encodeURIComponent(courseUuid)}/learners`, token)

export interface LiveMyLessons {
  sessions: {
    session_uuid: string
    title: string
    status: LiveSessionStatus
    scheduled_at: string
    started_at: string | null
    course_uuid: string
    course_name: string
    course_thumbnail: string | null
    is_staff: boolean
  }[]
  recordings: {
    recording_uuid: string
    session_title: string
    course_uuid: string
    course_name: string
    activity_uuid: string
    ready_at: string | null
    duration_seconds: number | null
  }[]
}

export const getMyLiveLessons = (orgId: number | undefined, token?: string) =>
  liveRequest<LiveMyLessons>(orgId ? `me?org_id=${orgId}` : 'me', token)

/** Classroom URL for a session (uuids travel without their type prefix). */
export const liveClassroomPath = (courseUuid: string, sessionUuid: string) =>
  `/course/${courseUuid.replace(/^course_/, '')}/live/${sessionUuid.replace(/^livesession_/, '')}`

export const LIVE_REACTIONS = ['👍', '👏', '❤️', '😂', '🎉', '🤔', '😮', '🙌'] as const
export const HAND_ATTRIBUTE = 'vb.hand'
export const LIVE_TOPICS = {
  messages: 'vb.messages',
  polls: 'vb.polls',
  reactions: 'vb.reactions',
  moderation: 'vb.moderation',
  quiz: 'vb.quiz',
} as const
