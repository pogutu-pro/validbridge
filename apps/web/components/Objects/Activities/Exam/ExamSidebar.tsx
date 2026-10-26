'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Flag } from 'lucide-react'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import { useAssignmentTaskSubmissions } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { hasAnswer } from './hasAnswer'

const anchor = (uuid: string) => `exam-q-${uuid}`

/**
 * Question navigator for the exam screen: every question as a numbered button, coloured by whether
 * it has a saved answer, with a "flag for review" mark the student keeps for themselves.
 * Flags live only in this browser tab; they are not sent to anyone.
 */
export default function ExamSidebar({ assignmentUuid }: { assignmentUuid: string }) {
  const assignments = useAssignments() as any
  const saved = useAssignmentTaskSubmissions() as Record<string, any> | null

  // Same order as the questions on the page.
  const tasks: any[] = useMemo(
    () => (assignments?.assignment_tasks ? [...assignments.assignment_tasks].sort((a: any, b: any) => a.id - b.id) : []),
    [assignments?.assignment_tasks]
  )

  const storageKey = `exam-flags-${assignmentUuid}`
  const [flags, setFlags] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(window.sessionStorage.getItem(storageKey) || '[]'))
    } catch {
      return new Set()
    }
  })
  const [current, setCurrent] = useState<string | null>(null)
  const observer = useRef<IntersectionObserver | null>(null)

  const toggleFlag = (uuid: string) => {
    setFlags((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(Array.from(next)))
      } catch {
        /* the flag still works for this page view */
      }
      return next
    })
  }

  // Track which question is on screen so "Flag this question" acts on the right one.
  useEffect(() => {
    observer.current?.disconnect()
    const visible = new Map<string, number>()
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const uuid = entry.target.id.replace('exam-q-', '')
          if (entry.isIntersecting) visible.set(uuid, entry.boundingClientRect.top)
          else visible.delete(uuid)
        }
        const first = Array.from(visible.entries()).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0]
        if (first) setCurrent(first[0])
      },
      { rootMargin: '-80px 0px -50% 0px' }
    )
    for (const t of tasks) {
      const el = document.getElementById(anchor(t.assignment_task_uuid))
      if (el) observer.current.observe(el)
    }
    return () => observer.current?.disconnect()
  }, [tasks])

  const jump = (uuid: string) => {
    document.getElementById(anchor(uuid))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setCurrent(uuid)
  }

  if (tasks.length === 0) return null
  const answered = tasks.filter((t) => hasAnswer(saved?.[t.assignment_task_uuid]?.task_submission)).length
  const flaggedCount = tasks.filter((t) => flags.has(t.assignment_task_uuid)).length
  const currentFlagged = !!current && flags.has(current)

  return (
    <aside aria-label="Questions" className="w-full shrink-0 lg:sticky lg:top-24 lg:w-60 lg:self-start">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Questions</h2>
        <p className="mt-0.5 text-xs text-neutral-500">{answered} of {tasks.length} answered{flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ''}</p>
        <div className="mt-2 h-1.5 rounded-full bg-neutral-100">
          <div className="h-1.5 rounded-full bg-neutral-900 transition-all" style={{ width: `${Math.round((100 * answered) / tasks.length)}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1.5 lg:grid-cols-4">
          {tasks.map((t, i) => {
            const uuid = t.assignment_task_uuid
            const done = hasAnswer(saved?.[uuid]?.task_submission)
            const flagged = flags.has(uuid)
            const isCurrent = current === uuid
            return (
              <button
                key={uuid}
                type="button"
                onClick={() => jump(uuid)}
                aria-label={`Question ${i + 1}: ${done ? 'answered' : 'not answered'}${flagged ? ', flagged for review' : ''}`}
                aria-current={isCurrent ? 'true' : undefined}
                className={`relative h-9 rounded-lg text-sm font-semibold tabular-nums transition-colors ${
                  done ? 'bg-neutral-900 text-white' : 'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                } ${isCurrent ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
              >
                {i + 1}
                {flagged && <Flag className="absolute -end-1 -top-1 size-3.5 fill-amber-400 text-amber-500" aria-hidden />}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          disabled={!current}
          onClick={() => current && toggleFlag(current)}
          className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
        >
          <Flag className={`size-3.5 ${currentFlagged ? 'fill-amber-400 text-amber-500' : ''}`} />
          {currentFlagged ? 'Remove flag' : 'Flag this question to review'}
        </button>
        <ul className="mt-3 space-y-1 text-[11px] text-neutral-500">
          <li className="flex items-center gap-2"><span className="inline-block size-3 rounded bg-neutral-900" /> Answer saved</li>
          <li className="flex items-center gap-2"><span className="inline-block size-3 rounded border border-neutral-300" /> Not answered yet</li>
          <li className="flex items-center gap-2"><Flag className="size-3 fill-amber-400 text-amber-500" /> Flagged. Only you can see this.</li>
        </ul>
      </div>
    </aside>
  )
}
