'use client'
// Read-only view of what a school sees. Needs a reason, lasts 30 minutes, every
// page opened is written to the audit log.
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { ArrowLeft, Eye } from '@phosphor-icons/react'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import useStaffAccess from '@components/Hooks/useStaffAccess'
import { getViewAsPage, startViewAs, type ViewAsPage } from '@services/ee/superadmin'

const money = (cents?: number | null) =>
  `KES ${((cents ?? 0) / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
const day = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '·'

const PAGES: { id: ViewAsPage; label: string; capability: string }[] = [
  { id: 'billing', label: 'Billing', capability: 'billing_read' },
  { id: 'invoices', label: 'Invoices', capability: 'billing_read' },
  { id: 'ledger', label: 'Wallet', capability: 'billing_read' },
  { id: 'members', label: 'Members', capability: 'read' },
]

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-[#737373]">
            {head.map((h) => (
              <th key={h} className="px-4 py-3 text-start font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-black/5 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3 text-[#262626]">{c}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={head.length} className="px-4 py-8 text-center text-[#737373]">Nothing here.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Content({ page, data }: { page: ViewAsPage; data: any }) {
  if (page === 'billing') {
    const stat = (label: string, value: React.ReactNode) => (
      <div className="rounded-2xl border border-black/10 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-[#737373]">{label}</div>
        <div className="mt-1 text-lg font-semibold text-[#262626]">{value}</div>
      </div>
    )
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stat('Plan', data.effective_plan || data.plan)}
          {stat('Wallet', money(data.wallet_balance_cents))}
          {stat('Spent this month', money(data.spent_this_month_cents))}
          {stat('Renews', day(data.period_end))}
        </div>
        <Table
          head={['Usage', 'Used', 'Limit']}
          rows={Object.entries(data.meters || {}).map(([k, v]: [string, any]) => [k.replaceAll('_', ' '), v.used, v.limit ?? 'Unlimited'])}
        />
        <Table
          head={['Open invoice', 'Period', 'Total', 'Status']}
          rows={(data.open_invoices || []).map((i: any) => [i.number, i.period, money(i.total_cents), i.status])}
        />
      </div>
    )
  }
  if (page === 'invoices') {
    return <Table head={['Number', 'Period', 'Total', 'Status', 'Paid via', 'Date']} rows={data.map((i: any) => [i.number, i.period, money(i.total_cents), i.status, i.paid_via || '·', day(i.created_at)])} />
  }
  if (page === 'ledger') {
    return <Table head={['Date', 'Kind', 'Amount', 'Balance after']} rows={data.map((r: any) => [day(r.created_at), r.kind, money(r.amount_cents), money(r.balance_after_cents)])} />
  }
  return <Table head={['Name', 'Username', 'Email', 'Role ID']} rows={data.map((m: any) => [m.name, m.username, m.email, m.role_id])} />
}

export default function ViewAsSchoolPage() {
  const { orgId } = useParams() as { orgId: string }
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const { can } = useStaffAccess()
  const [reason, setReason] = useState('')
  const [grant, setGrant] = useState<{ grant: string; expires_at: string; org: { name: string } } | null>(null)
  const [page, setPage] = useState<ViewAsPage>('billing')
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const secondsLeft = grant ? Math.max(0, Math.floor((new Date(grant.expires_at).getTime() - now) / 1000)) : 0
  const expired = !!grant && secondsLeft === 0

  useEffect(() => {
    if (!grant || !token || expired) return
    let cancelled = false
    setBusy(true)
    getViewAsPage(token, grant.grant, Number(orgId), page)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && toast.error(e.message))
      .finally(() => !cancelled && setBusy(false))
    return () => {
      cancelled = true
    }
    // expired is intentionally excluded: reaching expiry must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant, page, token, orgId])

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setBusy(true)
    try {
      setGrant(await startViewAs(token, Number(orgId), reason.trim()))
      setReason('')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <Link href={`/admin/organizations/${orgId}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-[#737373] hover:text-[#262626]">
      <ArrowLeft size={14} weight="bold" data-dir-flip /> Back to school
    </Link>
  )

  if (!grant || expired) {
    return (
      <div className="p-8 max-w-xl">
        {back}
        <h1 className="text-2xl font-bold text-[#262626]">View as school</h1>
        <p className="mt-1 mb-5 text-[#737373]">
          Read-only. You see what the school sees, for 30 minutes. Nothing can be changed from here. Your reason and every page you open are recorded in the audit log.
        </p>
        {expired && <p className="mb-3 text-sm text-red-600">The last view expired. Start a new one.</p>}
        <form onSubmit={start} className="space-y-3">
          <textarea required minLength={5} rows={3} placeholder="Why do you need to look? e.g. customer asked about invoice INV-204" className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-[#262626]" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#262626] px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">
            <Eye size={16} weight="bold" /> Start viewing
          </button>
        </form>
      </div>
    )
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')
  return (
    <div className="p-8">
      {back}
      <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-[#262626]">
        <span><strong>Viewing {grant.org.name} as the school (read-only).</strong> Everything you open is logged.</span>
        <span className="font-mono">{mm}:{ss}</span>
      </div>
      <div className="mb-5 flex gap-1 border-b border-black/10">
        {PAGES.filter((p) => can(p.capability)).map((p) => (
          <button key={p.id} onClick={() => { setData(null); setPage(p.id) }} className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${page === p.id ? 'border-[#262626] text-[#262626]' : 'border-transparent text-[#737373]'}`}>
            {p.label}
          </button>
        ))}
      </div>
      {data ? <Content page={page} data={data} /> : <p className="text-[#737373]">{busy ? 'Loading...' : ''}</p>}
    </div>
  )
}
