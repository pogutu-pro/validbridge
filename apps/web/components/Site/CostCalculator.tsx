'use client'
import React, { useId, useMemo, useState } from 'react'
import { Lightbulb } from '@phosphor-icons/react'
import { PLAN_CTA, planCta } from '@lib/site/content'
import { PLANS, formatKes, formatUsdApprox, getPlan, type Allowance, type PlanId } from '@lib/site/pricing'
import { estimateMonthlyCost } from '@lib/site/pricing-calculator'

type NumberField = 'instructors' | 'storageGb' | 'liveHours' | 'premiumAiCredits'
type ToggleField = 'managedEmail' | 'removeBadge' | 'liveUnlimited'

const INPUT =
  'w-full rounded-[var(--s-r-sm)] bg-[var(--s-bg)] px-4 py-3 text-[16px] font-medium tabular-nums text-[var(--s-text)] ring-1 ring-[var(--s-divider-strong)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--s-accent)]'

function included(value: Allowance, unit: string): string {
  if (value === 'unlimited') return `Unlimited ${unit} included`
  if (value === 'agreed') return 'Agreed with you'
  return `${value.toLocaleString('en-US')} ${unit} included`
}

function NumberInput({
  label,
  hint,
  value,
  onChange,
  min = 0,
}: {
  label: string
  hint: string
  value: string
  onChange: (_value: string) => void
  min?: number
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
        className={INPUT}
      />
      <p id={`${id}-hint`} className="s-subtle mb-0 mt-1.5 text-[13px]">
        {hint}
      </p>
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (_value: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div>
        <label htmlFor={id} className="block cursor-pointer text-[15px] font-semibold">
          {label}
        </label>
        <p id={`${id}-hint`} className="s-subtle m-0 mt-0.5 text-[13px]">
          {hint}
        </p>
      </div>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={`${id}-hint`}
          className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0"
        />
        <span
          aria-hidden
          className="h-7 w-12 rounded-full bg-[var(--s-surface-2)] ring-1 ring-[var(--s-divider)] transition-colors peer-checked:bg-[var(--s-accent)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--s-accent)]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute start-1 top-1 h-5 w-5 rounded-full bg-white shadow-[var(--s-shadow-sm)] transition-transform peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5"
        />
      </span>
    </div>
  )
}

/** Monthly cost estimate from a plan and expected usage. */
export default function CostCalculator() {
  const [planId, setPlanId] = useState<PlanId>('growth')
  const [nums, setNums] = useState<Record<NumberField, string>>({
    instructors: '3',
    storageGb: '10',
    liveHours: '30',
    premiumAiCredits: '300',
  })
  const [toggles, setToggles] = useState<Record<ToggleField, boolean>>({
    managedEmail: false,
    removeBadge: false,
    liveUnlimited: false,
  })
  const planSelectId = useId()
  const plan = getPlan(planId)

  const estimate = useMemo(
    () =>
      estimateMonthlyCost({
        planId,
        instructors: Number(nums.instructors) || 0,
        storageGb: Number(nums.storageGb) || 0,
        liveHours: Number(nums.liveHours) || 0,
        premiumAiCredits: Number(nums.premiumAiCredits) || 0,
        ...toggles,
      }),
    [planId, nums, toggles],
  )

  const setNum = (field: NumberField) => (v: string) => setNums((s) => ({ ...s, [field]: v }))
  const setToggle = (field: ToggleField) => (v: boolean) => setToggles((s) => ({ ...s, [field]: v }))

  const seatHint =
    plan.seats.included === 'unlimited'
      ? 'Unlimited instructors included'
      : typeof plan.seats.included === 'number'
        ? `${included(plan.seats.included, plan.seats.included === 1 ? 'instructor' : 'instructors')}${
            plan.seats.extraCents ? `, then ${formatKes(plan.seats.extraCents)} each a month` : ''
          }`
        : 'Agreed with you'

  const emailHint =
    plan.email === 'included' ? `Included in ${plan.name}` : 'KES 900 a month for 5,000 emails. Your own email key is free.'
  const badgeHint =
    plan.badge === 'removable'
      ? 'KES 500 a month'
      : plan.badge === 'removed'
        ? `Removed on ${plan.name}`
        : `Stays on ${plan.name}`

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      <form className="s-tile !p-6 sm:!p-8" onSubmit={(e) => e.preventDefault()} aria-label="Your school">
        <div className="mb-6">
          <label htmlFor={planSelectId} className="mb-1.5 block text-sm font-semibold">
            Plan
          </label>
          <select
            id={planSelectId}
            value={planId}
            onChange={(e) => setPlanId(e.target.value as PlanId)}
            className={`${INPUT} cursor-pointer`}
          >
            {PLANS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.priceCents === null ? ' (custom)' : p.priceCents === 0 ? ' (free)' : ` (${formatKes(p.priceCents)}/mo)`}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <NumberInput label="Instructors" hint={seatHint} value={nums.instructors} onChange={setNum('instructors')} min={1} />
          <NumberInput
            label="Storage (GB)"
            hint={`${included(plan.storageGb, 'GB')}, then KES 15 per GB`}
            value={nums.storageGb}
            onChange={setNum('storageGb')}
          />
          <NumberInput
            label="Live class hours a month"
            hint={included(plan.liveHours, 'hours')}
            value={nums.liveHours}
            onChange={setNum('liveHours')}
          />
          <NumberInput
            label="Premium AI credits a month"
            hint={included(plan.premiumAiCredits, 'credits')}
            value={nums.premiumAiCredits}
            onChange={setNum('premiumAiCredits')}
          />
        </div>

        <div className="s-rules mt-6">
          <Toggle
            label="LiveBridge Unlimited"
            hint="KES 350 per instructor a month instead of hour packs"
            checked={toggles.liveUnlimited}
            onChange={setToggle('liveUnlimited')}
          />
          <Toggle label="Managed email" hint={emailHint} checked={toggles.managedEmail} onChange={setToggle('managedEmail')} />
          <Toggle
            label="Remove the ValidBridge badge"
            hint={badgeHint}
            checked={toggles.removeBadge}
            onChange={setToggle('removeBadge')}
          />
        </div>
      </form>

      <div className="s-tile s-dark !bg-[var(--s-ink)] !p-6 sm:!p-8 lg:sticky lg:top-24 lg:self-start">
        {estimate.kind === 'quote' ? (
          <div aria-live="polite">
            <div className="text-sm font-semibold text-[var(--s-accent-400)]">Enterprise</div>
            <div className="mt-2 text-[40px] font-bold leading-[1.1] tracking-[-0.035em] text-white">Custom quote</div>
            <p className="mb-8 mt-4">
              Seats, allowances, single sign-on and support are agreed with you. Tell us what you need and we&apos;ll
              send a quote.
            </p>
            <a href={PLAN_CTA.contact.href} className="s-btn s-btn-lg s-btn-primary">
              {PLAN_CTA.contact.label}
            </a>
          </div>
        ) : (
          <>
            <div aria-live="polite" aria-atomic="true">
              <div className="text-sm font-semibold text-[var(--s-accent-400)]">Estimated monthly total</div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 text-white">
                <span className="text-[44px] font-bold leading-[1.1] tracking-[-0.035em] tabular-nums">
                  {formatKes(estimate.totalCents)}
                </span>
                <span className="text-[15px] text-[var(--s-ink-text)]">{formatUsdApprox(estimate.totalCents)}</span>
              </div>
            </div>

            <ul className="s-rules m-0 mt-6 list-none p-0 text-[15px]">
              {estimate.lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <div className="font-medium text-white">{l.label}</div>
                    <div className="text-[13px]">{l.detail}</div>
                  </div>
                  <div className="shrink-0 font-semibold tabular-nums text-white">
                    {l.cents === 0 ? 'KES 0' : formatKes(l.cents)}
                  </div>
                </li>
              ))}
            </ul>

            {estimate.liveTip && (
              <p className="mb-0 mt-5 flex gap-2.5 rounded-[var(--s-r-sm)] bg-[var(--s-ink-2)] p-4 text-[14px] text-[#d9d6d2]">
                <Lightbulb size={20} weight="duotone" className="shrink-0 text-[var(--s-accent-400)]" aria-hidden />
                {estimate.liveTip.option === 'unlimited'
                  ? `LiveBridge Unlimited would save you ${formatKes(estimate.liveTip.savesCents)} a month.`
                  : `Live hour packs would cost ${formatKes(estimate.liveTip.savesCents)} less this month.`}
              </p>
            )}

            <ul className="m-0 mt-5 flex list-none flex-col gap-2 p-0 text-[13px]">
              {estimate.yearlySavingsCents > 0 && (
                <li>Pay yearly and save {formatKes(estimate.yearlySavingsCents)} a month on the plan and seats.</li>
              )}
              {estimate.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li>An estimate before any taxes. Dollar amounts are approximate.</li>
            </ul>

            <a href={planCta(plan).href} className="s-btn s-btn-block s-btn-primary mt-7">
              {planCta(plan).label}
            </a>
          </>
        )}
      </div>
    </div>
  )
}
