import type { Metadata } from 'next'
import CommandCenter from '@components/Admin/CommandCenter'

export const metadata: Metadata = {
  title: 'Command center',
}

export default function AdminPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#262626]">Command center</h1>
      <p className="mt-1 mb-6 text-[#737373]">What needs attention across the platform right now.</p>
      <CommandCenter />
    </div>
  )
}
