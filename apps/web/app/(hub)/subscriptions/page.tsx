'use client'
import React, { Suspense, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import BillingComingSoon from '../_billing/BillingComingSoon'

// Hub subscriptions overview. Platform billing is being rebuilt on Paystack;
// until then this route (still reached by the legacy /dashboard/subscriptions
// redirect) shows the same placeholder as /billing.
function SubscriptionsClient() {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const router = useRouter()
  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isLoading, isAuthenticated, router])

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-y-auto">
      <div className="relative z-10 min-h-screen px-4 py-8">
        <div className="w-full max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <Link
              href="/home"
              className="flex items-center justify-center w-9 h-9 rounded-xl bg-white nice-shadow text-black/50 hover:text-black transition-colors flex-shrink-0"
              aria-label={t('subscriptions.back_home', { defaultValue: 'Back to home' })}
            >
              <ArrowLeft size={16} />
            </Link>
            {isAuthenticated && <UserAvatar border="border-2" rounded="rounded-full" width={36} />}
          </div>
          {isLoading ? (
            <div className="h-40 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
          ) : isAuthenticated ? (
            <BillingComingSoon />
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-[100] bg-white" />}>
      <SubscriptionsClient />
    </Suspense>
  )
}
