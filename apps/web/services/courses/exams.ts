import { getAPIUrl } from '@services/config/config'

export type ExamSettings = {
  assignment_uuid: string
  enabled: boolean
  duration_minutes: number
  opens_at: string | null
  closes_at: string | null
  require_camera: boolean
  require_screen_share: boolean
  require_fullscreen: boolean
  watermark: boolean
}

export type ExamStatus = {
  settings: ExamSettings | null
  window: 'none' | 'not_open' | 'open' | 'closed'
  session_status: 'in_progress' | 'submitted' | null
  started_at: string | null
  deadline_at: string | null
  seconds_left: number | null
  /** True when the exam was opened in another browser or tab: this window must close. */
  superseded?: boolean
  server_time: string
}

export type ExamRosterRow = {
  user_uuid: string
  username: string
  name: string
  status: 'not_started' | 'in_progress' | 'submitted'
  connected: boolean
  started_at: string | null
  deadline_at: string | null
  seconds_left: number | null
  submitted_at: string | null
  auto_submitted: boolean
  last_seen_at: string | null
  camera_on: boolean | null
  screen_shared: boolean | null
  fullscreen: boolean | null
  violation_count: number
  resume_count: number
}

export type ExamMonitor = {
  assignment_uuid: string
  title: string
  server_time: string
  counts: { not_started: number; in_progress: number; submitted: number; disconnected: number; flagged: number }
  students: ExamRosterRow[]
}

export type ExamEvent = { kind: string; detail: string | null; is_violation: boolean; created_at: string }

export class ExamApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, token: string | undefined, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`${getAPIUrl()}exams/${path}`, {
      method: init.method ?? 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ExamApiError(0, 'NETWORK_ERROR', 'Network error')
  }
  if (!res.ok) {
    let detail: any = null
    try {
      detail = (await res.json())?.detail
    } catch {
      /* non-JSON body */
    }
    const code = typeof detail === 'object' && detail?.code ? detail.code : 'REQUEST_FAILED'
    const message = typeof detail === 'object' && detail?.message ? detail.message : typeof detail === 'string' ? detail : 'Request failed'
    throw new ExamApiError(res.status, code, message)
  }
  return (await res.json()) as T
}

const u = (assignmentUuid: string) => encodeURIComponent(assignmentUuid)

export const getExamStatus = (assignmentUuid: string, token?: string) => request<ExamStatus>(u(assignmentUuid), token)
export const saveExamSettings = (assignmentUuid: string, body: Omit<ExamSettings, 'assignment_uuid'>, token?: string) =>
  request<ExamSettings>(u(assignmentUuid), token, { method: 'PUT', body })
export const startExam = (assignmentUuid: string, token?: string, clientId?: string) =>
  request<ExamStatus>(`${u(assignmentUuid)}/start`, token, { method: 'POST', body: { client_id: clientId } })
export const examHeartbeat = (
  assignmentUuid: string,
  report: { camera_on?: boolean; screen_shared?: boolean; fullscreen?: boolean },
  token?: string,
  clientId?: string
) => request<ExamStatus>(`${u(assignmentUuid)}/heartbeat`, token, { method: 'POST', body: { ...report, client_id: clientId } })
export const sendExamEvent = (assignmentUuid: string, kind: string, detail?: string, token?: string, clientId?: string) =>
  request<{ recorded: boolean }>(`${u(assignmentUuid)}/events`, token, { method: 'POST', body: { kind, detail, client_id: clientId } })
export const finishExam = (assignmentUuid: string, token?: string, clientId?: string) =>
  request<ExamStatus>(`${u(assignmentUuid)}/finish`, token, { method: 'POST', body: { client_id: clientId } })
export const getExamMonitor = (assignmentUuid: string, token?: string) => request<ExamMonitor>(`${u(assignmentUuid)}/monitor`, token)
export const getExamStudentEvents = (assignmentUuid: string, userUuid: string, token?: string) =>
  request<ExamEvent[]>(`${u(assignmentUuid)}/students/${encodeURIComponent(userUuid)}/events`, token)
