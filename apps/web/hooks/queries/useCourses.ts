'use client'

import { useQuery } from '@tanstack/react-query'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { queryKeys } from '@lib/query/keys'
import { authScope } from '@lib/query/authScope'
import { getOrgCourses, getCourseMetadata } from '@services/courses/courses'

export function useCourses(orgSlug: string) {
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  // Wait for the login to finish and cache per viewer, otherwise the list is
  // fetched as a visitor and stays that way until a hard refresh.
  const { ready, who } = authScope(session)

  return useQuery({
    queryKey: [...queryKeys.courses.list(orgSlug), who],
    queryFn: () => getOrgCourses(orgSlug, {}, accessToken),
    enabled: !!orgSlug && ready,
    staleTime: 60_000,
  })
}

export function useCourseMeta(courseUuid: string) {
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  const { ready, who } = authScope(session)

  return useQuery({
    queryKey: [...queryKeys.courses.meta(courseUuid), who],
    queryFn: () => getCourseMetadata(courseUuid, {}, accessToken, { slim: true }),
    enabled: !!courseUuid && ready,
    staleTime: 60_000,
  })
}
