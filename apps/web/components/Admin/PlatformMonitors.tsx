'use client'
// Every live class and every exam in progress, across all schools.
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getMonitor } from '@services/ee/superadmin'

const REFRESH_MS = 10_000

export default function PlatformMonitors() {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const [live, setLive] = useState<any[]>([])
  const [exams, setExams] = useState<any[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const load = () =>
      Promise.all([getMonitor(token, 'live'), getMonitor(token, 'exams')])
        .then(([l, e]) => {
          if (cancelled) return
          setLive(l.items)
          setExams(e.items)
          setError('')
        })
        .catch((e) => !cancelled && setError(e.message))
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [token])

  const card = 'rounded-2xl border border-black/10 bg-white p-5'
  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <section className={card}>
        <h2 className="mb-3 font-semibold text-[#262626]">Live classes ({live.length})</h2>
        {live.map((l) => (
          <Link key={l.session_uuid} href={`/admin/organizations/${l.org_id}`} className="flex justify-between border-b border-black/5 py-2 text-sm last:border-0 hover:underline">
            <span className="text-[#262626]">{l.title}</span>
            <span className="text-[#737373]">{l.org_name}</span>
          </Link>
        ))}
        {live.length === 0 && <p className="text-sm text-[#737373]">No live classes.</p>}
      </section>
      <section className={card}>
        <h2 className="mb-3 font-semibold text-[#262626]">Exams in progress ({exams.length})</h2>
        {exams.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-[#737373]">
                  {['Exam', 'School', 'Sitting', 'Disconnected', 'Violations', 'Ends'].map((h) => (
                    <th key={h} className="py-2 text-start font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exams.map((e) => (
                  <tr key={e.assignment_id} className="border-t border-black/5">
                    <td className="py-2 text-[#262626]">{e.title}</td>
                    <td className="py-2 text-[#262626]">{e.org_name}</td>
                    <td className="py-2">{e.students}</td>
                    <td className={`py-2 ${e.disconnected ? 'font-semibold text-red-600' : ''}`}>{e.disconnected}</td>
                    <td className={`py-2 ${e.violations ? 'font-semibold text-orange-600' : ''}`}>{e.violations}</td>
                    <td className="py-2 text-[#737373]">{e.ends_at ? new Date(e.ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '·'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {exams.length === 0 && <p className="text-sm text-[#737373]">No exams in progress.</p>}
      </section>
    </div>
  )
}
