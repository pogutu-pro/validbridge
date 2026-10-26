'use client'
import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getSystemHealth } from '@services/ee/superadmin'

export default function SystemHealth() {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const [d, setD] = useState<any>(null)

  const load = useCallback(() => {
    if (!token) return
    getSystemHealth(token).then(setD).catch((e) => toast.error(e.message))
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  if (!d) return <p className="text-[#737373]">Checking...</p>
  return (
    <div className="max-w-2xl space-y-4">
      <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${d.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
        {d.ok ? 'Everything checks out.' : 'Something needs attention.'}
      </div>
      <div className="rounded-2xl border border-black/10 bg-white">
        {d.checks.map((c: any) => (
          <div key={c.name} className="flex items-start justify-between gap-4 border-b border-black/5 px-4 py-3 text-sm last:border-0">
            <span className="font-medium text-[#262626]">{c.name}</span>
            <span className={`text-end ${c.ok ? 'text-[#737373]' : 'font-semibold text-red-600'}`}>{c.detail}</span>
          </div>
        ))}
      </div>
      <button onClick={load} className="rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold text-[#262626] hover:bg-black/[0.04]">Check again</button>
    </div>
  )
}
