'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { getBillingOverview, cancelSubscription } from '@services/payments/offers'
import {
  ReceiptText, RefreshCcw, ArrowRight, Loader2, SquareCheck, CalendarDays,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatDate } from '@/lib/format'
import toast from 'react-hot-toast'
import { meaningfulMessage } from '@lib/errors/classify'

interface AccountBillingProps {
  orgId: number
  orgslug: string
}

function SubscriptionCard({ entry, orgslug, orgId, access_token }: {
  entry: any
  orgslug: string
  orgId: number
  access_token: string
}) {
  const { i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const isSubscription = entry.offer_type === 'subscription'
  const isActive = entry.status === 'active'
  const subscription = entry.subscription ?? {}
  const nextPayment = subscription.next_payment_date ?? null
  const remoteActive = subscription.remote && subscription.status === 'active'

  const formattedPrice = entry.amount != null
    ? formatCurrency(entry.amount, entry.currency ?? 'USD', i18n.language, { maximumFractionDigits: 0 })
    : null

  const formattedDate = nextPayment
    ? formatDate(nextPayment, i18n.language, { dateStyle: undefined, year: 'numeric', month: 'short', day: 'numeric' })
    : null

  const handleCancel = async () => {
    if (!isActive || cancelling) return
    setCancelling(true)
    try {
      const res = await cancelSubscription(orgId, entry.offer_id, access_token)
      if (res?.success) {
        toast.success('Subscription cancelled')
        queryClient.invalidateQueries({ queryKey: ['payments', orgId, 'billing'] })
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
      <div className={`px-4 py-2 flex items-center justify-between ${isSubscription ? 'bg-orange-50' : 'bg-gray-50'}`}>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${isSubscription ? 'text-orange-700' : 'text-gray-600'}`}>
          {isSubscription ? <RefreshCcw size={11} /> : <SquareCheck size={11} />}
          {isSubscription ? 'Subscription' : 'One-time purchase'}
        </span>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
          isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {isActive ? 'Active' : entry.status}
        </span>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-gray-900 leading-snug">{entry.offer_name}</p>
            {entry.interval && (
              <p className="text-xs text-gray-400 mt-0.5">Billed {entry.interval}</p>
            )}
          </div>
          {formattedPrice && (
            <div className="shrink-0 text-end">
              <p className={`font-black text-lg ${isSubscription ? 'text-orange-700' : 'text-gray-900'}`}>
                {formattedPrice}
              </p>
              {isSubscription && <p className="text-xs text-orange-400 leading-none">recurring</p>}
            </div>
          )}
        </div>

        {nextPayment && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <CalendarDays size={12} />
            <span>Next payment <span className="font-semibold">{formattedDate}</span></span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Link
            href={getUriWithOrg(orgslug, `/marketplace/offers/${entry.offer_uuid ?? entry.offer_id}`)}
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

function TransactionRow({ transaction, orgslug }: { transaction: any; orgslug: string }) {
  const { i18n } = useTranslation()
  const date = transaction.created_at
    ? formatDate(transaction.created_at, i18n.language, { dateStyle: undefined, year: 'numeric', month: 'short', day: 'numeric' })
    : null
  const amount = transaction.amount != null
    ? formatCurrency(transaction.amount, transaction.currency ?? 'USD', i18n.language, { maximumFractionDigits: 0 })
    : null

  const statusStyle: Record<string, string> = {
    success: 'bg-green-100 text-green-700',
    paid: 'bg-green-100 text-green-700',
    active: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-600',
    failed: 'bg-red-100 text-red-600',
    pending: 'bg-amber-100 text-amber-700',
  }

  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-gray-700">{transaction.description ?? 'Store purchase'}</div>
        {transaction.reference && <div className="text-xs text-gray-400 font-mono mt-0.5">{transaction.reference}</div>}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{date}</td>
      <td className="px-4 py-3 text-end">
        <div className="text-sm font-semibold text-gray-900 whitespace-nowrap">{amount}</div>
      </td>
      <td className="px-4 py-3 text-end">
        <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${statusStyle[transaction.status ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
          {transaction.status}
        </span>
      </td>
    </tr>
  )
}

function AccountBilling({ orgId, orgslug }: AccountBillingProps) {
  const session = useVBSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: overviewResult, isLoading, error } = useQuery({
    queryKey: ['payments', orgId, 'billing'],
    queryFn: () => getBillingOverview(orgId, access_token),
    enabled: !!orgId && !!access_token,
    staleTime: 60_000,
  })

  const overview = overviewResult?.data ?? {}
  const subscriptions: any[] = Array.isArray(overview.subscriptions) ? overview.subscriptions : []
  const transactions: any[] = Array.isArray(overview.transactions) ? overview.transactions : []

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
        Could not load billing details. Please refresh and try again.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl nice-shadow p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center nice-shadow">
            <ReceiptText size={18} className="text-gray-700" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900">Billing</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Your subscriptions, payments and receipts
            </p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-bold text-gray-700 mb-3">Subscriptions &amp; purchases</h2>
        {subscriptions.length === 0 ? (
          <div className="bg-white rounded-xl nice-shadow p-12 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-4 nice-shadow">
              <ReceiptText size={24} className="text-gray-300" strokeWidth={1.5} />
            </div>
            <h3 className="font-bold text-gray-600 mb-1">No billing activity yet</h3>
            <p className="text-sm text-gray-400 max-w-xs">
              Your subscriptions and purchases will appear here once you buy something from the store.
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
            {subscriptions.map((entry: any) => (
              <SubscriptionCard
                key={entry.enrollment_id ?? entry.offer_id}
                entry={entry}
                orgslug={orgslug}
                orgId={orgId}
                access_token={access_token}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-bold text-gray-700 mb-3">Payment history</h2>
        {transactions.length === 0 ? (
          <div className="bg-white rounded-xl nice-shadow p-12 flex flex-col items-center justify-center text-center">
            <p className="text-sm text-gray-400">No transactions yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl nice-shadow overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="text-start border-b border-gray-100">
                  <th className="text-start px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Description</th>
                  <th className="text-start px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                  <th className="text-end px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Amount</th>
                  <th className="text-end px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t: any, i: number) => (
                  <TransactionRow key={t.reference ?? i} transaction={t} orgslug={orgslug} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default AccountBilling