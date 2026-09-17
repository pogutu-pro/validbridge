'use client'
import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTranslation } from 'react-i18next'
import { formatDate } from '@/lib/format'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getOrgCourses } from '@services/courses/courses'
import { SafeImage } from '@components/Objects/SafeImage'
import { BookOpen, PlusCircle, Clock } from '@phosphor-icons/react'
import { Card, CardSectionHeader } from '@components/ui/card'
import { EmptyState } from '@components/ui/empty-state'

export default function RecentCourses() {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useVBSession() as any
  const token = session?.data?.tokens?.access_token
  const orgslug = org?.slug

  const { data: coursesData, isLoading } = useQuery({
    queryKey: [...queryKeys.courses.list(orgslug), 'recent', 8],
    queryFn: () => getOrgCourses(orgslug, null, token, true),
    enabled: !!token && !!orgslug,
    staleTime: 60_000,
  })

  const courses: any[] = coursesData ?? []
  const publishedCount = courses.filter((c: any) => c.published).length
  const draftCount = courses.filter((c: any) => !c.published).length

  return (
    <Card>
      <CardSectionHeader
        icon={<BookOpen weight="duotone" />}
        title={t('dashboard.home.recent_courses')}
        action={
          <Link
            href="/dash/courses"
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            {t('dashboard.home.view_all')} &rarr;
          </Link>
        }
      />

      {isLoading ? (
        <div className="space-y-3 px-5 pb-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex animate-pulse items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-muted" />
              <div className="flex-1">
                <div className="mb-1.5 h-3 w-40 rounded bg-muted" />
                <div className="h-2 w-24 rounded bg-muted/60" />
              </div>
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <EmptyState
          compact
          icon={<BookOpen weight="duotone" />}
          title={t('dashboard.home.no_courses_yet')}
          action={
            <Link
              href="/dash/courses?new=true"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <PlusCircle size={14} weight="bold" />
              {t('dashboard.home.create_your_first_course')}
            </Link>
          }
        />
      ) : (
        <div className="divide-y divide-border/60">
          {courses.slice(0, 8).map((course: any) => {
            const courseId = course.course_uuid?.replace('course_', '')
            const thumbnail = course.thumbnail_image
              ? getCourseThumbnailMediaDirectory(
                  org.org_uuid,
                  course.course_uuid,
                  course.thumbnail_image
                )
              : null
            const updatedAt = course.update_date
              ? formatDate(course.update_date, i18n.language, {
                  dateStyle: undefined,
                  month: 'short',
                  day: 'numeric',
                })
              : null

            return (
              <Link
                key={course.course_uuid}
                prefetch={false}
                href={`/dash/courses/course/${courseId}/general`}
                className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/50">
                  {thumbnail ? (
                    <SafeImage
                      src={thumbnail}
                      alt={course.name}
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <BookOpen size={16} weight="duotone" className="text-muted-foreground/60" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                    {course.name}
                  </p>
                  <div className="mt-0.5 flex items-center gap-3">
                    {updatedAt && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock size={10} />
                        {updatedAt}
                      </span>
                    )}
                    {course.chapters_count !== undefined && (
                      <span className="text-[10px] text-muted-foreground">
                        {course.chapters_count}{' '}
                        {course.chapters_count !== 1
                          ? t('dashboard.home.chapters')
                          : t('dashboard.home.chapter')}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    course.published
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {course.published ? t('dashboard.home.published') : t('dashboard.home.draft')}
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {!isLoading && courses.length > 0 && (
        <div className="flex items-center gap-2 border-t border-border px-5 py-2.5">
          <span className="text-[10px] font-medium text-emerald-600">
            {publishedCount} {t('dashboard.home.published')}
          </span>
          {draftCount > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground">
              {draftCount} {t('dashboard.home.draft')}
            </span>
          )}
        </div>
      )}
    </Card>
  )
}
