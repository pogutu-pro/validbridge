'use client'
import { useMemo } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'

type RoleEntry = { org?: { id: number }; role?: { rights?: Record<string, Record<string, boolean>> } }

/**
 * Whether the signed-in user may use the front desk of this organisation.
 * The server decides every call; this only decides whether to show the screen and the menu link.
 * Admins may use it; so may any role whose `frontdesk` rights are on.
 */
export default function useFrontdeskAccess() {
  const session = useVBSession() as any
  const org = useOrg() as any
  const authenticated = session?.status === 'authenticated'
  const roles: RoleEntry[] = session?.data?.roles
  const orgId: number | undefined = org?.id
  const isSuperadmin = session?.data?.user?.is_superadmin === true

  return useMemo(() => {
    const loading = session?.status === 'loading' || !orgId
    if (!authenticated || !orgId) return { loading, allowed: false, canCreate: false, canUpdate: false }
    if (isSuperadmin) return { loading: false, allowed: true, canCreate: true, canUpdate: true }
    const mine = (roles || []).filter((r) => r?.org?.id === orgId)
    const isAdmin = mine.some((r) => r?.role?.rights?.organizations?.action_update === true)
    const has = (action: string) => isAdmin || mine.some((r) => r?.role?.rights?.frontdesk?.[action] === true)
    return { loading: false, allowed: has('action_read'), canCreate: has('action_create'), canUpdate: has('action_update') }
  }, [authenticated, orgId, roles, isSuperadmin, session?.status])
}
