import { getAPIUrl } from '@services/config/config'

export type FDGroupRef = { id: number; name: string }
export type FDStudent = {
  user_uuid: string
  name: string
  username: string
  email: string
  avatar_image: string
  email_verified: boolean
  last_login_at: string | null
  groups: FDGroupRef[]
  courses_enrolled: number
}
export type FDStudentList = { items: FDStudent[]; total: number; page: number; limit: number }
export type FDCourse = {
  course_uuid: string
  name: string
  activities_total: number
  activities_done: number
  progress_percent: number
  access: 'free' | 'paid' | 'unpaid' | 'unknown'
}
export type FDStudentCard = {
  user_uuid: string
  name: string
  username: string
  email: string
  email_verified: boolean
  joined: string
  last_login_at: string | null
  details: Record<string, string | number | boolean>
  groups: FDGroupRef[]
  courses: FDCourse[]
}
export type FDGroup = { id: number; name: string; members: number }
export type FDClass = { session_uuid: string; title: string; course: string; course_uuid: string; scheduled_at: string; status: string }
export type FDExam = {
  assignment_uuid: string
  title: string
  course: string
  opens_at: string | null
  closes_at: string | null
  duration_minutes: number
  in_progress: number
  submitted: number
}
export type FDToday = { classes: FDClass[]; exams: FDExam[]; server_time: string }

export class FrontdeskError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, token: string | undefined, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`${getAPIUrl()}frontdesk/${path}`, {
      method: init.method ?? 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new FrontdeskError(0, 'Network error')
  }
  if (!res.ok) {
    let detail: any = null
    try {
      detail = (await res.json())?.detail
    } catch {
      /* non-JSON body */
    }
    const message = typeof detail === 'string' ? detail : typeof detail?.message === 'string' ? detail.message : 'Request failed'
    throw new FrontdeskError(res.status, message)
  }
  return (await res.json()) as T
}

const o = (orgId: number) => `orgs/${orgId}`

export const listStudents = (orgId: number, p: { search?: string; groupId?: number | null; page?: number }, token?: string) => {
  const q = new URLSearchParams()
  if (p.search) q.set('search', p.search)
  if (p.groupId) q.set('group_id', String(p.groupId))
  q.set('page', String(p.page ?? 1))
  return request<FDStudentList>(`${o(orgId)}/students?${q}`, token)
}
export const getStudent = (orgId: number, userUuid: string, token?: string) => request<FDStudentCard>(`${o(orgId)}/students/${encodeURIComponent(userUuid)}`, token)
export const inviteStudents = (orgId: number, emails: string[], token?: string) =>
  request<any>(`${o(orgId)}/invitations`, token, { method: 'POST', body: { emails } })
export const listGroups = (orgId: number, token?: string) => request<FDGroup[]>(`${o(orgId)}/groups`, token)
export const addToGroup = (orgId: number, groupId: number, userUuid: string, token?: string) =>
  request<{ added: boolean }>(`${o(orgId)}/groups/${groupId}/students/${encodeURIComponent(userUuid)}`, token, { method: 'POST' })
export const removeFromGroup = (orgId: number, groupId: number, userUuid: string, token?: string) =>
  request<{ removed: boolean }>(`${o(orgId)}/groups/${groupId}/students/${encodeURIComponent(userUuid)}`, token, { method: 'DELETE' })
export const getToday = (orgId: number, token?: string) => request<FDToday>(`${o(orgId)}/today`, token)
export const getExamRoster = (orgId: number, assignmentUuid: string, token?: string) =>
  request<any>(`${o(orgId)}/exams/${encodeURIComponent(assignmentUuid)}/roster`, token)
export const resendClassLink = (orgId: number, sessionUuid: string, userUuid: string, token?: string) =>
  request<{ queued: number }>(`${o(orgId)}/live/${encodeURIComponent(sessionUuid)}/resend`, token, { method: 'POST', body: { user_uuid: userUuid } })
