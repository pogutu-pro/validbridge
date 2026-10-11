'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getCourseMetadata } from '@services/courses/courses'
import { getUriWithOrg } from '@services/config/config'
import { Backpack, BookOpen, ChevronDown, ChevronRight, HelpCircle, Plus } from 'lucide-react'

const clean = (u: string, prefix: string) => (u ?? '').replace(new RegExp(`^${prefix}`), '')

export type AssignmentTarget = { courseUuid: string; chapterId: number }

// Course -> chapter -> lesson outline for the Assignments page. Every lesson that
// is a content page links straight into the editor with a quiz block ready to
// fill in, and every chapter ends with an "Add assignment" button, so building
// the lesson -> quiz -> chapter -> assignment path never needs the course editor.
export default function CourseOutline({
  courses,
  org,
  onAddAssignment,
}: {
  courses: any[] | undefined
  org: any
  onAddAssignment: (_target: AssignmentTarget) => void
}) {
  const { t } = useTranslation()
  if (!courses || courses.length === 0) return null

  return (
    <section className="flex flex-col space-y-3 pt-4">
      <div className="flex flex-col">
        <h2 className="font-bold text-xl text-gray-900">
          {t('dashboard.assignments.outline.title', { defaultValue: 'Lessons and quizzes' })}
        </h2>
        <p className="text-sm text-gray-500">
          {t('dashboard.assignments.outline.subtitle', {
            defaultValue:
              'Open a lesson to add its quiz, or add an assignment at the end of a chapter.',
          })}
        </p>
      </div>
      {courses.map((course: any) => (
        <CourseOutlineRow
          key={course.course_uuid}
          course={course}
          org={org}
          onAddAssignment={onAddAssignment}
        />
      ))}
    </section>
  )
}

function CourseOutlineRow({
  course,
  org,
  onAddAssignment,
}: {
  course: any
  org: any
  onAddAssignment: (_target: AssignmentTarget) => void
}) {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [open, setOpen] = useState(false)
  const courseUuid = clean(course.course_uuid, 'course_')

  // Loaded on expand only, so the page does not fetch every course's structure.
  const { data, isLoading } = useQuery({
    queryKey: ['assignment-outline', courseUuid],
    queryFn: () =>
      getCourseMetadata(courseUuid, null, access_token, { withUnpublishedActivities: true }),
    enabled: open && !!access_token,
    staleTime: 30_000,
  })
  const chapters: any[] = data?.chapters || []

  return (
    <div className="bg-white nice-shadow rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-start hover:bg-gray-50/60 transition-colors"
      >
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <BookOpen size={15} className="text-gray-400" />
        <span className="font-semibold text-gray-800 truncate">{course.name}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-4">
          {isLoading && <div className="h-10 rounded-lg bg-gray-100 animate-pulse" />}
          {!isLoading && chapters.length === 0 && (
            <p className="text-sm text-gray-500">
              {t('dashboard.assignments.outline.no_chapters', {
                defaultValue: 'This course has no chapters yet.',
              })}
            </p>
          )}
          {chapters.map((chapter: any, index: number) => (
            <div key={chapter.id} className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider font-bold text-gray-400">
                {index + 1}. {chapter.name}
              </p>
              {(chapter.activities || []).map((activity: any) => (
                <LessonRow
                  key={activity.activity_uuid}
                  activity={activity}
                  courseUuid={courseUuid}
                  org={org}
                />
              ))}
              <button
                onClick={() => onAddAssignment({ courseUuid, chapterId: chapter.id })}
                className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-1.5 transition-colors"
              >
                <Plus size={13} />
                {t('dashboard.assignments.outline.add_assignment', {
                  defaultValue: 'Add assignment at end of this chapter',
                })}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LessonRow({ activity, courseUuid, org }: { activity: any; courseUuid: string; org: any }) {
  const { t } = useTranslation()
  const activityUuid = clean(activity.activity_uuid, 'activity_')
  const isContentPage = activity.activity_type === 'TYPE_DYNAMIC'
  const isAssignment = activity.activity_type === 'TYPE_ASSIGNMENT'

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 bg-gray-50">
      <span className="flex items-center gap-2 min-w-0 text-sm text-gray-800">
        {isAssignment && <Backpack size={14} className="text-amber-500 flex-none" />}
        <span className="truncate">{activity.name}</span>
      </span>
      {isContentPage && (
        <Link
          // addQuiz makes the editor append a quiz block if the lesson has none.
          href={`${getUriWithOrg(org.slug, '')}/course/${courseUuid}/activity/${activityUuid}/edit?addQuiz=1`}
          className="flex-none inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-black hover:bg-gray-800 rounded-lg px-3 py-1.5 transition-colors"
        >
          <HelpCircle size={13} />
          {t('dashboard.assignments.outline.add_quiz', { defaultValue: 'Add quiz' })}
        </Link>
      )}
    </div>
  )
}
