'use client'
// Create an exam from the Exams page in one step: course, chapter, name, length and window.
// Under the hood an exam is an assignment with exam mode on, so this makes the activity and the
// assignment and switches exam mode on, then opens the exam's own workspace.
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { createActivity, deleteActivity } from '@services/courses/activities'
import { createAssignment } from '@services/courses/assignments'
import { getCourseMetadata } from '@services/courses/courses'
import { saveExamSettings } from '@services/courses/exams'
import { queryKeys } from '@/lib/query/keys'
import { getErrorMessage } from '@services/utils/ts/errorMessage'

const field = 'h-10 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-400'
const label = 'mb-1 block text-xs font-semibold text-neutral-600'
const cleanCourseUuid = (u: string) => u?.replace(/^course_/, '') ?? u
const shortUuid = (u: string) => u.replace(/^assignment_/, '')

export default function CreateExamDialog({
  open,
  onClose,
  courses,
}: {
  open: boolean
  onClose: () => void
  courses: any[] | undefined
}) {
  const org = useOrg() as any
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const router = useRouter()
  const queryClient = useQueryClient()

  const [courseUuid, setCourseUuid] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('60')
  const [opensAt, setOpensAt] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [busy, setBusy] = useState(false)

  const course = useQuery({
    queryKey: ['create-exam-course', courseUuid],
    queryFn: () => getCourseMetadata(cleanCourseUuid(courseUuid), null, token, { withUnpublishedActivities: true }),
    enabled: !!courseUuid && !!token && open,
    staleTime: 30_000,
  })
  const chapters: any[] = course.data?.chapters || []

  const reset = () => {
    setCourseUuid('')
    setChapterId('')
    setTitle('')
    setMinutes('60')
    setOpensAt('')
    setClosesAt('')
  }
  const close = () => {
    reset()
    onClose()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const duration = Number(minutes)
    if (!Number.isInteger(duration) || duration < 1 || duration > 600) {
      toast.error('The exam length must be between 1 and 600 minutes.')
      return
    }
    if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) {
      toast.error('The exam must close after it opens.')
      return
    }
    if (!token || !course.data) return
    setBusy(true)
    let activity: any = null
    try {
      activity = await createActivity(
        {
          name: title.trim(),
          chapter_id: Number(chapterId),
          activity_type: 'TYPE_ASSIGNMENT',
          activity_sub_type: 'SUBTYPE_ASSIGNMENT_ANY',
          published: false,
          course_id: course.data.id,
        },
        Number(chapterId),
        org?.id,
        token
      )
      const made = await createAssignment(
        {
          title: title.trim(),
          description: '',
          due_date: null,
          grading_type: 'PERCENTAGE',
          ungraded: false,
          auto_grading: false,
          anti_copy_paste: false,
          show_correct_answers: false,
          allow_retries: false,
          max_retries: 0,
          course_id: course.data.id,
          org_id: org?.id,
          chapter_id: Number(chapterId),
          activity_id: activity?.id,
        },
        token
      )
      const assignmentUuid: string | undefined = made?.data?.assignment_uuid
      if (!made.success || !assignmentUuid) {
        throw new Error(getErrorMessage(made?.data?.detail, 'Could not create the exam.'))
      }
      await saveExamSettings(
        assignmentUuid,
        {
          enabled: true,
          duration_minutes: duration,
          opens_at: opensAt ? new Date(opensAt).toISOString() : null,
          closes_at: closesAt ? new Date(closesAt).toISOString() : null,
          require_camera: true,
          require_screen_share: true,
          require_fullscreen: true,
          watermark: true,
        },
        token
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.list(org?.id ?? 0) })
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      toast.success('Exam created. Add the questions next.')
      close()
      router.push(`/dash/exams/${shortUuid(assignmentUuid)}`)
    } catch (err: any) {
      // Do not leave an empty activity behind when a later step failed.
      if (activity?.activity_uuid) await deleteActivity(activity.activity_uuid, token).catch(() => {})
      toast.error(err?.message || 'Could not create the exam.')
    } finally {
      setBusy(false)
    }
  }

  const content = (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={label} htmlFor="exam-course">Course</label>
        <select
          id="exam-course"
          required
          className={field}
          value={courseUuid}
          onChange={(e) => {
            setCourseUuid(e.target.value)
            setChapterId('')
          }}
        >
          <option value="">Choose a course</option>
          {(courses || []).map((c: any) => (
            <option key={c.course_uuid} value={c.course_uuid}>{c.name}</option>
          ))}
        </select>
      </div>
      {courseUuid && (
        <div>
          <label className={label} htmlFor="exam-chapter">Chapter it sits in</label>
          {course.isLoading ? (
            <Loader2 className="size-4 animate-spin text-neutral-400" />
          ) : chapters.length === 0 ? (
            <p className="text-sm text-neutral-600">This course has no chapters yet. Add a chapter to the course first.</p>
          ) : (
            <select id="exam-chapter" required className={field} value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
              <option value="">Choose a chapter</option>
              {chapters.map((ch: any) => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
              ))}
            </select>
          )}
        </div>
      )}
      <div>
        <label className={label} htmlFor="exam-title">Exam name</label>
        <input id="exam-title" required maxLength={200} className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CAT 1: Introduction to JavaScript" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="exam-minutes">Length (minutes)</label>
          <input id="exam-minutes" required type="number" min={1} max={600} className={field} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="exam-opens">Opens (optional)</label>
          <input id="exam-opens" type="datetime-local" className={field} value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="exam-closes">Closes (optional)</label>
          <input id="exam-closes" type="datetime-local" className={field} value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-neutral-500">
        Camera, screen sharing and full screen are required by default. You can change these, add the questions and publish on the next screen.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={close} className="h-10 rounded-lg border border-neutral-200 px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !chapterId || !title.trim()}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" />} Create exam
        </button>
      </div>
    </form>
  )

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(next) => !next && close()}
      dialogTitle="Create an exam"
      dialogDescription="Set it up here. You add the questions on the next screen."
      dialogContent={content}
      minHeight="no-min"
    />
  )
}
