'use client'
// Platform overview: totals, money to chase, plans about to change, suspended schools, what is live.
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getCommandCenter } from '@services/ee/superadmin'

const money = (cents: number) => `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '·')

function Panel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5">
      <h2 className="mb-3 font-semibold text-[#262626]">{title}</h2>
      {children.length ? <div className="divide-y divide-black/5">{children}</div> : <p className="text-sm text-[#737373]">{empty}</p>}
    </section>
  )
}

const Row = ({ href, left, right }: { href: string; left: React.ReactNode; right: React.ReactNode }) => (
  <Link href={href} className="flex items-center justify-between gap-3 py-2 text-sm hover:underline">
    <span className="min-w-0 truncate text-[#262626]">{left}</span>
    <span className="shrink-0 text-[#737373]">{right}</span>
  </Link>
)

export default function CommandCenter() {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const [d, setD] = useState<any>(null)

  useEffect(() => {
    if (!token) return
    getCommandCenter(token).then(setD).catch((e) => toast.error(e.message))
  }, [token])

  if (!d) return <p className="text-[#737373]">Loading...</p>
  const stat = (label: string, value: React.ReactNode, tone = '') => (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-[#737373]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone || 'text-[#262626]'}`}>{value}</div>
    </div>
  )
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stat('Schools', d.totals.schools)}
        {stat('People', d.totals.people)}
        {stat('Suspended', d.totals.suspended, d.totals.suspended ? 'text-red-600' : '')}
        {stat('Unpaid', money(d.unpaid.cents), d.unpaid.count ? 'text-red-600' : '')}
        {stat('Sitting exams now', d.exam_students_now)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Overdue invoices" empty="Nothing overdue.">
          {d.overdue_invoices.map((i: any) => (
            <Row key={i.number} href={`/admin/organizations/${i.org_id}?tab=plan`} left={`${i.org_name} · ${i.number}`} right={`${money(i.total_cents)} · ${i.status}`} />
          ))}
        </Panel>
        <Panel title="Plans changing within 7 days" empty="No plan changes coming up.">
          {d.plan_changes_soon.map((c: any) => (
            <Row key={c.org_id} href={`/admin/organizations/${c.org_id}?tab=plan`} left={c.org_name} right={`${c.plan} to ${c.pending_plan} on ${day(c.on)}`} />
          ))}
        </Panel>
        <Panel title="Suspended schools" empty="No suspended schools.">
          {d.suspended_schools.map((s: any) => (
            <Row key={s.org_id} href={`/admin/organizations/${s.org_id}`} left={`${s.org_name} · ${s.reason}`} right={`since ${day(s.since)}`} />
          ))}
        </Panel>
        <Panel title="Live now" empty="No live classes or exams right now.">
          {[
            ...d.live_now.map((l: any) => (
              <Row key={l.session_uuid} href="/admin/monitors" left={`${l.title} · ${l.org_name}`} right="live class" />
            )),
            ...d.exams_now.map((e: any) => (
              <Row key={`e${e.assignment_id}`} href="/admin/monitors" left={`${e.title} · ${e.org_name}`} right={`${e.students} sitting`} />
            )),
          ]}
        </Panel>
      </div>
    </div>
  )
}
