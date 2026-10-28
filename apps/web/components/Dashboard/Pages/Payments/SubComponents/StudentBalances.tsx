'use client'
// What each student has paid and what they still owe the school.
import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { queryKeys } from '@/lib/query/keys'
import { getOrgBalances } from '@services/payments/payments'

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)

export default function StudentBalances({ orgId, accessToken }: { orgId: number; accessToken: string }) {
  const [search, setSearch] = useState('')
  const [owingOnly, setOwingOnly] = useState(false)
  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.payments.balances(orgId),
    queryFn: () => getOrgBalances(orgId, accessToken),
    enabled: !!(orgId && accessToken),
    staleTime: 30_000,
  })

  const rows: any[] = useMemo(() => (Array.isArray(data) ? data : []), [data])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => (!owingOnly || r.owes > 0) && (!q || `${r.name} ${r.email}`.toLowerCase().includes(q)))
  }, [rows, search, owingOnly])

  // Totals are per currency, never added across currencies.
  const totals = useMemo(() => {
    const byCurrency: Record<string, { paid: number; owes: number }> = {}
    for (const r of rows) {
      const t = (byCurrency[r.currency] ||= { paid: 0, owes: 0 })
      t.paid += r.paid
      t.owes += r.owes
    }
    return Object.entries(byCurrency)
  }, [rows])

  if (isLoading) return <PageLoading />
  if (error) return <div className="p-6 text-sm text-red-500">Error loading balances</div>

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {totals.map(([currency, t]) => (
          <div key={currency} className="grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Paid by students</div>
              <div className="mt-1 text-xl font-bold text-gray-900">{money(t.paid, currency)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Still owed to you</div>
              <div className={`mt-1 text-xl font-bold ${t.owes > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{money(t.owes, currency)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-3 size-4 text-gray-400" />
          <input
            aria-label="Search students"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students"
            className="h-10 w-64 rounded-lg border border-gray-200 ps-9 pe-3 text-sm outline-none focus:border-gray-400"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={owingOnly} onChange={(e) => setOwingOnly(e.target.checked)} />
          Only students who still owe
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 text-start font-semibold">Student</th>
              <th className="px-4 py-3 text-start font-semibold">Offers</th>
              <th className="px-4 py-3 text-end font-semibold">Paid</th>
              <th className="px-4 py-3 text-end font-semibold">Still owes</th>
              <th className="px-4 py-3 text-start font-semibold">Progress</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const total = r.paid + r.owes
              const pct = total > 0 ? Math.round((r.paid / total) * 100) : 100
              return (
                <tr key={`${r.user_uuid}-${r.currency}`} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.name}</div>
                    <div className="text-xs text-gray-400">{r.email}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.offers.map((o: any) => o.name).join(', ')}</td>
                  <td className="px-4 py-3 text-end font-semibold text-gray-900">{money(r.paid, r.currency)}</td>
                  <td className={`px-4 py-3 text-end font-semibold ${r.owes > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{money(r.owes, r.currency)}</td>
                  <td className="px-4 py-3">
                    <div className="h-2 w-28 rounded-full bg-gray-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-2 rounded-full bg-green-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-gray-400">{pct}% paid</div>
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">{rows.length === 0 ? 'No payments yet.' : 'No students match.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Counts paid and part-paid purchases, after refunds. Still owes is what is left on offers paid in parts. Subscriptions are not included because they renew on a schedule.
      </p>
    </div>
  )
}
