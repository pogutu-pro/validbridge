'use client'
import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'

// Superadmin: keep a school's plan and limits open for a few days while a
// payment settles ("the money has left my account but you haven't got it").
// Nothing is charged or granted; it ends by itself and the school is emailed.
export default function BillingOverrideCard({ orgId, accessToken }: { orgId: string; accessToken: string }) {
  const queryClient = useQueryClient()
  const key = ['superadmin', 'billing', orgId]
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => apiFetch(`${getAPIUrl()}superadmin/billing/orgs/${orgId}`, accessToken),
    enabled: !!accessToken,
  })
  const [days, setDays] = useState(3)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const until: string | null = data?.account?.override_until ?? null

  const send = async (method: 'POST' | 'DELETE', body: object) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${getAPIUrl()}superadmin/billing/orgs/${orgId}/override`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(typeof d.detail === 'string' ? d.detail : `Failed (${res.status})`)
        return
      }
      setReason('')
      queryClient.invalidateQueries({ queryKey: key })
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-black/[0.06] p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-[#262626]">Temporary limits override</h3>
        <p className="text-xs text-[#262626]/50 mt-0.5">
          Keeps the plan and every limit open while a payment clears. Lifts a billing pause too. Nothing is
          charged; it ends on its own and the school&apos;s admins are emailed.
        </p>
      </div>
      {data?.account && (
        <div className="text-xs text-[#262626]/60">
          Billing status: <b>{data.account.status}</b>
          {until && (
            <>
              {' · '}override active until <b>{new Date(until).toLocaleString()}</b>
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-black/10 px-2 py-1.5 text-sm"
        >
          {[1, 3, 7, 14, 30].map((d) => (
            <option key={d} value={d}>
              {d} day{d > 1 ? 's' : ''}
            </option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (sent to the school), e.g. M-Pesa paid, settling"
          className="flex-1 min-w-[220px] rounded-lg border border-black/10 px-3 py-1.5 text-sm"
        />
        <button
          disabled={busy || reason.trim().length < 3}
          onClick={() => send('POST', { days, reason, notify: true })}
          className="rounded-lg bg-[#262626] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {until ? 'Extend' : 'Override limits'}
        </button>
        {until && (
          <button
            disabled={busy || reason.trim().length < 3}
            onClick={() => send('DELETE', { reason })}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            End now
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
