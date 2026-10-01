'use client'
import React, { Suspense, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { canManageOrgFromSession } from '@components/Hooks/useAdminStatus'
import UserAvatar from '@components/Objects/UserAvatar'
import { getAPIUrl } from '@services/config/config'
import OrgSquareLogo from '@components/Objects/Org/OrgSquareLogo'
import { apiFetch } from '@services/utils/ts/requests'
import BillingDashboard from '../_billing/BillingDashboard'

// Hub billing page: the school's plan, payments, wallet, add-ons and invoices
// (Paystack). Admin-only; shows a "coming soon" card while platform billing is
// switched off on the server.
function BillingClient() {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const router = useRouter()
  const searchParams = useSearchParams()

  const access_token = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'

  const orgSlugParam = searchParams?.get('org')
  const orgIdParam = searchParams?.get('orgId')

  // Redirect unauthenticated users to login (mirror app/home/home.tsx).
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isLoading, isAuthenticated, router])

  // Load the user's orgs to resolve ?org= / ?orgId=.
  const { data: orgs, isLoading: orgsLoading, isError: orgsError, refetch: refetchOrgs } = useQuery({
    queryKey: ['orgs', 'user'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/user/page/1/limit/50`, access_token),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })

  const org = useMemo(() => {
    if (!Array.isArray(orgs)) return undefined
    if (orgSlugParam) return orgs.find((o: any) => o.slug === orgSlugParam)
    if (orgIdParam) return orgs.find((o: any) => String(o.id) === orgIdParam)
    return undefined
  }, [orgs, orgSlugParam, orgIdParam])

  // No matching org once orgs have loaded → back to the org list.
  useEffect(() => {
    if (isAuthenticated && Array.isArray(orgs) && !org) {
      router.replace('/organizations')
    }
  }, [isAuthenticated, orgs, org, router])

  // Billing is org-management: only admins/superadmins may view it, even via a
  // direct link (the menu entries are already hidden for non-admins).
  const canManage = canManageOrgFromSession(session, org?.id)

  // Don't spin forever if the orgs request failed — surface an error instead.
  const showLoader = isLoading || (isAuthenticated && !orgsError && (orgsLoading || !org))

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-y-auto">
      <div className="relative min-h-screen">
        {/* Blueprint grid — fades in from bottom */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(rgba(0,0,0,0.018) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.018) 1px, transparent 1px)
            `,
            backgroundSize: '80px 80px, 80px 80px, 16px 16px, 16px 16px',
            maskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
            WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
          }}
        />

        <div className="relative z-10 min-h-screen px-4 py-8">
          <div className="w-full max-w-4xl mx-auto">
            {/* Top bar */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3 min-w-0">
                <Link
                  href="/organizations"
                  className="flex items-center justify-center w-9 h-9 rounded-xl bg-white nice-shadow text-black/50 hover:text-black transition-colors flex-shrink-0"
                  aria-label={t('billing.back_to_orgs', { defaultValue: 'Back to organizations' })}
                >
                  <ArrowLeft size={16} />
                </Link>
                {org && (
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-white overflow-hidden flex items-center justify-center flex-shrink-0 ring-1 ring-inset ring-black/5">
                      <OrgSquareLogo
                        org={org}
                        fallback={
                          <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-700 font-bold text-sm">
                            {(org.name || org.slug || '?').trim().charAt(0).toUpperCase()}
                          </div>
                        }
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 truncate">{org.name}</span>
                  </div>
                )}
              </div>
              {isAuthenticated && <UserAvatar border="border-2" rounded="rounded-full" width={36} />}
            </div>

            {showLoader ? (
              <div className="space-y-4">
                <div className="h-10 w-64 rounded-xl bg-black/[0.03] animate-pulse" />
                <div className="h-40 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
              </div>
            ) : orgsError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
                <p className="text-rose-700 font-semibold">
                  {t('billing.load_failed', { defaultValue: "We couldn't load your organizations." })}
                </p>
                <button
                  onClick={() => refetchOrgs()}
                  className="mt-3 inline-flex items-center rounded-full bg-rose-700 px-4 py-1.5 text-sm font-bold text-white hover:bg-rose-800"
                >
                  {t('common.retry', { defaultValue: 'Retry' })}
                </button>
              </div>
            ) : org && !canManage ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
                <p className="text-amber-800 font-semibold">
                  {t('billing.no_permission', {
                    defaultValue: "You don't have permission to manage billing for this organization.",
                  })}
                </p>
                <p className="mt-1 text-sm text-amber-700/80">
                  {t('billing.no_permission_hint', {
                    defaultValue: 'Only an organization admin can view or change the plan.',
                  })}
                </p>
                <Link
                  href="/home"
                  className="mt-4 inline-flex items-center rounded-full bg-gray-900 px-4 py-1.5 text-sm font-bold text-white hover:bg-gray-800"
                >
                  {t('common.home', { defaultValue: 'Home' })}
                </Link>
              </div>
            ) : org ? (
              <BillingDashboard org={org} token={access_token} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-[100] bg-white" />}>
      <BillingClient />
    </Suspense>
  )
}
