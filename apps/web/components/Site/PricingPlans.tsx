'use client'
import React, { useRef, useState } from 'react'
import { KES_PER_USD, YEARLY_DISCOUNT, type Billing } from '@lib/site/pricing'
import PlanGrid from './PlanGrid'

const OPTIONS: Billing[] = ['monthly', 'yearly']

/** Pricing page hero, billing toggle and plan cards; the toggle drives every paid price. */
export default function PricingPlans() {
  const [billing, setBilling] = useState<Billing>('monthly')
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  // Radio group keyboard pattern: arrows move and select, one tab stop.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    if (!keys.includes(e.key)) return
    e.preventDefault()
    const next = OPTIONS[(OPTIONS.indexOf(billing) + 1) % OPTIONS.length]
    setBilling(next)
    refs.current[OPTIONS.indexOf(next)]?.focus()
  }

  const option = (value: Billing, label: React.ReactNode) => {
    const active = billing === value
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        tabIndex={active ? 0 : -1}
        ref={(el) => {
          refs.current[OPTIONS.indexOf(value)] = el
        }}
        onClick={() => setBilling(value)}
        className={`rounded-full px-5 py-2.5 text-[15px] font-semibold transition-all duration-200 ${
          active ? 'bg-white text-[var(--s-text)] shadow-[var(--s-shadow-md)]' : 'text-[var(--s-muted)] hover:text-[var(--s-text)]'
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <section className="s-section s-surface !pt-20 md:!pt-28">
      <div className="s-narrow mb-14 text-center md:mb-16">
        <div className="s-eyebrow">Pricing</div>
        <h1 className="!text-[clamp(38px,5.6vw,64px)]">Start free. Pay only for what you use.</h1>
        <p className="s-lead mx-auto !mt-6 mb-10 max-w-[600px]">
          Everything you need to teach is free on every plan. Pay for the extras that help you grow: more instructors,
          live classes, premium AI and storage.
        </p>
        <div
          role="radiogroup"
          aria-label="Billing period"
          onKeyDown={onKeyDown}
          className="inline-flex rounded-full bg-[var(--s-surface-2)] p-1"
        >
          {option('monthly', 'Monthly')}
          {option(
            'yearly',
            <>
              Yearly{' '}
              <span className="ms-1 rounded-full bg-[var(--s-accent-100)] px-2 py-0.5 text-xs font-semibold text-[var(--s-accent-700)]">
                Save {Math.round(YEARLY_DISCOUNT * 100)}%
              </span>
            </>,
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1320px]">
        <PlanGrid billing={billing} />
        <p className="s-subtle mx-auto mb-0 mt-8 max-w-[720px] text-center text-sm">
          Prices in Kenyan shillings, paid by card, M-Pesa or bank through Paystack. Dollar amounts are approximate (KES{' '}
          {KES_PER_USD} ≈ $1). Yearly billing takes {Math.round(YEARLY_DISCOUNT * 100)}% off the plan and instructor seats.
        </p>
      </div>
    </section>
  )
}
