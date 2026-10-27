'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getMoneyDashboard, getSchoolsPayments } from '@services/ee/superadmin'

const money = (cents: number) => `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`

export default function MoneyDashboard() {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const [d, setD] = useState<any>(null)
  const [schools, setSchools] = useState<any>(null)

  useEffect(() => {
    if (!token) return
    getMoneyDashboard(token).then(setD).catch((e) => toast.error(e.message))
    getSchoolsPayments(token).then(setSchools).catch((e) => toast.error(e.message))
  }, [token])

  if (!d) return <p className="text-[#737373]">Loading...</p>
  const max = Math.max(1, ...d.collected_by_month.map((m: any) => m.cents))
  const card = 'rounded-2xl border border-black/10 bg-white p-5'
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={card}><div className="text-xs uppercase tracking-wide text-[#737373]">Unpaid</div><div className="mt-1 text-2xl font-semibold text-[#262626]">{money(d.unpaid_total_cents)}</div></div>
        <div className={card}><div className="text-xs uppercase tracking-wide text-[#737373]">Wallets held</div><div className="mt-1 text-2xl font-semibold text-[#262626]">{money(d.wallet_held_cents)}</div></div>
        <div className={card}><div className="text-xs uppercase tracking-wide text-[#737373]">Recorded by hand</div><div className="mt-1 text-2xl font-semibold text-[#262626]">{money(d.recorded_manually.cents)}</div><div className="text-xs text-[#737373]">{d.recorded_manually.count} invoices</div></div>
      </div>

      {schools && (
        <section className={card}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-[#262626]">What schools pay us</h2>
            <span className="text-sm text-[#737373]">
              {money(schools.totals.paid_cents)} in total · {money(schools.totals.this_month_cents)} this month · {schools.totals.schools_paying} schools paying
            </span>
          </div>
          <p className="mb-3 text-xs text-[#737373]">
            Paystack payments (including wallet top-ups) plus payments recorded by hand. Spending a wallet balance is not counted twice.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-[#737373]">
                  {['School', 'Plan', 'Paid in total', 'This month', 'Last month', 'By hand', 'Unpaid', 'Wallet'].map((h, i) => (
                    <th key={h} className={`py-2 font-semibold ${i < 2 ? 'text-start' : 'text-end'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schools.items.map((i: any) => (
                  <tr key={i.org_id} className="border-t border-black/5">
                    <td className="py-2">
                      <Link href={`/admin/organizations/${i.org_id}?tab=plan`} className="font-medium text-[#262626] hover:underline">{i.org_name}</Link>
                    </td>
                    <td className="py-2 capitalize text-[#737373]">{i.plan || '·'}</td>
                    <td className="py-2 text-end font-semibold text-[#262626]">{money(i.paid_cents)}</td>
                    <td className="py-2 text-end">{money(i.this_month_cents)}</td>
                    <td className="py-2 text-end text-[#737373]">{money(i.last_month_cents)}</td>
                    <td className="py-2 text-end text-[#737373]">{money(i.paid_manual_cents)}</td>
                    <td className={`py-2 text-end ${i.unpaid_cents ? 'font-semibold text-red-600' : 'text-[#737373]'}`}>{money(i.unpaid_cents)}</td>
                    <td className="py-2 text-end text-[#737373]">{money(i.wallet_cents)}</td>
                  </tr>
                ))}
                {schools.items.length === 0 && (
                  <tr><td colSpan={8} className="py-8 text-center text-[#737373]">No payments from schools yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={card}>
        <h2 className="mb-4 font-semibold text-[#262626]">Collected by month</h2>
        <div className="space-y-2">
          {d.collected_by_month.map((m: any) => (
            <div key={m.month} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-[#737373]">{m.month}</span>
              <div className="h-5 flex-1 rounded bg-black/[0.05]">
                <div className="h-5 rounded bg-[#262626]" style={{ width: `${(m.cents / max) * 100}%` }} />
              </div>
              <span className="w-36 shrink-0 text-end text-[#262626]">{money(m.cents)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-3 font-semibold text-[#262626]">How long invoices have been unpaid</h2>
          {d.unpaid_aging.map((b: any) => (
            <div key={b.label} className="flex justify-between border-b border-black/5 py-2 text-sm last:border-0">
              <span className="text-[#262626]">{b.label}</span>
              <span className="text-[#737373]">{b.count} · {money(b.cents)}</span>
            </div>
          ))}
        </section>
        <section className={card}>
          <h2 className="mb-3 font-semibold text-[#262626]">Subscriptions by plan</h2>
          {Object.entries(d.subscriptions_by_plan).map(([plan, n]) => (
            <div key={plan} className="flex justify-between border-b border-black/5 py-2 text-sm last:border-0">
              <span className="capitalize text-[#262626]">{plan}</span>
              <span className="text-[#737373]">{n as number}</span>
            </div>
          ))}
        </section>
      </div>

      <section className={card}>
        <h2 className="mb-3 font-semibold text-[#262626]">Largest wallet balances</h2>
        {d.largest_wallets.map((w: any) => (
          <Link key={w.org_id} href={`/admin/organizations/${w.org_id}?tab=plan`} className="flex justify-between border-b border-black/5 py-2 text-sm last:border-0 hover:underline">
            <span className="text-[#262626]">{w.org_name}</span>
            <span className="text-[#737373]">{money(w.cents)}</span>
          </Link>
        ))}
        {d.largest_wallets.length === 0 && <p className="text-sm text-[#737373]">No balances.</p>}
      </section>
    </div>
  )
}
