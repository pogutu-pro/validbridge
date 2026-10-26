import type { Metadata } from 'next'
import PlatformMonitors from '@components/Admin/PlatformMonitors'

export const metadata: Metadata = {
  title: 'Live monitors',
}

export default function AdminMonitorsPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#262626]">Live monitors</h1>
      <p className="mt-1 mb-6 text-[#737373]">Live classes and exams in progress across every school. Refreshes every 10 seconds.</p>
      <PlatformMonitors />
    </div>
  )
}
