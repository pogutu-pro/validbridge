'use client'
// Find any school or person on the platform.
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { searchPlatform, type SearchResults } from '@services/ee/superadmin'

export default function AdminSearchPage() {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)

  useEffect(() => {
    if (!token || q.trim().length < 2) return
    let cancelled = false
    const t = setTimeout(() => {
      searchPlatform(token, q.trim())
        .then((r) => !cancelled && setResults(r))
        .catch((e) => !cancelled && toast.error(e.message))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, token])

  const shown = q.trim().length >= 2 ? results : null
  const row = 'flex items-center justify-between rounded-xl border border-black/10 bg-white px-4 py-3 hover:bg-black/[0.03]'
  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-[#262626]">Search</h1>
      <p className="mt-1 mb-5 text-[#737373]">Schools by name or slug. People by name, username or email.</p>
      <input autoFocus aria-label="Search" placeholder="Type at least 2 characters" className="w-full rounded-lg border border-black/10 bg-white px-4 py-3 text-[#262626]" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown && (
        <div className="mt-6 space-y-6">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#737373]">Schools</h2>
            <div className="space-y-2">
              {shown.orgs.map((o) => (
                <Link key={o.id} href={`/admin/organizations/${o.id}`} className={row}>
                  <span className="font-medium text-[#262626]">{o.name}</span>
                  <span className="font-mono text-xs text-[#737373]">{o.slug}</span>
                </Link>
              ))}
              {shown.orgs.length === 0 && <p className="text-sm text-[#737373]">No schools.</p>}
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#737373]">People</h2>
            <div className="space-y-2">
              {shown.people.map((p) => (
                <Link key={p.user_uuid} href={`/admin/people/${p.user_uuid}`} className={row}>
                  <span className="font-medium text-[#262626]">{p.name}</span>
                  <span className="text-xs text-[#737373]">{p.email}</span>
                </Link>
              ))}
              {shown.people.length === 0 && <p className="text-sm text-[#737373]">No people.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
