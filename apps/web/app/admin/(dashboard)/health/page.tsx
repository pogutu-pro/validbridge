import type { Metadata } from 'next'
import SystemHealth from '@components/Admin/SystemHealth'

export const metadata: Metadata = {
  title: 'System health',
}

export default function AdminHealthPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#262626]">System health</h1>
      <p className="mt-1 mb-6 text-[#737373]">Database, Redis, email, payments, and anything stuck in live classes or exams.</p>
      <SystemHealth />
    </div>
  )
}
