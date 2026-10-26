'use client'
// Owner-only: grant, change or remove Support and Finance access.
import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { addStaff, listStaff, setStaffRole, type StaffMember } from '@services/ee/superadmin'

const ROLE_HELP: Record<string, string> = {
  owner: 'Full control of the platform.',
  support: 'Read everything, start free trials. Cannot change plans, money, schools or keys.',
  finance: 'Read billing, record payments, refunds and wallet changes. Cannot touch schools or keys.',
}

export default function StaffManager() {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'support' | 'finance'>('support')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      setStaff((await listStaff(token)).items)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  const run = async (task: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await task()
      toast.success(done)
      await load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    await run(() => addStaff(token, email.trim(), role, reason.trim()), 'Access granted')
    setEmail('')
    setReason('')
  }

  const change = (m: StaffMember, next: 'support' | 'finance' | null) => {
    const why = window.prompt(next ? `Why move ${m.name} to ${next}?` : `Why remove ${m.name}'s access?`)
    if (!why || why.trim().length < 3 || !token) return
    run(() => setStaffRole(token, m.user_uuid, next, why.trim()), next ? 'Role updated' : 'Access removed')
  }

  const input = 'rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-[#262626]'

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-2xl border border-black/10 bg-white p-4">
        <input aria-label="Email of an existing account" type="email" required placeholder="Email of an existing account" className={`${input} min-w-64 flex-1`} value={email} onChange={(e) => setEmail(e.target.value)} />
        <select aria-label="Role" className={input} value={role} onChange={(e) => setRole(e.target.value as 'support' | 'finance')}>
          <option value="support">Support</option>
          <option value="finance">Finance</option>
        </select>
        <input aria-label="Reason" required minLength={3} placeholder="Reason" className={`${input} min-w-48 flex-1`} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button disabled={busy} className="rounded-lg bg-[#262626] px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">
          Grant access
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white">
        <table className="w-full text-sm">
          <tbody>
            {staff.map((m) => (
              <tr key={m.user_uuid} className="border-b border-black/5 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-[#262626]">{m.name}</div>
                  <div className="text-xs text-[#737373]">{m.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-xs font-semibold capitalize text-[#262626]">{m.role}</span>
                  <div className="mt-1 text-xs text-[#737373]">{m.role ? ROLE_HELP[m.role] : ''}</div>
                </td>
                <td className="px-4 py-3 text-end">
                  {m.role !== 'owner' && (
                    <div className="inline-flex gap-2">
                      <button disabled={busy} onClick={() => change(m, m.role === 'support' ? 'finance' : 'support')} className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold hover:bg-black/[0.04]">
                        Make {m.role === 'support' ? 'finance' : 'support'}
                      </button>
                      <button disabled={busy} onClick={() => change(m, null)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">
                        Remove
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!loading && staff.length === 0 && (
              <tr><td className="px-4 py-10 text-center text-[#737373]">No staff yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
