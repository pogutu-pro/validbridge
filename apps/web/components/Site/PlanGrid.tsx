import React from 'react'
import { Check } from '@phosphor-icons/react/dist/ssr'
import { planCta } from '@lib/site/content'
import {
  PLANS,
  formatKesAmount,
  formatKes,
  formatUsdApprox,
  monthlyPriceCents,
  planHighlights,
  yearlyTotalCents,
  type Billing,
  type SitePlan,
} from '@lib/site/pricing'

function PlanPrice({ plan, billing }: { plan: SitePlan; billing: Billing }) {
  const big = 'text-[34px] font-bold leading-[1.1] tracking-[-0.035em] tabular-nums'
  if (plan.priceCents === null || plan.priceCents === 0) {
    const sub =
      plan.priceCents === null ? 'Priced for your needs' : plan.requiresApproval ? 'For verified institutions' : 'No card needed'
    return (
      <div className="mb-6">
        <div className={big}>{plan.priceCents === null ? 'Custom' : 'Free'}</div>
        <div className="s-subtle mt-1 text-[13px]">{sub}</div>
      </div>
    )
  }
  const perMonth = monthlyPriceCents(plan.priceCents, billing)
  return (
    <div className="mb-6">
      <div className={big}>
        <span className="me-1 align-[0.55em] text-[13px] font-semibold tracking-normal">KES</span>
        {formatKesAmount(perMonth)}
        <span className="s-subtle text-[15px] font-medium tracking-normal">/mo</span>
      </div>
      <div className="s-subtle mt-1 text-[13px]">
        {billing === 'yearly' ? `billed yearly ${formatKes(yearlyTotalCents(plan.priceCents))}` : 'billed monthly'}
        {' · '}
        {formatUsdApprox(perMonth)}
      </div>
    </div>
  )
}

/**
 * The five plan cards. Stateless; the caller owns `billing`. `compact` shows
 * fewer allowances (landing page).
 */
export default function PlanGrid({ billing, compact = false }: { billing: Billing; compact?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {PLANS.map((plan) => {
        const cta = planCta(plan, billing)
        const highlights = planHighlights(plan)
        return (
          <div
            key={plan.id}
            className={`relative flex flex-col rounded-[var(--s-r-lg)] bg-[var(--s-bg)] p-6 ${
              plan.popular
                ? 'shadow-[var(--s-shadow-lg)] ring-2 ring-[var(--s-accent)]'
                : 'shadow-[var(--s-shadow-sm)] ring-1 ring-[var(--s-divider)]'
            }`}
          >
            <div className="mb-1 flex min-h-7 items-center justify-between gap-2">
              <h3 className="!text-lg">{plan.name}</h3>
              {plan.popular && (
                <span className="rounded-full bg-[var(--s-accent)] px-2.5 py-1 text-[11px] font-semibold text-white">
                  Most popular
                </span>
              )}
            </div>
            <p className="s-muted mb-5 mt-0 min-h-[4.2em] text-sm leading-snug">{plan.audience}</p>
            <PlanPrice plan={plan} billing={billing} />
            <a
              href={cta.href}
              className={`s-btn s-btn-block ${plan.popular ? 's-btn-primary' : 's-btn-secondary'}`}
            >
              {cta.label}
            </a>
            <p className="s-subtle mb-0 mt-2 min-h-[2.8em] text-center text-xs leading-[1.4]">{cta.note}</p>
            <ul className="m-0 mt-5 flex flex-1 list-none flex-col gap-2.5 border-t border-[var(--s-divider)] p-0 pt-5 text-sm">
              {(compact ? highlights.slice(0, 5) : highlights).map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-[var(--s-accent)]" aria-hidden />
                  <span className="s-muted">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
