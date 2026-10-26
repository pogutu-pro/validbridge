'use client'
import React, { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, ClipboardCheck, Loader2, Mail, Search, UserPlus, Users, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import useFrontdeskAccess from '@components/Hooks/useFrontdeskAccess'
import {
  addToGroup,
  FrontdeskError,
  getExamRoster,
  getStudent,
  getToday,
  inviteStudents,
  listGroups,
  listStudents,
  removeFromGroup,
  resendClassLink,
  type FDStudent,
} from '@services/frontdesk/frontdesk'

const input = 'h-10 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-400'
const btn = 'inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white disabled:opacity-50'
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')
const fail = (e: unknown) => toast.error(e instanceof FrontdeskError ? e.message : 'Something went wrong')

type Tab = 'students' | 'today'

export default function FrontdeskClient() {
  const access = useFrontdeskAccess()
  const [tab, setTab] = useState<Tab>('students')

  if (access.loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="size-6 animate-spin text-neutral-400" />
      </div>
    )
  }
  if (!access.allowed) {
    return (
      <div className="mx-auto max-w-lg px-6 py-32 text-center">
        <h1 className="text-xl font-semibold text-neutral-900">Front desk</h1>
        <p className="mt-2 text-sm text-neutral-600">This page is for front desk staff. Ask your school administrator for access.</p>
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900">Front desk</h1>
      <p className="mt-1 text-sm text-neutral-600">Find students, welcome new ones, manage groups, and keep class and exam days running.</p>
      <div className="mt-6 flex gap-2 border-b border-neutral-200">
        {([['students', 'Students', Users], ['today', 'Classes and exams', CalendarClock]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${tab === id ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800'}`}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      <div className="mt-6">{tab === 'students' ? <Students canCreate={access.canCreate} canUpdate={access.canUpdate} /> : <Today canUpdate={access.canUpdate} />}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function useCtx() {
  const org = useOrg() as any
  const session = useVBSession() as any
  return { orgId: org?.id as number, token: session?.data?.tokens?.access_token as string | undefined }
}

function Students({ canCreate, canUpdate }: { canCreate: boolean; canUpdate: boolean }) {
  const { orgId, token } = useCtx()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [groupId, setGroupId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebounced(search)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(id)
  }, [search])

  const groups = useQuery({ queryKey: ['fd', 'groups', orgId], queryFn: () => listGroups(orgId, token), enabled: !!orgId && !!token })
  const students = useQuery({
    queryKey: ['fd', 'students', orgId, debounced, groupId, page],
    queryFn: () => listStudents(orgId, { search: debounced, groupId, page }, token),
    enabled: !!orgId && !!token,
    placeholderData: (prev) => prev,
  })
  const data = students.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-3 size-4 text-neutral-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, username or email" className={`${input} w-72 ps-9`} />
        </div>
        <select value={groupId ?? ''} onChange={(e) => { setGroupId(e.target.value ? Number(e.target.value) : null); setPage(1) }} className={input}>
          <option value="">All groups</option>
          {(groups.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>{g.name} ({g.members})</option>
          ))}
        </select>
        {canCreate && (
          <button type="button" onClick={() => setInviting(true)} className={`${btn} ms-auto`}>
            <UserPlus className="size-4" /> Invite students
          </button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-start text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3 text-start">Student</th>
              <th className="px-4 py-3 text-start">Groups</th>
              <th className="px-4 py-3 text-end">Courses</th>
              <th className="px-4 py-3 text-start">Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((s) => (
              <tr key={s.user_uuid} onClick={() => setOpen(s.user_uuid)} className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-neutral-900">{s.name}</p>
                  <p className="text-xs text-neutral-500">{s.email}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {s.groups.map((g) => (
                      <span key={g.id} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">{g.name}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-end tabular-nums">{s.courses_enrolled}</td>
                <td className="px-4 py-3 text-neutral-600">{s.last_login_at ? when(s.last_login_at) : 'Never'}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-neutral-500">No students match.</td></tr>
            )}
            {!data && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-neutral-400"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.total > data.limit && (
        <div className="mt-3 flex items-center justify-end gap-3 text-sm text-neutral-600">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 disabled:opacity-40">Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      )}

      {open && <StudentPanel userUuid={open} canUpdate={canUpdate} onClose={() => setOpen(null)} groups={groups.data ?? []} />}
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </div>
  )
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const { orgId, token } = useCtx()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const emails = Array.from(new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)))

  const send = async () => {
    setBusy(true)
    try {
      await inviteStudents(orgId, emails, token)
      toast.success(`${emails.length} invitation${emails.length === 1 ? '' : 's'} sent`)
      onClose()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Invite students" onClose={onClose}>
      <p className="text-sm text-neutral-600">Paste email addresses separated by commas, spaces or new lines. They join as students.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} className="mt-3 w-full rounded-lg border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400" placeholder="amina@example.com, brian@example.com" />
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-neutral-500">{emails.length} address{emails.length === 1 ? '' : 'es'} (up to 50 at a time)</span>
        <button type="button" onClick={send} disabled={busy || emails.length === 0 || emails.length > 50} className={btn}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} Send invitations
        </button>
      </div>
    </Modal>
  )
}

function StudentPanel({
  userUuid,
  canUpdate,
  groups,
  onClose,
}: {
  userUuid: string
  canUpdate: boolean
  groups: { id: number; name: string; members: number }[]
  onClose: () => void
}) {
  const { orgId, token } = useCtx()
  const qc = useQueryClient()
  const card = useQuery({ queryKey: ['fd', 'student', orgId, userUuid], queryFn: () => getStudent(orgId, userUuid, token), enabled: !!token })
  const [pick, setPick] = useState('')
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['fd', 'student', orgId, userUuid] })
    qc.invalidateQueries({ queryKey: ['fd', 'students'] })
    qc.invalidateQueries({ queryKey: ['fd', 'groups'] })
  }
  const c = card.data
  const available = groups.filter((g) => !c?.groups.some((x) => x.id === g.id))

  return (
    <Modal title={c?.name ?? 'Student'} onClose={onClose} wide>
      {!c ? (
        <Loader2 className="mx-auto my-8 size-5 animate-spin text-neutral-400" />
      ) : (
        <div className="space-y-5">
          <div className="text-sm text-neutral-700">
            <p>{c.email} {c.email_verified ? '' : <span className="ms-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">email not verified</span>}</p>
            <p className="text-xs text-neutral-500">@{c.username} · joined {when(c.joined)} · last sign-in {c.last_login_at ? when(c.last_login_at) : 'never'}</p>
          </div>
          {Object.keys(c.details).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Details given at sign-up</h4>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {Object.entries(c.details).map(([k, v]) => (
                  <React.Fragment key={k}><dt className="text-neutral-500">{k}</dt><dd className="text-neutral-900">{String(v)}</dd></React.Fragment>
                ))}
              </dl>
            </div>
          )}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Groups</h4>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {c.groups.length === 0 && <span className="text-sm text-neutral-500">Not in any group.</span>}
              {c.groups.map((g) => (
                <span key={g.id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-800">
                  {g.name}
                  {canUpdate && (
                    <button type="button" aria-label={`Remove from ${g.name}`} onClick={async () => { try { await removeFromGroup(orgId, g.id, userUuid, token); refresh() } catch (e) { fail(e) } }}>
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
              {canUpdate && available.length > 0 && (
                <span className="inline-flex items-center gap-2">
                  <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${input} h-8 text-xs`}>
                    <option value="">Add to group...</option>
                    {available.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <button type="button" disabled={!pick} onClick={async () => { try { await addToGroup(orgId, Number(pick), userUuid, token); setPick(''); refresh() } catch (e) { fail(e) } }} className="h-8 rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white disabled:opacity-40">Add</button>
                </span>
              )}
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Courses</h4>
            {c.courses.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">Not enrolled in any course yet.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {c.courses.map((course) => (
                  <li key={course.course_uuid}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-neutral-900">{course.name}</span>
                      <span className="flex items-center gap-2">
                        <AccessBadge access={course.access} />
                        <span className="tabular-nums text-neutral-600">{course.progress_percent}%</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-neutral-100"><div className="h-1.5 rounded-full bg-neutral-800" style={{ width: `${course.progress_percent}%` }} /></div>
                    <p className="mt-0.5 text-[11px] text-neutral-500">{course.activities_done} of {course.activities_total} lessons done</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function AccessBadge({ access }: { access: string }) {
  const map: Record<string, string> = {
    free: 'bg-neutral-100 text-neutral-600',
    paid: 'bg-emerald-50 text-emerald-700',
    unpaid: 'bg-rose-50 text-rose-700',
    unknown: 'bg-neutral-100 text-neutral-500',
  }
  const label: Record<string, string> = { free: 'Free', paid: 'Paid', unpaid: 'Not paid', unknown: 'Unknown' }
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[access] ?? map.unknown}`}>{label[access] ?? access}</span>
}

// ---------------------------------------------------------------------------

function Today({ canUpdate }: { canUpdate: boolean }) {
  const { orgId, token } = useCtx()
  const today = useQuery({ queryKey: ['fd', 'today', orgId], queryFn: () => getToday(orgId, token), enabled: !!orgId && !!token, refetchInterval: 15000 })
  const [roster, setRoster] = useState<string | null>(null)
  const [resend, setResend] = useState<{ uuid: string; title: string } | null>(null)
  const d = today.data

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900"><CalendarClock className="size-4" /> Live classes</h2>
        <ul className="mt-3 divide-y divide-neutral-100">
          {(d?.classes ?? []).map((c) => (
            <li key={c.session_uuid} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-900">{c.title}</p>
                <p className="text-xs text-neutral-500">{c.course} · {when(c.scheduled_at)} · {c.status}</p>
              </div>
              {canUpdate && (
                <button type="button" onClick={() => setResend({ uuid: c.session_uuid, title: c.title })} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50">
                  <Mail className="size-3.5" /> Resend link
                </button>
              )}
            </li>
          ))}
          {d && d.classes.length === 0 && <li className="py-6 text-sm text-neutral-500">No classes in the next 7 days.</li>}
        </ul>
      </section>
      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900"><ClipboardCheck className="size-4" /> Exams and CATs</h2>
        <ul className="mt-3 divide-y divide-neutral-100">
          {(d?.exams ?? []).map((e) => (
            <li key={e.assignment_uuid} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-900">{e.title}</p>
                <p className="text-xs text-neutral-500">{e.course} · {e.duration_minutes} min{e.opens_at ? ` · opens ${when(e.opens_at)}` : ''}</p>
                <p className="text-xs text-neutral-500">{e.in_progress} sitting · {e.submitted} handed in</p>
              </div>
              <button type="button" onClick={() => setRoster(e.assignment_uuid)} className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50">Open roster</button>
            </li>
          ))}
          {d && d.exams.length === 0 && <li className="py-6 text-sm text-neutral-500">No exams coming up.</li>}
        </ul>
      </section>
      {roster && <RosterPanel assignmentUuid={roster} onClose={() => setRoster(null)} />}
      {resend && <ResendDialog session={resend} onClose={() => setResend(null)} />}
    </div>
  )
}

function RosterPanel({ assignmentUuid, onClose }: { assignmentUuid: string; onClose: () => void }) {
  const { orgId, token } = useCtx()
  const roster = useQuery({ queryKey: ['fd', 'roster', orgId, assignmentUuid], queryFn: () => getExamRoster(orgId, assignmentUuid, token), enabled: !!token, refetchInterval: 3000 })
  const r = roster.data
  const label: Record<string, string> = { not_started: 'Not started', in_progress: 'Sitting', submitted: 'Handed in' }
  return (
    <Modal title={r?.title ? `${r.title}: who is here` : 'Exam roster'} onClose={onClose} wide>
      {!r ? (
        <Loader2 className="mx-auto my-8 size-5 animate-spin text-neutral-400" />
      ) : (
        <>
          <p className="text-xs text-neutral-500">Read-only. Updates every 3 seconds. {r.counts.not_started} not started · {r.counts.in_progress} sitting · {r.counts.submitted} handed in · {r.counts.disconnected} disconnected</p>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {r.students.map((s: any) => (
                <tr key={s.user_uuid} className="border-b border-neutral-100">
                  <td className="py-2 pe-3"><p className="font-medium text-neutral-900">{s.name}</p><p className="text-xs text-neutral-500">@{s.username}</p></td>
                  <td className="py-2 pe-3">{label[s.status]}</td>
                  <td className="py-2 pe-3 text-xs text-neutral-600">
                    {s.status === 'in_progress' ? `${s.connected ? 'Connected' : 'Disconnected'} · camera ${s.camera_on ? 'on' : 'off'} · screen ${s.screen_shared ? 'shared' : 'not shared'}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}

function ResendDialog({ session, onClose }: { session: { uuid: string; title: string }; onClose: () => void }) {
  const { orgId, token } = useCtx()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sending, setSending] = useState<string | null>(null)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search), 300)
    return () => window.clearTimeout(id)
  }, [search])
  const found = useQuery({
    queryKey: ['fd', 'resend', orgId, debounced],
    queryFn: () => listStudents(orgId, { search: debounced }, token),
    enabled: !!token && debounced.trim().length >= 2,
  })
  const send = async (s: FDStudent) => {
    setSending(s.user_uuid)
    try {
      const res = await resendClassLink(orgId, session.uuid, s.user_uuid, token)
      toast.success(res.queued ? `Link sent to ${s.email}` : 'Nothing was sent: email may not be enabled for this school')
    } catch (e) {
      fail(e)
    } finally {
      setSending(null)
    }
  }
  return (
    <Modal title={`Resend link: ${session.title}`} onClose={onClose}>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find the student by name or email" className={`${input} w-full`} autoFocus />
      <ul className="mt-3 max-h-72 divide-y divide-neutral-100 overflow-y-auto">
        {(found.data?.items ?? []).map((s) => (
          <li key={s.user_uuid} className="flex items-center justify-between gap-3 py-2.5">
            <div><p className="text-sm font-medium text-neutral-900">{s.name}</p><p className="text-xs text-neutral-500">{s.email}</p></div>
            <button type="button" onClick={() => send(s)} disabled={sending === s.user_uuid} className="h-8 rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white disabled:opacity-50">
              {sending === s.user_uuid ? 'Sending...' : 'Send'}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className={`max-h-[85vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-xl ${wide ? 'max-w-2xl' : 'max-w-md'}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold text-neutral-900">{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1 text-neutral-500 hover:bg-neutral-100"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
