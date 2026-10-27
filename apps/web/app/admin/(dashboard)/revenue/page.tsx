import type { Metadata } from 'next'
import SchoolsRevenue from '@components/Admin/SchoolsRevenue'

export const metadata: Metadata = {
  title: 'School revenue',
}

export default function AdminRevenuePage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#262626]">School revenue</h1>
      <p className="mt-1 mb-6 text-[#737373]">
        What each school collects from its own students. School totals only. Counts payments the platform has been told about, after refunds, and before Paystack fees.
      </p>
      <SchoolsRevenue />
    </div>
  )
}
