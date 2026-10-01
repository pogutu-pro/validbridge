'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { getUserEnrollments, cancelSubscription } from '@services/payments/offers'
import {
  ShoppingBag, RefreshCcw, SquareCheck, ArrowRight,
  Loader2, CalendarDays, BadgeCheck
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatDate } from '@/lib/format'
import toast from 'react-hot-toast'
import { meaningfulMessage } from '@lib/errors/classify'

interface AccountPurchasesProps {
  orgId: number
  orgslug: string
}

function EnrollmentCard({ enrollment, orgslug, orgId, access_token }: {
  enrollment: any
  orgslug: string
  orgId: number
  access_token: string
}) {
  const { i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const isSubscription = enrollment.offer_type === 'subscription'
  const isActive = enrollment.status === 'active'

  const formattedPrice = enrollment.amount != null
    ? formatCurrency(enrollment.amount, enrollment.currency ?? 'USD', i18n.language)
    : null

  const formattedDate = enrollment.creation_date
    ? formatDate(enrollment.creation_date, i18n.language, { dateStyle: undefined, year: 'numeric', month: 'short', day: 'numeric' })
    : null

  const handleCancel = async () => {
    if (!isActive || cancelling) return
    setCancelling(true)
    try {
      const res = await cancelSubscription(orgId, enrollment.offer_id, access_token)
      if (res?.success) {
        toast.success('Subscription cancelled')
        queryClient.invalidateQueries({ queryKey: ['payments', orgId, 'enrollments', 'mine'] })
      } else {
        toast.error(res?.data?.detail || 'Could not cancel subscription')
      }
    } catch (err) {
      toast.error(meaningfulMessage(err))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="bg-white rounded-xl nice-shadow overflow-hidden">
      {/* Type band */}
      <div className={`px-4 py-2 flex items-center justify-between ${isSubscription ? 'bg-orange-50' : 'bg-gray-50'}`}>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${isSubscription ? 'text-orange-700' : 'text-gray-600'}`}>
          {isSubscription ? <RefreshCcw size={11} /> : <SquareCheck size={11} />}
          {isSubscription ? 'Subscription' : 'One-time purchase'}
        </span>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
          isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          <BadgeCheck size={11} />
          {isActive ? 'Active' : enrollment.status}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* Offer name + price */}
        <div className="flex items-start justify-between gap-3">
          <p className="font-bold text-gray-900 leading-snug">{enrollment.offer_name}</p>
          {formattedPrice && (
            <div className="shrink-0 text-end">
              <p className={`font-black text-lg ${isSubscription ? 'text-orange-700' : 'text-gray-900'}`}>
                {formattedPrice}
              </p>
              {isSubscription && (
                <p className="text-xs text-orange-400 leading-none">recurring</p>
              )}
            </div>
          )}
        </div>

        {/* Purchase date */}
        {formattedDate && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <CalendarDays size={12} />
            <span>Purchased {formattedDate}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Link
            href={getUriWithOrg(orgslug, `/marketplace/offers/${enrollment.offer_uuid ?? enrollment.offer_id}`)}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors px-3 py-2 rounded-lg"
          >
            View offer <ArrowRight size={11} />
          </Link>
          {isSubscription && isActive && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="flex items-center justify-center gap-1.5 text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 transition-colors px-3 py-2 rounded-lg disabled:opacity-60"
            >
              {cancelling ? <Loader2 size={11} className="animate-spin" /> : 'Cancel'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function AccountPurchases({ orgId, orgslug }: AccountPurchasesProps) {
  const session = useVBSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: enrollmentsResult, isLoading, error } = useQuery({
    queryKey: ['payments', orgId, 'enrollments', 'mine'],
    queryFn: () => getUserEnrollments(orgId, access_token),
    enabled: !!orgId && !!access_token,
    staleTime: 60_000,
  })

  const enrollments: any[] = Array.isArray(enrollmentsResult?.data) ? enrollmentsResult.data : []

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl nice-shadow p-12 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-300" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl nice-shadow p-8 text-center text-sm text-red-400">
        Could not load purchases. Please refresh and try again.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-xl nice-shadow p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center nice-shadow">
            <ShoppingBag size={18} className="text-gray-700" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900">Purchases</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Your active purchases and subscriptions
            </p>
          </div>
        </div>
      </div>

      {/* Enrollment list */}
      {enrollments.length === 0 ? (
        <div className="bg-white rounded-xl nice-shadow p-12 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-4 nice-shadow">
            <ShoppingBag size={24} className="text-gray-300" strokeWidth={1.5} />
          </div>
          <h2 className="font-bold text-gray-600 mb-1">No purchases yet</h2>
          <p className="text-sm text-gray-400 max-w-xs">
            Your purchases and subscriptions will appear here once you buy something from the store.
          </p>
          <Link
            href={getUriWithOrg(orgslug, '/marketplace')}
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-white bg-gray-900 hover:bg-gray-800 transition-colors px-4 py-2 rounded-xl"
          >
            Browse store <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {enrollments.map((enrollment: any) => (
            <EnrollmentCard
              key={enrollment.enrollment_id}
              enrollment={enrollment}
              orgslug={orgslug}
              orgId={orgId}
              access_token={access_token}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default AccountPurchases
