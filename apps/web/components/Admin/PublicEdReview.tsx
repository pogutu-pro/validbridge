'use client'
// Superadmin review queue for Public Education applications.
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle, FileText, SealCheck, Warning, XCircle } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import {
  listPublicEdApplications,
  openPublicEdDocument,
  reviewPublicEdApplication,
  type PublicEdApplicationRow,
  type PublicEdStatus,
} from '@services/ee/superadmin'

const TABS: { id: PublicEdStatus | 'all'; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
]

const TYPE_LABEL: Record<string, string> = {
  public_school: 'Public school',
  private_school: 'Private school',
  tvet_college: 'TVET or college',
  university: 'University',
  training_company: 'Training company',
  independent: 'Independent',
}

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '·'

function StatusPill({ status }: { status: PublicEdStatus }) {
  const cls =
    status === 'approved'
      ? 'bg-[#FFF3EC] text-[#B23907]'
      : status === 'rejected'
        ? 'bg-black/[0.05] text-[#737373]'
        : 'bg-[#FF5A1F] text-white'
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{status}</span>
}

function ApplicationCard({
  app,
  token,
  onReviewed,
}: {
  app: PublicEdApplicationRow
  token: string
  onReviewed: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)

  const review = async (decision: 'approve' | 'reject') => {
    if (decision === 'approve' && !window.confirm(`Approve ${app.institution}? The school moves to the free Public Education plan for 12 months.`)) return
    if (decision === 'reject' && !note.trim()) {
      toast.error('Add a short reason so the school knows what to fix.')
      return
    }
    setBusy(decision)
    try {
      await reviewPublicEdApplication(token, app.id, decision, note.trim())
      toast.success(decision === 'approve' ? 'Approved' : 'Rejected')
      onReviewed()
    } catch (e: any) {
      toast.error(e?.message || 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  const facts: [string, React.ReactNode][] = [
    ['Type', TYPE_LABEL[app.type] ?? app.type],
    ['Registration or TSC number', app.reg_number || 'Not given'],
    [
      'Email domain',
      app.email_domain ? (
        <span className="inline-flex items-center gap-1.5">
          {app.email_domain}
          {app.official_domain ? (
            <SealCheck size={15} weight="fill" className="text-[#FF5A1F]" aria-label="Official domain" />
          ) : (
            <Warning size={15} className="text-[#737373]" aria-label="Not an official domain" />
          )}
        </span>
      ) : (
        'Not given'
      ),
    ],
    ['Agreement', app.agreement_version ? `Accepted (${app.agreement_version})` : 'Not accepted'],
    ['Submitted', fmt(app.created_at)],
  ]
  if (app.status !== 'pending') facts.push(['Reviewed', fmt(app.reviewed_at)])
  if (app.status === 'approved') facts.push(['Expires', fmt(app.expires_at)])

  return (
    <div className="rounded-2xl border border-[#E7E5E4] bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-[#262626]">{app.institution}</div>
          <Link href={`/admin/organizations/${app.org_id}`} className="text-sm text-[#737373] hover:text-[#262626]">
            {app.org_name} · {app.org_slug}
          </Link>
        </div>
        <StatusPill status={app.status} />
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-[#E7E5E4]/60 py-1.5">
            <dt className="text-[#737373]">{k}</dt>
            <dd className="text-end font-medium text-[#262626]">{v}</dd>
          </div>
        ))}
      </dl>

      {app.review_note && (
        <p className="mt-3 rounded-xl bg-black/[0.03] px-3 py-2 text-sm text-[#737373]">Note: {app.review_note}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {app.has_document ? (
          <button
            type="button"
            onClick={() => openPublicEdDocument(token, app.id).catch((e) => toast.error(e.message))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E7E5E4] px-3 py-2 text-sm font-semibold text-[#262626] hover:bg-black/[0.03]"
          >
            <FileText size={16} /> View document
          </button>
        ) : (
          <span className="text-sm text-[#737373]">No document uploaded</span>
        )}
      </div>

      {app.status === 'pending' && (
        <div className="mt-4 flex flex-col gap-2 border-t border-[#E7E5E4] pt-4 sm:flex-row sm:items-center">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note to the school (required to reject)"
            aria-label="Review note"
            className="min-w-0 flex-1 rounded-lg border border-[#E7E5E4] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/30"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => review('reject')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E7E5E4] px-3 py-2 text-sm font-semibold text-[#262626] hover:bg-black/[0.03] disabled:opacity-50"
            >
              <XCircle size={16} /> {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => review('approve')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF5A1F] px-3 py-2 text-sm font-semibold text-white hover:bg-[#DE4710] disabled:opacity-50"
            >
              <CheckCircle size={16} /> {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PublicEdReview() {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const [tab, setTab] = useState<PublicEdStatus | 'all'>('pending')
  const [items, setItems] = useState<PublicEdApplicationRow[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!token) return
    setError('')
    try {
      const res = await listPublicEdApplications(token, tab === 'all' ? undefined : tab)
      setItems([...res.items].reverse())
    } catch (e: any) {
      setError(e?.message || 'Failed to load applications')
      setItems([])
    }
  }, [token, tab])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Application status" className="inline-flex rounded-xl bg-black/[0.04] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              if (t.id === tab) return
              setItems(null)
              setTab(t.id)
            }}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-white text-[#262626] shadow-sm' : 'text-[#737373] hover:text-[#262626]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-[#B23907]">{error}</p>}

      {items === null ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-black/[0.04]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E7E5E4] bg-white px-6 py-12 text-center text-sm text-[#737373]">
          {tab === 'pending' ? 'No applications waiting for review.' : 'No applications here yet.'}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {items.map((app) => (
            <ApplicationCard key={app.id} app={app} token={token!} onReviewed={load} />
          ))}
        </div>
      )}
    </div>
  )
}
