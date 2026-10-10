'use client'
import React from 'react'
import Link from 'next/link'
import { ArrowRight, RefreshCcw, SquareCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUriWithOrg } from '@services/config/config'
import { formatCurrency } from '@/lib/format'
import { OfferCard } from './OfferCard'

const isSubscription = (offer: any) => offer.offer_type === 'subscription'

// Lists the ways to get a course. When the same content is sold both as a
// one-time payment and as a subscription, they are shown as ONE card with both
// choices (the offer page lets the buyer switch and, for pay-what-you-want,
// enter an amount). Any other offers keep their own cards.
export function OfferList({ offers, orgslug }: { offers: any[]; orgslug: string }) {
  const oneTime = offers.find((o) => !isSubscription(o))
  const subscription = offers.find(isSubscription)
  if (!oneTime || !subscription) {
    return (
      <>
        {offers.map((offer) => (
          <OfferCard key={offer.offer_id} offer={offer} orgslug={orgslug} />
        ))}
      </>
    )
  }
  const rest = offers.filter((o) => o !== oneTime && o !== subscription)
  return (
    <>
      <PaymentOptionsCard oneTime={oneTime} subscription={subscription} orgslug={orgslug} />
      {rest.map((offer) => (
        <OfferCard key={offer.offer_id} offer={offer} orgslug={orgslug} />
      ))}
    </>
  )
}

function PaymentOptionsCard({
  oneTime,
  subscription,
  orgslug,
}: {
  oneTime: any
  subscription: any
  orgslug: string
}) {
  const { i18n } = useTranslation()
  const price = (o: any) => formatCurrency(o.amount, o.currency ?? 'USD', i18n.language)
  const payWhatYouWant = oneTime.price_type === 'customer_choice'

  return (
    <div className="bg-white rounded-xl nice-shadow overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-600">
        Choose how to pay
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <SquareCheck size={14} /> Pay once
          </span>
          <span className="text-sm font-black text-gray-900">
            {payWhatYouWant ? `from ${price(oneTime)}` : price(oneTime)}
          </span>
        </div>
        {payWhatYouWant && (
          <p className="text-xs text-gray-400 -mt-2">You choose the amount, at least {price(oneTime)}.</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-orange-700">
            <RefreshCcw size={14} /> Subscribe
          </span>
          <span className="text-sm font-black text-orange-700">
            {price(subscription)}
            {subscription.interval ? ` / ${subscription.interval === 'yearly' ? 'year' : 'month'}` : ''}
          </span>
        </div>
        <Link href={getUriWithOrg(orgslug, `/marketplace/offers/${oneTime.offer_uuid}`)}>
          <div className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-sm bg-gray-900 hover:bg-gray-800 text-white transition-colors cursor-pointer">
            Choose how to pay
            <ArrowRight size={13} />
          </div>
        </Link>
      </div>
    </div>
  )
}
