'use client'
// Searchable view of superadmin actions, with CSV export.
import React, { useCallback, useEffect, useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import useStaffAccess from '@components/Hooks/useStaffAccess'
import {
  downloadAuditCsv,
  getAuditLog,
  type AuditFilters,
  type AuditRow,
} from '@services/ee/superadmin'

const LIMIT = 25

const fmt = (d: string) =>
  new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const label = (action: string) => action.replace(/^superadmin\./, '')

function Change({ before, after }: { before: unknown; after: unknown }) {
  if (!before && !after) return <span className="text-[#737373]">·</span>
  return (
    <div className="space-y-0.5 font-mono text-xs">
      {before ? <div className="text-[#737373] break-all">{JSON.stringify(before)}</div> : null}
      {after ? <div className="text-[#262626] break-all">{JSON.stringify(after)}</div> : null}
    </div>
  )
}

export default function AuditLogViewer() {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const { role } = useStaffAccess()
  const [filters, setFilters] = useState<AuditFilters>({ kind: 'actions', page: 1, limit: LIMIT })
  const [draft, setDraft] = useState({ q: '', actor: '', org_id: '', since: '', until: '' })
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const data = await getAuditLog(token, filters)
      setRows(data.items)
      setTotal(data.total)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, filters])

  useEffect(() => {
    load()
  }, [load])

  const apply = (e: React.FormEvent) => {
    e.preventDefault()
    setFilters((f) => ({
      ...f,
      ...draft,
      since: draft.since ? new Date(draft.since).toISOString() : '',
      until: draft.until ? new Date(draft.until + 'T23:59:59').toISOString() : '',
      page: 1,
    }))
  }

  const exportCsv = async () => {
    if (!token) return
    try {
      await downloadAuditCsv(token, filters)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const pages = Math.max(1, Math.ceil(total / LIMIT))
  const page = filters.page || 1
  const input = 'rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-[#262626]'

  return (
    <div className="space-y-4">
      <form onSubmit={apply} className="flex flex-wrap items-end gap-3 rounded-2xl border border-black/10 bg-white p-4">
        <input aria-label="Search" placeholder="Search action, reason, reference" className={`${input} min-w-56 flex-1`} value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        <input aria-label="Actor" placeholder="Actor" className={`${input} w-36`} value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} />
        <input aria-label="School ID" placeholder="School ID" inputMode="numeric" className={`${input} w-28`} value={draft.org_id} onChange={(e) => setDraft({ ...draft, org_id: e.target.value.replace(/\D/g, '') })} />
        <label className="text-xs text-[#737373]">
          From
          <input type="date" className={`${input} ms-2`} value={draft.since} onChange={(e) => setDraft({ ...draft, since: e.target.value })} />
        </label>
        <label className="text-xs text-[#737373]">
          To
          <input type="date" className={`${input} ms-2`} value={draft.until} onChange={(e) => setDraft({ ...draft, until: e.target.value })} />
        </label>
        {role === 'owner' && (
          <select
            aria-label="Log type"
            className={input}
            value={filters.kind}
            onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value as 'actions' | 'requests', page: 1 }))}
          >
            <option value="actions">Console actions</option>
            <option value="requests">All requests</option>
          </select>
        )}
        <button type="submit" className="rounded-lg bg-[#262626] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
          Search
        </button>
        <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold text-[#262626] hover:bg-black/[0.04]">
          <DownloadSimple size={16} weight="bold" /> CSV
        </button>
      </form>

      {role === 'finance' && (
        <p className="text-xs text-[#737373]">Finance sees billing and payment actions only.</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-start text-xs uppercase tracking-wide text-[#737373]">
              <th className="px-4 py-3 text-start font-semibold">When</th>
              <th className="px-4 py-3 text-start font-semibold">Who</th>
              <th className="px-4 py-3 text-start font-semibold">Action</th>
              <th className="px-4 py-3 text-start font-semibold">School</th>
              <th className="px-4 py-3 text-start font-semibold">Reason</th>
              <th className="px-4 py-3 text-start font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-black/5 align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-3 text-[#737373]">{fmt(r.created_at)}</td>
                <td className="px-4 py-3 font-medium text-[#262626]">{r.actor || '·'}</td>
                <td className="px-4 py-3 font-mono text-xs text-[#262626]">{label(r.action)}</td>
                <td className="px-4 py-3 text-[#262626]">{r.org_name || (r.org_id ? `#${r.org_id}` : '·')}</td>
                <td className="max-w-xs px-4 py-3 text-[#262626]">{r.reason || '·'}</td>
                <td className="max-w-sm px-4 py-3"><Change before={r.before} after={r.after} /></td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[#737373]">No matching entries.</td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[#737373]">Loading...</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-[#737373]">
        <span>{total} entries</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setFilters((f) => ({ ...f, page: page - 1 }))} className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40">Previous</button>
          <span>Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setFilters((f) => ({ ...f, page: page + 1 }))} className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  )
}
