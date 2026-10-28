'use client'
import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Plus, Search, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { queryKeys } from '@/lib/query/keys'
import { getOrgCourses } from '@services/courses/courses'
import { getOrgExams, type ExamOverviewRow } from '@services/courses/exams'
import CreateExamDialog from '@components/Dashboard/Pages/Exams/CreateExamDialog'

type Filter = 'all' | 'running' | 'upcoming' | 'finished'

const STATE_STYLE: Record<string, string> = {
  running: 'bg-blue-50 text-blue-700',
  open: 'bg-emerald-50 text-emerald-700',
  upcoming: 'bg-amber-50 text-amber-800',
  closed: 'bg-neutral-100 text-neutral-600',
}
const STATE_LABEL: Record<string, string> = { running: 'Running now', open: 'Open', upcoming: 'Upcoming', closed: 'Finished' }
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Any time')
const shortUuid = (uuid: string) => uuid.replace(/^assignment_/, '')

export default function ExamsPage() {
  const org = useOrg() as any
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const orgId: number | undefined = org?.id
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [settingExam, setSettingExam] = useState(false)

  const courses = useQuery({
    queryKey: queryKeys.courses.list(org?.slug ?? ''),
    queryFn: () => getOrgCourses(org.slug, {}, token, true),
    enabled: !!(org?.slug && token),
    staleTime: 60_000,
  })

  const exams = useQuery({
    queryKey: queryKeys.exams.list(orgId ?? 0),
    queryFn: () => getOrgExams(orgId as number, token),
    enabled: !!orgId && !!token,
    refetchInterval: 5000,
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (exams.data ?? []).filter((e: ExamOverviewRow) => {
      if (q && !`${e.title} ${e.course_name}`.toLowerCase().includes(q)) return false
      if (filter === 'running') return e.state === 'running'
      if (filter === 'upcoming') return e.state === 'upcoming'
      if (filter === 'finished') return e.state === 'closed'
      return true
    })
  }, [exams.data, filter, search])

  const running = (exams.data ?? []).filter((e) => e.state === 'running')
  const flagged = running.reduce((n, e) => n + e.flagged, 0)

  return (
    <div className="px-8 pb-12 pt-6">
      <Breadcrumbs items={[{ label: 'Exams', icon: <ShieldCheck size={14} /> }]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Exams</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Every live, timed exam and CAT you supervise. Open one to watch the sitting, edit its questions or change its settings. Use Create
            exam to set up a new one.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSettingExam(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-800"
        >
          <Plus className="size-4" /> Create exam
        </button>
        {running.length > 0 && (
          <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
            {running.length} exam{running.length === 1 ? '' : 's'} running now
            {flagged > 0 && (
              <span className="ms-2 inline-flex items-center gap-1 font-semibold text-rose-700">
                <ShieldAlert className="size-4" /> {flagged} student{flagged === 1 ? '' : 's'} flagged
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-neutral-200 bg-white p-1 text-sm">
          {(['all', 'running', 'upcoming', 'finished'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 font-medium capitalize ${filter === f ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-3 size-4 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search exams or courses"
            className="h-10 w-72 rounded-lg border border-neutral-200 ps-9 pe-3 text-sm outline-none focus:border-neutral-400"
          />
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3 text-start">Exam</th>
              <th className="px-4 py-3 text-start">Status</th>
              <th className="px-4 py-3 text-start">Window</th>
              <th className="px-4 py-3 text-end">Not started</th>
              <th className="px-4 py-3 text-end">Sitting</th>
              <th className="px-4 py-3 text-end">Handed in</th>
              <th className="px-4 py-3 text-end">Flagged</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.assignment_uuid} className="border-b border-neutral-100 hover:bg-neutral-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-neutral-900">{e.title}</p>
                  <p className="text-xs text-neutral-500">{e.course_name} · {e.duration_minutes} min · {e.enrolled} enrolled</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_STYLE[e.state]}`}>{STATE_LABEL[e.state]}</span>
                  {e.disconnected > 0 && <span className="ms-2 text-[11px] text-rose-700">{e.disconnected} disconnected</span>}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-600">
                  <p>{when(e.opens_at)}</p>
                  <p className="text-neutral-400">to {when(e.closes_at)}</p>
                </td>
                <td className="px-4 py-3 text-end tabular-nums">{e.not_started}</td>
                <td className="px-4 py-3 text-end tabular-nums">{e.in_progress}</td>
                <td className="px-4 py-3 text-end tabular-nums">{e.submitted}</td>
                <td className="px-4 py-3 text-end tabular-nums">
                  {e.flagged > 0 ? <span className="font-semibold text-rose-700">{e.flagged}</span> : <span className="text-neutral-300">0</span>}
                </td>
                <td className="px-4 py-3 text-end">
                  <Link
                    href={`/dash/exams/${shortUuid(e.assignment_uuid)}`}
                    className="inline-flex h-9 items-center rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white"
                  >
                    {e.state === 'running' ? 'Monitor' : 'Open'}
                  </Link>
                </td>
              </tr>
            ))}
            {exams.isLoading && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-neutral-400"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr>
            )}
            {exams.isError && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-rose-600">Could not load the exams.</td></tr>
            )}
            {exams.data && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-neutral-500">{exams.data.length === 0 ? 'No exams yet. Use Create exam to set up your first one.' : 'No exams match.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <CreateExamDialog open={settingExam} onClose={() => setSettingExam(false)} courses={courses.data} />
    </div>
  )
}
