'use client'
import { useEffect, useState } from 'react'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getSuperadminStatus, type StaffAccess } from '@services/ee/superadmin'

/**
 * The signed-in staff member's tier and what it allows, from the API.
 * The API enforces every capability; this only decides what the console shows.
 * `access` is null until the API has answered.
 */
export default function useStaffAccess() {
  const session = useVBSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const [access, setAccess] = useState<StaffAccess | null>(null)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    getSuperadminStatus(accessToken)
      .then((status) => {
        if (!cancelled && status) setAccess(status as StaffAccess)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [accessToken])

  return {
    access,
    role: access?.role ?? null,
    can: (capability: string) => !!access?.capabilities?.includes(capability),
  }
}
