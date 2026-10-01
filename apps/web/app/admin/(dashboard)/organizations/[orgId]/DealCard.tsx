'use client'
import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'

const GB = 1024 ** 3
const HOUR = 3600

// field → [label, unit shown to the operator, multiplier to the stored unit]
const FIELDS: [string, string, string, number][] = [
  ['instructor_seats', 'Instructor seats', '', 1],
  ['learner_allowance', 'Active learners', '', 1],
  ['storage_bytes', 'Storage', 'GB', GB],
  ['live_seconds_month', 'Live class hours / month', 'h', HOUR],
  ['live_concurrency', 'Simultaneous live classes', '', 1],
  ['premium_ai_credits_month', 'Premium AI credits / month', '', 1],
  ['code_runs_month', 'Code runs / month', '', 1],
]
const FEATURES = ['api', 'webhooks', 'zapier', 'custom_domain', 'sso', 'managed_email', 'remove_badge']
const METHODS = ['bank_transfer', 'mpesa', 'cash', 'cheque', 'paystack_other', 'other']
const PLANS = ['starter', 'growth', 'business', 'enterprise']

const kes = (c?: number | null) => (c == null ? '—' : `KES ${(c / 100).toLocaleString()}`)
const show = (v: any, mult: number, unit: string) =>
  v === null ? 'Unlimited' : v === undefined ? '—' : `${Math.round((v / mult) * 100) / 100}${unit ? ' ' + unit : ''}`

// Superadmin: agree custom terms with a school (allowances, features, a custom
// price the monthly cycle invoices) and record payments made outside Paystack.
export default function DealCard({ orgId, accessToken }: { orgId: string; accessToken: string }) {
  const qc = useQueryClient()
  const base = `${getAPIUrl()}superadmin/billing/orgs/${orgId}`
  const dealQ = useQuery({ queryKey: ['sa-deal', orgId], queryFn: () => apiFetch(`${base}/deal`, accessToken), enabled: !!accessToken })
  const billQ = useQuery({ queryKey: ['superadmin', 'billing', orgId], queryFn: () => apiFetch(base, accessToken), enabled: !!accessToken })
  const [reason, setReason] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [price, setPrice] = useState('')
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [method, setMethod] = useState('bank_transfer')
  const [payRef, setPayRef] = useState('')
  const [mp, setMp] = useState({ plan: 'growth', cycle: 'monthly', months: '1', amount: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const deal = dealQ.data
  const openInvoices = (billQ.data?.invoices || []).filter((i: any) => i.status === 'open' || i.status === 'failed')
  const reasonOk = reason.trim().length >= 3

  const call = async (path: string, method: string, body: object, ok: string) => {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ ...body, reason }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof d.detail === 'string' ? d.detail : `Failed (${res.status})`)
      setMsg(ok)
      setEdits({})
      qc.invalidateQueries({ queryKey: ['sa-deal', orgId] })
      qc.invalidateQueries({ queryKey: ['superadmin', 'billing', orgId] })
    } catch (e: any) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  const saveAllowances = () => {
    const allowances: Record<string, number | null | string> = {}
    for (const [field, , , mult] of FIELDS) {
      const v = edits[field]
      if (v === undefined) continue
      if (v === 'default') allowances[field] = 'default'
      else if (v === 'unlimited') allowances[field] = null
      else if (v.trim() !== '' && !isNaN(Number(v))) allowances[field] = Math.round(Number(v) * mult)
    }
    call('/deal', 'PUT', { allowances }, 'Allowances saved')
  }

  if (!deal) return null
  const input = 'rounded-lg border border-black/10 px-2 py-1 text-sm'
  const btn = 'rounded-lg bg-[#262626] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40'

  return (
    <div className="rounded-xl border border-black/[0.06] p-4 space-y-5">
      <div>
        <h3 className="text-sm font-medium text-[#262626]">Custom deal &amp; manual payments</h3>
        <p className="text-xs text-[#262626]/50">
          Plan: <b>{deal.plan}</b> · list price {kes(deal.plan_price_cents)} / mo
          {deal.custom_price_cents != null && (
            <> · custom price <b>{kes(deal.custom_price_cents)}</b> / {deal.cycle === 'yearly' ? 'year' : 'month'}</>
          )}
        </p>
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, audit-logged)" className={`w-full ${input} py-1.5`} />

      {/* Allowances */}
      <div>
        <p className="text-xs font-semibold text-[#262626]/70 mb-2">Allowances (overrides the plan)</p>
        <div className="space-y-1.5">
          {FIELDS.map(([field, label, unit, mult]) => {
            const overridden = field in (deal.allowances || {})
            const v = edits[field] ?? ''
            return (
              <div key={field} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-52 text-[#262626]/70">{label}</span>
                <span className="w-28 text-xs text-[#262626]/50">now: {show(deal.effective?.[field], mult, unit)}{overridden ? ' *' : ''}</span>
                <input
                  value={v === 'unlimited' || v === 'default' ? '' : v}
                  onChange={(e) => setEdits({ ...edits, [field]: e.target.value })}
                  placeholder={unit ? `new (${unit})` : 'new'}
                  className={`${input} w-24`}
                />
                <button onClick={() => setEdits({ ...edits, [field]: 'unlimited' })} className={`text-xs underline ${v === 'unlimited' ? 'font-bold' : ''}`}>unlimited</button>
                {overridden && (
                  <button onClick={() => setEdits({ ...edits, [field]: 'default' })} className={`text-xs underline ${v === 'default' ? 'font-bold' : ''}`}>reset to plan</button>
                )}
              </div>
            )
          })}
        </div>
        <p className="mt-1 text-[11px] text-[#262626]/40">* agreed for this school. Nothing is charged for allowances.</p>
        <button disabled={busy || !reasonOk || !Object.keys(edits).length} onClick={saveAllowances} className={`${btn} mt-2`}>Save allowances</button>
      </div>

      {/* Features */}
      <div>
        <p className="text-xs font-semibold text-[#262626]/70 mb-2">Extra features</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {FEATURES.map((f) => (
            <label key={f} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!deal.features?.[f]}
                disabled={busy || !reasonOk}
                onChange={(e) => call('/deal', 'PUT', { features: { [f]: e.target.checked } }, 'Feature updated')}
              />
              {f.replace('_', ' ')}
            </label>
          ))}
        </div>
      </div>

      {/* Custom price */}
      <div>
        <p className="text-xs font-semibold text-[#262626]/70 mb-2">Custom price (invoiced by the billing cycle)</p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Amount in KES" className={`${input} w-36`} />
          <select value={cycle} onChange={(e) => setCycle(e.target.value as any)} className={input}>
            <option value="monthly">per month</option>
            <option value="yearly">per year</option>
          </select>
          <button
            disabled={busy || !reasonOk || !(Number(price) > 0)}
            onClick={() => call('/deal', 'PUT', { custom_price_cents: Math.round(Number(price) * 100), cycle }, 'Custom price saved; the next billing run invoices it')}
            className={btn}
          >
            Set price
          </button>
          {deal.custom_price_cents != null && (
            <button disabled={busy || !reasonOk} onClick={() => call('/deal', 'PUT', { clear_price: true }, 'Custom price removed')} className="text-xs underline">
              remove custom price
            </button>
          )}
        </div>
      </div>

      {/* Manual payments */}
      <div>
        <p className="text-xs font-semibold text-[#262626]/70 mb-2">Payment received outside Paystack</p>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={input}>
            {METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
          </select>
          <input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Payment reference (e.g. M-Pesa code)" className={`${input} w-64`} />
        </div>
        {openInvoices.length > 0 ? (
          <div className="space-y-1 mb-3">
            {openInvoices.map((i: any) => (
              <div key={i.id} className="flex items-center gap-3 text-sm">
                <span>{i.number} · {kes(i.total_cents)}</span>
                <button
                  disabled={busy || !reasonOk}
                  onClick={() => {
                    if (!window.confirm(`Mark ${i.number} (${kes(i.total_cents)}) as paid by ${method}?`)) return
                    call(`/invoices/${i.id}/mark-paid`, 'POST', { method, payment_reference: payRef }, `${i.number} marked paid`)
                  }}
                  className="text-xs font-semibold underline disabled:opacity-40"
                >
                  Mark paid
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#262626]/40 mb-3">No unpaid invoices.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[#262626]/70">Activate</span>
          <select value={mp.plan} onChange={(e) => setMp({ ...mp, plan: e.target.value })} className={input}>
            {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className="text-sm text-[#262626]/70">for</span>
          <input value={mp.months} onChange={(e) => setMp({ ...mp, months: e.target.value })} className={`${input} w-14`} />
          <span className="text-sm text-[#262626]/70">month(s), paid KES</span>
          <input value={mp.amount} onChange={(e) => setMp({ ...mp, amount: e.target.value })} placeholder="0" className={`${input} w-28`} />
          <button
            disabled={busy || !reasonOk || !(Number(mp.months) >= 1)}
            onClick={() => {
              if (!window.confirm(`Activate ${mp.plan} for ${mp.months} month(s), paid KES ${mp.amount || 0} by ${method}?`)) return
              call('/manual-plan', 'POST', {
                plan: mp.plan,
                cycle: Number(mp.months) >= 12 ? 'yearly' : 'monthly',
                months: Number(mp.months),
                amount_cents: Math.round(Number(mp.amount || 0) * 100),
                method,
                payment_reference: payRef,
              }, 'Plan activated and receipt sent')
            }}
            className={btn}
          >
            Activate
          </button>
        </div>
      </div>
      {msg && <p className="text-xs text-[#262626]/70">{msg}</p>}
    </div>
  )
}
