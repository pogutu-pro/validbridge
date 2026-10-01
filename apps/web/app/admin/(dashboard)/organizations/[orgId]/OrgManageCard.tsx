'use client'
import React, { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'

const base = (orgId: string) => `${getAPIUrl()}ee/superadmin/organizations/${orgId}`

async function send(url: string, method: string, token: string, body: object) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Failed (${res.status})`)
  return data
}

// Superadmin: suspend / unsuspend a school, and delete it behind several
// deliberate steps (suspend first → confirm counts → type the slug and
// DELETE → wait → delete). Every action needs a reason and is audit-logged.
export default function OrgManageCard({ orgId, accessToken }: { orgId: string; accessToken: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const key = ['superadmin', 'org-status', orgId]
  const { data: s } = useQuery({
    queryKey: key,
    queryFn: () => apiFetch(`${base(orgId)}/status`, accessToken),
    enabled: !!accessToken,
  })
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [prep, setPrep] = useState<any>(null)
  const [typedSlug, setTypedSlug] = useState('')
  const [typedWord, setTypedWord] = useState('')
  const [ack, setAck] = useState(false)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const run = async (fn: () => Promise<any>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      queryClient.invalidateQueries({ queryKey: key })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!s) return null
  const reasonOk = reason.trim().length >= 3
  const canDelete = prep && typedSlug === prep.slug && typedWord === 'DELETE' && ack && wait === 0 && reasonOk

  return (
    <div className="rounded-xl border border-black/[0.06] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[#262626]">Manage organization</h3>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${s.suspended ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {s.suspended ? 'Suspended' : 'Active'}
        </span>
      </div>
      <p className="text-xs text-[#262626]/50">
        {s.members} members · {s.courses} courses
        {s.suspended && s.reason ? ` · suspended: ${s.reason}` : ''}
      </p>

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required, audit-logged)"
        className="w-full rounded-lg border border-black/10 px-3 py-1.5 text-sm"
      />

      {!s.suspended ? (
        <div className="flex flex-wrap gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message shown to the school's members (optional)"
            className="flex-1 min-w-[220px] rounded-lg border border-black/10 px-3 py-1.5 text-sm"
          />
          <button
            disabled={busy || !reasonOk || s.is_demo}
            onClick={() => {
              if (!window.confirm(`Suspend ${s.slug}? Members lose access until you unsuspend it.`)) return
              run(() => send(`${base(orgId)}/suspend`, 'POST', accessToken, { reason, message: message || null }))
            }}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Suspend
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy || !reasonOk}
            onClick={() => run(() => send(`${base(orgId)}/unsuspend`, 'POST', accessToken, { reason }))}
            className="rounded-lg bg-[#262626] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Unsuspend
          </button>
          {!prep && (
            <button
              disabled={busy || !reasonOk}
              onClick={() =>
                run(async () => {
                  const p = await send(`${base(orgId)}/delete/prepare`, 'POST', accessToken, { reason })
                  setPrep(p)
                  setWait(5)
                })
              }
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-40"
            >
              Delete organization…
            </button>
          )}
        </div>
      )}

      {prep && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
          <p className="text-sm font-semibold text-red-800">
            Permanently delete {prep.name}?
          </p>
          <p className="text-xs text-red-700">
            This deletes {prep.members} members&apos; access, {prep.courses} courses and everything in the
            organization. It cannot be undone. This confirmation expires in 10 minutes.
          </p>
          <input
            value={typedSlug}
            onChange={(e) => setTypedSlug(e.target.value)}
            placeholder={`Type the slug: ${prep.slug}`}
            className="w-full rounded-lg border border-red-200 px-3 py-1.5 text-sm"
          />
          <input
            value={typedWord}
            onChange={(e) => setTypedWord(e.target.value)}
            placeholder="Type DELETE"
            className="w-full rounded-lg border border-red-200 px-3 py-1.5 text-sm"
          />
          <label className="flex items-center gap-2 text-xs text-red-800">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I understand this is permanent and cannot be recovered.
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy || !canDelete}
              onClick={() =>
                run(async () => {
                  await send(base(orgId), 'DELETE', accessToken, {
                    reason,
                    confirm_token: prep.confirm_token,
                    confirm_slug: typedSlug,
                  })
                  router.push('/admin/organizations')
                })
              }
              className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {wait > 0 ? `Delete permanently (${wait})` : 'Delete permanently'}
            </button>
            <button
              onClick={() => {
                setPrep(null)
                setTypedSlug('')
                setTypedWord('')
                setAck(false)
              }}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
