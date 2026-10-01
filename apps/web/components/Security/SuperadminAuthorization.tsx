'use client'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { getSuperadminAccess } from '@services/ee/superadmin'

type SuperadminAuthorizationProps = {
  children: React.ReactNode
}

const SuperadminAuthorization: React.FC<SuperadminAuthorizationProps> = ({
  children,
}) => {
  const session = useVBSession() as any
  const router = useRouter()
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [isRedirecting, setIsRedirecting] = useState(false)
  // null until the API has answered. The API enforces the 2FA requirement on
  // every superadmin endpoint; this only turns its refusal into a clear page.
  const [twoFactorRequired, setTwoFactorRequired] = useState<boolean | null>(null)
  const accessToken: string | undefined = session?.data?.tokens?.access_token

  const isUserAuthenticated = useMemo(
    () => session.status === 'authenticated',
    [session.status]
  )

  const checkAuth = useCallback(() => {
    if (session.status === 'loading') return

    if (!isUserAuthenticated) {
      // Keep the loader up through the navigation rather than releasing it
      // into a false "Access Denied" flash.
      setIsRedirecting(true)
      router.push('/admin/login')
      return
    }

    setIsAuthorized(session?.data?.user?.is_superadmin === true)
    setIsChecking(false)
  }, [session.status, isUserAuthenticated, session?.data?.user?.is_superadmin, router])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  useEffect(() => {
    if (!isAuthorized || !accessToken) return
    let cancelled = false
    getSuperadminAccess(accessToken).then((access) => {
      if (!cancelled) setTwoFactorRequired(access === '2fa_required')
    })
    return () => {
      cancelled = true
    }
  }, [isAuthorized, accessToken])

  if (
    session.status === 'loading' ||
    isChecking ||
    isRedirecting ||
    (isAuthorized && accessToken && twoFactorRequired === null)
  ) {
    return (
      <div className="flex justify-center items-center h-screen">
        <PageLoading />
      </div>
    )
  }

  // No deployment-mode check here. app/admin/layout.tsx resolves the mode
  // server-side and renders the licence screen before this component mounts.
  // The previous check ran on a client-side value and failed closed, which
  // could hide the dashboard from legitimate operators during a transient
  // backend failure. Two gates with opposite failure directions is worse
  // than one.
  if (!isAuthorized) {
    return (
      <div className="flex justify-center items-center h-screen bg-[#F8F7F2]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#262626] mb-2">Access Denied</h1>
          <p className="text-[#737373]/80">
            You need superadmin privileges to access this page.
          </p>
        </div>
      </div>
    )
  }

  if (twoFactorRequired) {
    return (
      <div className="flex justify-center items-center h-screen bg-[#F8F7F2] px-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-[#262626] mb-2">
            Two-factor authentication required
          </h1>
          <p className="text-[#737373]/80 mb-5">
            Superadmin access needs two-factor authentication on your account.
            Turn it on in your account security settings, then come back.
          </p>
          <Link
            href="/account"
            className="inline-flex items-center rounded-lg bg-[#262626] px-4 py-2 text-sm font-semibold text-white hover:bg-black"
          >
            Set up two-factor
          </Link>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

export default SuperadminAuthorization
