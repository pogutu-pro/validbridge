'use client'
// Every school's earnings from its own students, ranked. School totals only.
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getSchoolsRevenue } from '@services/ee/superadmin'

export const money = (cents: number, currency = 'KES') =>
  `${currency} ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`

export default function SchoolsRevenue() {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const [d, setD] = useState<any>(null)

  useEffect(() => {
    if (!token) return
    getSchoolsRevenue(token).then(setD).catch((e) => toast.error(e.message))
  }, [token])

  if (!d) return <p className="text-[#737373]">Loading...</p>
  const card = 'rounded-2xl border border-black/10 bg-white p-4'
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {d.totals.map((t: any) => (
          <div key={t.currency} className={card}>
            <div className="text-xs uppercase tracking-wide text-[#737373]">All schools · {t.currency}</div>
            <div className="mt-1 text-2xl font-semibold text-[#262626]">{money(t.net_cents, t.currency)}</div>
            <div className="mt-1 text-xs text-[#737373]">
              {money(t.this_month_cents, t.currency)} this month · {money(t.outstanding_cents, t.currency)} still owed to schools
            </div>
          </div>
        ))}
        {d.totals.length === 0 && <div className={card}>No school payments recorded yet.</div>}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-[#737373]">
              {['School', 'Total earned', 'This month', 'Last month', 'Refunded', 'Still owed', 'Payments'].map((h, i) => (
                <th key={h} className={`px-4 py-3 font-semibold ${i === 0 ? 'text-start' : 'text-end'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.items.map((i: any) => (
              <tr key={`${i.org_id}-${i.currency}`} className="border-b border-black/5 last:border-0 hover:bg-black/[0.02]">
                <td className="px-4 py-3">
                  <Link href={`/admin/revenue/${i.org_id}`} className="font-medium text-[#262626] hover:underline">{i.org_name}</Link>
                  <div className="font-mono text-xs text-[#737373]">{i.org_slug}</div>
                </td>
                <td className="px-4 py-3 text-end font-semibold text-[#262626]">{money(i.net_cents, i.currency)}</td>
                <td className="px-4 py-3 text-end">{money(i.this_month_cents, i.currency)}</td>
                <td className="px-4 py-3 text-end text-[#737373]">{money(i.last_month_cents, i.currency)}</td>
                <td className="px-4 py-3 text-end text-[#737373]">{money(i.refunded_cents, i.currency)}</td>
                <td className="px-4 py-3 text-end text-[#737373]">{money(i.outstanding_cents, i.currency)}</td>
                <td className="px-4 py-3 text-end text-[#737373]">{i.payments}</td>
              </tr>
            ))}
            {d.items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[#737373]">Nothing yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
