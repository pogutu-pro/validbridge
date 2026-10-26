'use client'
// One person across the whole platform: status, schools, and owner-only account actions.
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import useStaffAccess from '@components/Hooks/useStaffAccess'
import { getPerson, personAction } from '@services/ee/superadmin'

const when = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '·')

export default function PersonPage() {
  const { userUuid } = useParams() as { userUuid: string }
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const { can } = useStaffAccess()
  const [p, setP] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      setP(await getPerson(token, userUuid))
    } catch (e: any) {
      toast.error(e.message)
    }
  }, [token, userUuid])

  useEffect(() => {
    load()
  }, [load])

  const act = async (action: 'sign-out' | 'unlock' | 'verify-email', done: string) => {
    const reason = window.prompt('Reason (recorded in the audit log)')
    if (!reason || reason.trim().length < 5 || !token) return
    setBusy(true)
    try {
      await personAction(token, userUuid, action, reason.trim())
      toast.success(done)
      await load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!p) return <div className="p-8 text-[#737373]">Loading...</div>
  const card = 'rounded-2xl border border-black/10 bg-white p-5'
  const btn = 'rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold text-[#262626] hover:bg-black/[0.04] disabled:opacity-50'
  return (
    <div className="p-8 max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#262626]">{p.name}</h1>
        <p className="text-[#737373]">{p.email} · @{p.username}{p.staff_role ? ` · ${p.staff_role} staff` : ''}</p>
      </div>

      <div className={`${card} grid gap-3 text-sm sm:grid-cols-2`}>
        <div>Email verified: <strong>{p.email_verified ? 'Yes' : 'No'}</strong></div>
        <div>Signed up via: <strong>{p.signup_method || '·'}</strong></div>
        <div>Last sign-in: <strong>{when(p.last_login_at)}</strong></div>
        <div>Last IP: <strong>{p.last_login_ip || '·'}</strong></div>
        <div>Failed attempts: <strong>{p.failed_login_attempts}</strong></div>
        <div>Account: <strong className={p.locked ? 'text-red-600' : ''}>{p.locked ? `Locked until ${when(p.locked_until)}` : 'Active'}</strong></div>
      </div>

      {can('people_write') && (
        <div className={`${card} flex flex-wrap gap-2`}>
          <button disabled={busy} className={btn} onClick={() => act('sign-out', 'Signed out everywhere')}>Sign out everywhere</button>
          <button disabled={busy || !p.locked} className={btn} onClick={() => act('unlock', 'Account unlocked')}>Unlock account</button>
          <button disabled={busy || p.email_verified} className={btn} onClick={() => act('verify-email', 'Email marked verified')}>Mark email verified</button>
        </div>
      )}

      <div className={card}>
        <h2 className="mb-2 font-semibold text-[#262626]">Schools</h2>
        {p.memberships.map((m: any) => (
          <Link key={m.org_id} href={`/admin/organizations/${m.org_id}`} className="flex justify-between border-b border-black/5 py-2 text-sm last:border-0 hover:underline">
            <span className="text-[#262626]">{m.org_name}</span>
            <span className="text-[#737373]">{m.role || '·'}</span>
          </Link>
        ))}
        {p.memberships.length === 0 && <p className="text-sm text-[#737373]">Not in any school.</p>}
      </div>

      <div className={card}>
        <h2 className="mb-2 font-semibold text-[#262626]">Staff actions on this person</h2>
        {p.history.map((h: any) => (
          <div key={h.id} className="border-b border-black/5 py-2 text-sm last:border-0">
            <span className="font-mono text-xs">{h.action.replace('superadmin.', '')}</span> by {h.actor} on {when(h.created_at)}
            {h.reason ? <div className="text-[#737373]">{h.reason}</div> : null}
          </div>
        ))}
        {p.history.length === 0 && <p className="text-sm text-[#737373]">None.</p>}
      </div>
    </div>
  )
}
