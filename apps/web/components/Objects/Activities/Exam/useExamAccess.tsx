'use client'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { queryKeys } from '@/lib/query/keys'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useCourseRights } from '@components/Hooks/useCourseRights'
import { getExamStatus, type ExamStatus } from '@services/courses/exams'
import ExamRunner from './ExamRunner'

/**
 * Is this assessment an exam, and should THIS viewer see the exam screen?
 * Staff always get the normal view (they author and mark), students get the exam screen.
 */
export function useExamAccess(assignmentUuid?: string, courseUuid?: string) {
  const session = useVBSession() as any
  const token = session?.data?.tokens?.access_token
  const { hasPermission } = useCourseRights(courseUuid || '')
  const isStaff = !!hasPermission('update')
  const query = useQuery<ExamStatus>({
    queryKey: queryKeys.exams.status(assignmentUuid || ''),
    queryFn: () => getExamStatus(assignmentUuid as string, token),
    enabled: !!(assignmentUuid && token),
    staleTime: 15_000,
    retry: false,
  })
  const enabled = !!query.data?.settings?.enabled
  return {
    loading: !!assignmentUuid && !query.isFetched && !query.isError,
    enabled,
    isStaff,
    // The learner's exam screen replaces the normal assignment screen.
    learnerExam: enabled && !isStaff,
    status: query.data,
  }
}

/** Replaces the normal assignment screen with the exam screen for learners when the assessment is an exam. */
export function ExamSwitch({
  assignmentUuid,
  courseUuid,
  children,
}: {
  assignmentUuid?: string
  courseUuid?: string
  children: React.ReactNode
}) {
  const access = useExamAccess(assignmentUuid, courseUuid)
  if (access.loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-neutral-400" />
      </div>
    )
  }
  if (access.learnerExam && assignmentUuid) {
    return <ExamRunner assignmentUuid={assignmentUuid} />
  }
  return (
    <>
      {access.enabled && access.isStaff && (
        <div className="mx-6 mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Exam mode is on for this assessment. Students see the timed exam screen with camera and screen checks. You are seeing the normal
          view so you can review the questions.
        </div>
      )}
      {children}
    </>
  )
}

/** Hides the normal submit controls from learners who are in an exam. */
export function ExamHide({
  assignmentUuid,
  courseUuid,
  children,
}: {
  assignmentUuid?: string
  courseUuid?: string
  children: React.ReactNode
}) {
  const access = useExamAccess(assignmentUuid, courseUuid)
  if (access.loading || access.learnerExam) return null
  return <>{children}</>
}
