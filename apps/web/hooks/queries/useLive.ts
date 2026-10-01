'use client'

import { useQuery } from '@tanstack/react-query'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { queryKeys } from '@lib/query/keys'
import {
  LiveApiError,
  getCurrentLiveQuiz,
  getLiveAttendance,
  getLiveCourseOverview,
  getLiveLearnerEngagement,
  getLiveSessionReport,
  getMyLiveLessons,
  listCourseLiveRecordings,
  getLiveClassroom,
  listLiveQuizSources,
  listCourseLiveSessions,
  listLiveMessages,
  listLivePolls,
} from '@services/live/live'

export function useLiveAccessToken(): string | undefined {
  const session = useVBSession() as any
  return session?.data?.tokens?.access_token as string | undefined
}

// Auth/permission failures are answers, not transient errors — don't retry them.
const retryTransient = (failureCount: number, error: unknown) =>
  !(error instanceof LiveApiError && error.status >= 400 && error.status < 500) && failureCount < 2

export function useLiveClassroom(sessionUuid: string, options: { pollWhileWaiting?: boolean } = {}) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.classroom(sessionUuid),
    queryFn: () => getLiveClassroom(sessionUuid, token),
    enabled: !!sessionUuid && !!token,
    retry: retryTransient,
    staleTime: 5_000,
    // Learners in the waiting room watch for the lecturer to go live.
    refetchInterval: (query) => {
      if (!options.pollWhileWaiting) return false
      const status = query.state.data?.session.status
      return status === 'scheduled' || status === 'ready' ? 5_000 : false
    },
  })
}

export function useLiveMessages(sessionUuid: string, kind: 'chat' | 'question', enabled = true) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.messages(sessionUuid, kind),
    queryFn: () => listLiveMessages(sessionUuid, kind, token),
    enabled: enabled && !!token,
    retry: retryTransient,
    staleTime: Infinity, // kept fresh by server broadcasts
    // Safety net for a missed broadcast.
    refetchInterval: 60_000,
  })
}

export function useLivePolls(sessionUuid: string, options: { staffLiveResults?: boolean } = {}) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.polls(sessionUuid),
    queryFn: () => listLivePolls(sessionUuid, token),
    enabled: !!token,
    retry: retryTransient,
    staleTime: Infinity,
    // Votes are not broadcast room-wide; staff watch results by polling
    // while a poll is open.
    refetchInterval: (query) => {
      const hasOpen = query.state.data?.some((p) => p.status === 'open')
      if (options.staffLiveResults && hasOpen) return 3_000
      return 60_000
    },
  })
}

export function useLiveAttendance(sessionUuid: string, enabled: boolean) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.attendance(sessionUuid),
    queryFn: () => getLiveAttendance(sessionUuid, token),
    enabled: enabled && !!token,
    retry: retryTransient,
    refetchInterval: enabled ? 15_000 : false,
  })
}

export function useCourseLiveSessions(courseUuid: string | undefined) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.courseSessions(courseUuid ?? ''),
    queryFn: () => listCourseLiveSessions(courseUuid as string, token),
    enabled: !!courseUuid && !!token,
    retry: retryTransient,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useLiveQuiz(sessionUuid: string) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.quiz(sessionUuid),
    queryFn: () => getCurrentLiveQuiz(sessionUuid, token),
    enabled: !!token,
    retry: retryTransient,
    staleTime: Infinity, // kept fresh by vb.quiz broadcasts
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 15_000 : 60_000),
  })
}

export function useLiveQuizSources(sessionUuid: string, enabled: boolean) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.quizSources(sessionUuid),
    queryFn: () => listLiveQuizSources(sessionUuid, token),
    enabled: enabled && !!token,
    retry: retryTransient,
    staleTime: 60_000,
  })
}

export function useCourseLiveRecordings(courseUuid: string | undefined) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.courseRecordings(courseUuid ?? ''),
    queryFn: () => listCourseLiveRecordings(courseUuid as string, token),
    enabled: !!courseUuid && !!token,
    retry: retryTransient,
    staleTime: 30_000,
    // Recordings move pending → processing → ready on their own.
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status !== 'ready' && r.status !== 'failed') ? 20_000 : false,
  })
}

export function useLiveCourseOverview(courseUuid: string, enabled = true) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.courseOverview(courseUuid),
    queryFn: () => getLiveCourseOverview(courseUuid, token),
    enabled: enabled && !!courseUuid && !!token,
    retry: retryTransient,
    staleTime: 30_000,
  })
}

export function useLiveLearnerEngagement(courseUuid: string, enabled = true) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.courseLearners(courseUuid),
    queryFn: () => getLiveLearnerEngagement(courseUuid, token),
    enabled: enabled && !!courseUuid && !!token,
    retry: retryTransient,
    staleTime: 60_000,
  })
}

export function useLiveSessionReport(sessionUuid: string | null) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.report(sessionUuid ?? ''),
    queryFn: () => getLiveSessionReport(sessionUuid as string, token),
    enabled: !!sessionUuid && !!token,
    retry: retryTransient,
    staleTime: 30_000,
  })
}

/** The signed-in user's live lessons across their courses (learner home, nav, banner). */
export function useMyLiveLessons(orgId: number | undefined) {
  const token = useLiveAccessToken()
  return useQuery({
    queryKey: queryKeys.live.mine(orgId),
    queryFn: () => getMyLiveLessons(orgId, token),
    enabled: !!token && !!orgId,
    retry: retryTransient,
    staleTime: 30_000,
    // Poll faster while something is live or about to start.
    refetchInterval: (query) =>
      query.state.data?.sessions.some((s) => s.status === 'live' || s.status === 'ready') ? 30_000 : 120_000,
  })
}
