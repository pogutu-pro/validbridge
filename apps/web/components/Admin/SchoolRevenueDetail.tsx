'use client'
// One school's earnings by month and by offer. Opening this page is recorded in the audit log.
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { ArrowLeft } from '@phosphor-icons/react'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getSchoolRevenue } from '@services/ee/superadmin'
import { money } from '@components/Admin/SchoolsRevenue'

export default function SchoolRevenueDetail() {
  const { orgId } = useParams() as { orgId: string }
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const [d, setD] = useState<any>(null)

  useEffect(() => {
    if (!token) return
    getSchoolRevenue(token, orgId).then(setD).catch((e) => toast.error(e.message))
  }, [token, orgId])

  const back = (
    <Link href="/admin/revenue" className="mb-4 inline-flex items-center gap-1.5 text-sm text-[#737373] hover:text-[#262626]">
      <ArrowLeft size={14} weight="bold" data-dir-flip /> All schools
    </Link>
  )
  if (!d) return <div>{back}<p className="text-[#737373]">Loading...</p></div>

  const currencies: string[] = Array.from(new Set<string>(d.monthly.map((m: any) => m.currency)))
  const card = 'rounded-2xl border border-black/10 bg-white p-5'
  return (
    <div className="max-w-4xl space-y-5">
      {back}
      <h1 className="text-2xl font-bold text-[#262626]">{d.org.name}</h1>
      {currencies.map((currency) => {
        const rows = d.monthly.filter((m: any) => m.currency === currency)
        const max = Math.max(1, ...rows.map((m: any) => m.cents))
        return (
          <section key={currency} className={card}>
            <h2 className="mb-4 font-semibold text-[#262626]">Earned per month · {currency}</h2>
            <div className="space-y-2">
              {rows.map((m: any) => (
                <div key={m.month} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 text-[#737373]">{m.month}</span>
                  <div className="h-5 flex-1 rounded bg-black/[0.05]">
                    <div className="h-5 rounded bg-[#262626]" style={{ width: `${(Math.max(m.cents, 0) / max) * 100}%` }} />
                  </div>
                  <span className="w-36 shrink-0 text-end text-[#262626]">{money(m.cents, currency)}</span>
                </div>
              ))}
            </div>
          </section>
        )
      })}
      <section className={card}>
        <h2 className="mb-3 font-semibold text-[#262626]">By offer</h2>
        {d.offers.map((o: any) => (
          <div key={`${o.offer_id}-${o.currency}`} className="flex justify-between border-b border-black/5 py-2 text-sm last:border-0">
            <span className="text-[#262626]">{o.name}</span>
            <span className="text-[#737373]">{o.payments} payments · {money(o.collected, o.currency)}</span>
          </div>
        ))}
        {d.offers.length === 0 && <p className="text-sm text-[#737373]">No payments yet.</p>}
      </section>
    </div>
  )
}
