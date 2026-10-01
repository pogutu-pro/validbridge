'use client'

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditCard, Loader2, Wallet, X } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  billingApi,
  billingErrorMessage,
  formatKesCents,
  newIdempotencyKey,
  type BillingItem,
  type Card,
  type Quote,
} from '@services/billing/platform'

// Billing periods run 00:00 UTC to 00:00 UTC on the 1st, so dates are shown
// in UTC: a period ending 1 Nov 00:00 is "to 31 Oct" everywhere.
const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', DAY)
/** Last covered day of a period whose ``end`` is exclusive. */
const fmtLastDay = (iso: string) => new Date(new Date(iso).getTime() - 1).toLocaleDateString('en-GB', DAY)

/**
 * Pay for one item. The server quotes the amount; the school then picks how
 * to pay: Paystack checkout (card, M-Pesa, bank), the prepaid wallet, or a
 * saved card. Nothing here computes a price.
 */
export default function PayDialog({
  orgId,
  orgSlug,
  token,
  item,
  walletBalanceCents,
  cards,
  onClose,
  onPaid,
}: {
  orgId: number
  orgSlug: string
  token?: string
  item: BillingItem | null
  walletBalanceCents: number
  cards: Card[]
  onClose: () => void
  onPaid: () => void
}) {
  const { t } = useTranslation()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [saveCard, setSaveCard] = useState(true)

  // The parent keys this dialog by item, so state starts fresh per item.
  useEffect(() => {
    if (!item) return
    let live = true
    billingApi
      .quote(orgId, item, token)
      .then((q) => live && setQuote(q))
      .catch((err) => live && setQuoteError(billingErrorMessage(err)))
    return () => {
      live = false
    }
  }, [item, orgId, token])

  if (!item) return null
  const isTopup = item.type === 'wallet_topup'
  const isYearly = item.type === 'plan' && item.cycle === 'yearly'
  const amount = quote?.amount_cents ?? 0

  const checkout = async () => {
    setBusy('checkout')
    try {
      const res = await billingApi.checkout(
        orgId,
        {
          item,
          return_url: `${window.location.origin}/billing?org=${encodeURIComponent(orgSlug)}`,
          save_card: saveCard,
          idempotency_key: newIdempotencyKey(),
        },
        token
      )
      if (res.status === 'paid') {
        toast.success(t('billing.paid', { defaultValue: 'Paid. Thank you!' }))
        onPaid()
        return
      }
      if (res.authorization_url) {
        window.location.href = res.authorization_url
        return
      }
      toast.error(t('billing.checkout_failed', { defaultValue: 'Could not start the payment.' }))
    } catch (err) {
      toast.error(billingErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const purchase = async (payWith: 'wallet' | 'card', card?: Card) => {
    setBusy(payWith === 'wallet' ? 'wallet' : `card-${card?.id}`)
    try {
      const res = await billingApi.purchase(
        orgId,
        { item, pay_with: payWith, payment_method_id: card?.id, idempotency_key: newIdempotencyKey() },
        token
      )
      if (res.status === 'paid') {
        toast.success(t('billing.paid', { defaultValue: 'Paid. Thank you!' }))
        onPaid()
      } else if (res.status === 'action_required') {
        toast(t('billing.card_needs_action', { defaultValue: 'Your bank needs a confirmation step. Continuing on Paystack…' }))
        await checkout()
      } else if (res.status === 'pending') {
        toast(t('billing.pending', { defaultValue: 'Payment is processing. We will update this page when it completes.' }))
        onPaid()
      } else {
        toast.error(res.message || t('billing.declined', { defaultValue: 'The payment was declined.' }))
      }
    } catch (err) {
      toast.error(billingErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const button =
    'flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={busy ? undefined : onClose} />
      <div className="relative mx-4 w-full max-w-md rounded-2xl bg-white p-6 nice-shadow">
        <button
          onClick={onClose}
          disabled={!!busy}
          aria-label={t('common.close', { defaultValue: 'Close' })}
          className="absolute end-4 top-4 rounded-lg p-1.5 text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>

        {!quote && !quoteError && (
          <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            {t('billing.quoting', { defaultValue: 'Getting the price…' })}
          </div>
        )}
        {quoteError && (
          <div className="py-4">
            <p className="text-sm font-semibold text-rose-700">{quoteError}</p>
            <button onClick={onClose} className="mt-4 text-sm font-semibold text-gray-600 underline">
              {t('common.close', { defaultValue: 'Close' })}
            </button>
          </div>
        )}

        {quote && (
          <>
            <p className="pe-6 text-sm font-medium text-gray-500">{quote.description}</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-gray-900">{formatKesCents(amount)}</p>
            {quote.covers_until && !isTopup && (
              <p className="mt-1 text-sm font-semibold text-gray-700">
                {quote.period_start
                  ? t('billing.covers_range', {
                      defaultValue: 'Covers {{from}} to {{to}}',
                      from: fmtDay(quote.period_start),
                      to: fmtLastDay(quote.covers_until),
                    })
                  : t('billing.covers_through', {
                      defaultValue: 'Covers today to {{to}}',
                      to: fmtLastDay(quote.covers_until),
                    })}
              </p>
            )}

            {quote.note && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-medium leading-relaxed text-amber-900 ring-1 ring-amber-200">
                {quote.note}
              </p>
            )}

            {quote.lines?.length > 0 && !isTopup && (
              <div className="mt-4 rounded-xl bg-gray-50 p-3 text-xs">
                <p className="mb-2 font-bold uppercase tracking-wide text-gray-400">
                  {t('billing.what_you_pay_for', { defaultValue: "What you're paying for" })}
                </p>
                <ul className="space-y-2">
                  {quote.lines.map((line, i) => (
                    <li key={i} className="flex items-start justify-between gap-3">
                      <span className="text-gray-700">
                        <span className="block font-semibold">{line.label}</span>
                        {line.start && line.end && (
                          <span className="block text-gray-400">
                            {fmtDay(line.start)} – {fmtLastDay(line.end)}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-gray-900">
                        {formatKesCents(line.amount_cents)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 font-bold text-gray-900">
                  <span>{t('billing.total_today', { defaultValue: 'Total today' })}</span>
                  <span className="tabular-nums">{formatKesCents(amount)}</span>
                </div>
              </div>
            )}

            {quote.next_charge_at && quote.next_charge_cents != null && !isTopup && (
              <p className="mt-3 text-xs leading-relaxed text-gray-500">
                {t(isYearly ? 'billing.next_charge_yearly' : 'billing.next_charge_monthly', {
                  defaultValue: isYearly
                    ? 'Next charge: {{amount}} on {{date}}, then once a year. You can change or cancel before then; nothing you have paid for is taken away.'
                    : 'Next charge: {{amount}} on {{date}}, then on the 1st of every month, plus any extra seats, add-ons or storage you use. You can change or cancel before then; nothing you have paid for is taken away.',
                  amount: formatKesCents(quote.next_charge_cents),
                  date: fmtDay(quote.next_charge_at),
                })}
              </p>
            )}

            <div className="mt-6 space-y-2">
              <button
                onClick={checkout}
                disabled={!!busy}
                className={`${button} bg-gray-900 text-white hover:bg-gray-800`}
              >
                <span className="flex items-center gap-2">
                  <CreditCard size={16} />
                  {t('billing.pay_checkout', { defaultValue: 'Card, M-Pesa or bank' })}
                </span>
                {busy === 'checkout' && <Loader2 size={15} className="animate-spin" />}
              </button>
              {!isTopup && (
                <label className="flex items-center gap-2 px-1 text-xs text-gray-500">
                  <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} />
                  {t('billing.save_card', { defaultValue: 'Save my card for renewals and one-click purchases' })}
                </label>
              )}

              {!isTopup && walletBalanceCents >= amount && amount > 0 && (
                <button
                  onClick={() => purchase('wallet')}
                  disabled={!!busy}
                  className={`${button} bg-gray-100 text-gray-900 hover:bg-gray-200`}
                >
                  <span className="flex items-center gap-2">
                    <Wallet size={16} />
                    {t('billing.pay_wallet', {
                      defaultValue: 'Wallet ({{balance}} available)',
                      balance: formatKesCents(walletBalanceCents),
                    })}
                  </span>
                  {busy === 'wallet' && <Loader2 size={15} className="animate-spin" />}
                </button>
              )}

              {!isTopup &&
                amount > 0 &&
                cards.map((card) => (
                  <button
                    key={card.id}
                    onClick={() => purchase('card', card)}
                    disabled={!!busy}
                    className={`${button} bg-gray-100 text-gray-900 hover:bg-gray-200`}
                  >
                    <span className="flex items-center gap-2">
                      <CreditCard size={16} />
                      {(card.brand || 'Card').toUpperCase()} •••• {card.last4}
                    </span>
                    {busy === `card-${card.id}` && <Loader2 size={15} className="animate-spin" />}
                  </button>
                ))}
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-gray-400">
              {t('billing.secure_note', {
                defaultValue:
                  'Payments are processed by Paystack. ValidBridge never sees your card number. Prices in KES.',
              })}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
