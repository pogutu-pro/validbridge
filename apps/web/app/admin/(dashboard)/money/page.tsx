import type { Metadata } from 'next'
import MoneyDashboard from '@components/Admin/MoneyDashboard'

export const metadata: Metadata = {
  title: 'Money',
}

export default function AdminMoneyPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#262626]">Money</h1>
      <p className="mt-1 mb-6 text-[#737373]">Cash collected, what is unpaid and for how long, and wallet balances held.</p>
      <MoneyDashboard />
    </div>
  )
}
