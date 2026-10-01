import React from 'react'
import type { Metadata } from 'next'
import {
  Check,
  CheckCircle,
  Cpu,
  Database,
  EnvelopeSimple,
  Minus,
  ShieldCheck,
  Sparkle,
  Tag,
  UserPlus,
  VideoCamera,
} from '@phosphor-icons/react/dist/ssr'
import { PRICING_FAQ } from '@lib/site/content'
import {
  AI_CREDIT_PACKS,
  CODE_RUN_PACKS,
  FREE_ON_EVERY_PLAN,
  LIVE_HOUR_PACKS,
  LIVE_UNLIMITED,
  LIVE_UNLIMITED_BREAK_EVEN_HOURS,
  MANAGED_EMAIL,
  PLANS,
  REMOVE_BADGE_CENTS,
  SSO_ADDON_CENTS,
  STORAGE_GB_CENTS,
  comparisonRows,
  formatKes,
  getPlan,
  type ComparisonValue,
  type Pack,
} from '@lib/site/pricing'
import PricingPlans from '@components/Site/PricingPlans'
import CostCalculator from '@components/Site/CostCalculator'
import SiteFaq from '@components/Site/SiteFaq'

// Pricing page. Every number comes from lib/site/pricing.ts.

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Start free and pay only for what you use. Starter is free, Public Education is free for verified public institutions, Growth is KES 3,500 a month and Business KES 9,500, with pay-as-you-go live classes, premium AI and storage.',
  alternates: { canonical: '/pricing' },
}

function Cell({ value }: { value: ComparisonValue }) {
  if (value === true) {
    return (
      <>
        <Check size={18} weight="bold" className="mx-auto text-[var(--s-accent)]" aria-hidden />
        <span className="sr-only">Included</span>
      </>
    )
  }
  if (value === false) {
    return (
      <>
        <Minus size={18} className="mx-auto text-[var(--s-subtle)] opacity-60" aria-hidden />
        <span className="sr-only">Not included</span>
      </>
    )
  }
  return <>{value}</>
}

function SectionHead({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <div className="mb-12 max-w-[720px] md:mb-14">
      <div className="s-eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {intro && <p className="s-lead !mt-5 mb-0">{intro}</p>}
    </div>
  )
}

function PackList({ packs, unit }: { packs: Pack[]; unit: string }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {packs.map((p) => (
        <li key={p.size} className="flex items-baseline justify-between gap-4 text-[15px]">
          <span className="s-muted">
            {p.size.toLocaleString('en-US')} {unit}
          </span>
          <span className="font-semibold tabular-nums">{formatKes(p.priceCents)}</span>
        </li>
      ))}
    </ul>
  )
}

function UsageTile({
  Icon,
  title,
  price,
  children,
  className = '',
}: {
  Icon: React.ElementType
  title: string
  price?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`s-tile flex flex-col ${className}`}>
      <Icon size={26} weight="duotone" className="mb-4 text-[var(--s-accent)]" aria-hidden />
      <h3 className="!mb-1">{title}</h3>
      {price && <div className="mb-3 text-[15px] font-semibold text-[var(--s-accent-700)]">{price}</div>}
      <div className="s-muted text-[15px] [&>p]:m-0 [&>p+p]:mt-2">{children}</div>
    </div>
  )
}

function FreeOnEveryPlan() {
  return (
    <section className="s-section">
      <div className="s-container">
        <SectionHead
          eyebrow="Free on every plan"
          title="Everything you need to teach, at no cost."
          intro="Starter and Public Education included. You only pay for the extras that grow with you."
        />
        <ul className="m-0 grid list-none gap-x-8 gap-y-9 p-0 sm:grid-cols-2 lg:grid-cols-5">
          {FREE_ON_EVERY_PLAN.map((item) => (
            <li key={item.title}>
              <CheckCircle size={24} weight="fill" className="mb-3 text-[var(--s-accent)]" aria-hidden />
              <div className="font-semibold">{item.title}</div>
              <p className="s-muted mb-0 mt-1 text-[15px]">{item.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function PayForWhatYouUse() {
  const growth = getPlan('growth')
  const business = getPlan('business')
  const emailExtra = `+${formatKes(MANAGED_EMAIL.extraBlockCents)} per extra ${MANAGED_EMAIL.extraBlockEmails.toLocaleString('en-US')}`
  return (
    <section className="s-section s-surface">
      <div className="s-container">
        <SectionHead
          eyebrow="Pay only for what you use"
          title="Add more when you need it."
          intro="Your plan's monthly allowance is used first. Above it, buy a pack or add-on from your wallet or saved card."
        />
        <div className="s-bento lg:grid-cols-4">
          <div className="s-tile lg:col-span-2">
            <VideoCamera size={26} weight="duotone" className="mb-4 text-[var(--s-accent)]" aria-hidden />
            <h3 className="!mb-1">Live classes: two ways to pay</h3>
            <p className="s-muted m-0 mb-6 text-[15px]">Plan hours are used first. Then choose what suits how you teach.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-[var(--s-r-md)] bg-[var(--s-surface)] p-5">
                <div className="mb-1 font-semibold">Hour packs</div>
                <p className="s-subtle m-0 mb-4 text-[13px]">One-time, never expire</p>
                <PackList packs={LIVE_HOUR_PACKS} unit="hours" />
              </div>
              <div className="rounded-[var(--s-r-md)] bg-[var(--s-accent-100)] p-5">
                <div className="mb-1 font-semibold">LiveBridge Unlimited</div>
                <p className="m-0 mb-4 text-[13px] text-[var(--s-accent-700)]">Monthly, per instructor</p>
                <div className="text-[26px] font-bold tabular-nums tracking-[-0.02em]">
                  {formatKes(LIVE_UNLIMITED.perInstructorCents)}
                  <span className="s-muted text-[15px] font-medium tracking-normal"> /instructor/mo</span>
                </div>
                <p className="s-muted m-0 mt-2 text-[13px]">Fair use, about {LIVE_UNLIMITED.fairUseHours} hours per instructor a month.</p>
              </div>
            </div>
            <p className="s-muted m-0 mt-5 text-[14px]">
              Unlimited is cheaper once an instructor teaches more than about {LIVE_UNLIMITED_BREAK_EVEN_HOURS} hours a
              month. Your billing page shows which option saves you more.
            </p>
          </div>

          <UsageTile Icon={Sparkle} title="Premium AI credits" className="lg:col-span-2">
            <p className="mb-4">
              Genie, the help and navigation assistant, is free for everyone. Every other AI feature uses credits:
              the course tutor, quiz and course generation, images (5 credits), narrated audio (3), and video captions
              and translation (by the minute). Free plans include no credits, so buy a pack to start. Paid plans include
              a monthly allowance.
            </p>
            <div className="mt-4 rounded-[var(--s-r-md)] bg-[var(--s-surface)] p-5">
              <p className="s-subtle m-0 mb-3 text-[13px]">One-time packs, never expire</p>
              <PackList packs={AI_CREDIT_PACKS} unit="credits" />
            </div>
          </UsageTile>

          <UsageTile Icon={UserPlus} title="Instructor seats">
            <p>
              Growth {formatKes(growth.seats.extraCents!)} · Business {formatKes(business.seats.extraCents!)} per extra
              seat a month.
            </p>
            <p>Each seat adds 200 active learners.</p>
          </UsageTile>
          <UsageTile Icon={Database} title="Storage" price={`${formatKes(STORAGE_GB_CENTS)} per GB a month`}>
            <p>Only for what you store above your plan&apos;s allowance.</p>
          </UsageTile>
          <UsageTile Icon={EnvelopeSimple} title="Managed email" price={`${formatKes(MANAGED_EMAIL.monthlyCents)} a month`}>
            <p>
              {MANAGED_EMAIL.includedEmails.toLocaleString('en-US')} emails, {emailExtra}. Included in Business. Or connect
              your own email key for free.
            </p>
          </UsageTile>
          <UsageTile Icon={Tag} title="Remove the badge" price={`${formatKes(REMOVE_BADGE_CENTS)} a month`}>
            <p>Hide &ldquo;Powered by ValidBridge&rdquo; on Growth. Removed on Business and Enterprise.</p>
          </UsageTile>
          <UsageTile Icon={Tag} title="Single sign-on (SSO)" price={`${formatKes(SSO_ADDON_CENTS)} a month`}>
            <p>Sign in with your Microsoft, Google Workspace or other identity provider. Optional on Growth, Business and Enterprise; pay for it only if you need it.</p>
          </UsageTile>

          <UsageTile
            Icon={Cpu}
            title="Code runs"
            price={`${CODE_RUN_PACKS[0].size.toLocaleString('en-US')} runs = ${formatKes(CODE_RUN_PACKS[0].priceCents)}`}
          >
            <p>One-time pack for auto-graded code exercises beyond your plan.</p>
          </UsageTile>
          <UsageTile Icon={ShieldCheck} title="No surprises" className="lg:col-span-3">
            <p>
              Meters for every allowance, alerts at 80% and 100%, and a monthly spending limit you set. At a limit, new
              usage pauses until you top up: nothing is deleted and a class in progress is never cut off. Pay from a
              prepaid wallet with M-Pesa, or with a saved card.
            </p>
          </UsageTile>
        </div>
      </div>
    </section>
  )
}

function Calculator() {
  return (
    <section id="calculator" className="s-section scroll-mt-16">
      <div className="s-container">
        <SectionHead
          eyebrow="Cost calculator"
          title="Estimate your monthly bill."
          intro="Pick a plan and enter what you expect to use. We price any extras with the cheapest packs."
        />
        <CostCalculator />
      </div>
    </section>
  )
}

function Comparison() {
  const rows = comparisonRows()
  return (
    <section className="s-section s-surface">
      <div className="s-container">
        <div className="mb-12 max-w-[720px]">
          <h2>Compare plans in full.</h2>
        </div>
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0" tabIndex={0} role="region" aria-label="Plan comparison">
          <table className="w-full min-w-[900px] border-collapse text-[15px]">
            <caption className="sr-only">Plans compared: allowances and features for each plan</caption>
            <thead>
              <tr className="border-b border-[var(--s-divider-strong)]">
                <th scope="col" className="w-[24%] pb-4 text-start text-sm font-semibold text-[var(--s-subtle)]">
                  Feature
                </th>
                {PLANS.map((p) => (
                  <th key={p.id} scope="col" className="px-3 pb-4 text-center text-sm font-semibold">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-[var(--s-divider)]">
                  <th scope="row" className="py-4 pe-3 text-start font-normal text-[var(--s-muted)]">
                    {row.label}
                  </th>
                  {row.values.map((v, i) => (
                    <td key={PLANS[i].id} className="px-3 py-4 text-center font-medium">
                      <Cell value={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="s-subtle mb-0 mt-6 text-sm">
          Active learners are members who sign in or learn in a calendar month. Allowances reset on the 1st; packs never
          expire.
        </p>
      </div>
    </section>
  )
}

export default function PricingPage() {
  return (
    <>
      <PricingPlans />
      <FreeOnEveryPlan />
      <PayForWhatYouUse />
      <Calculator />
      <Comparison />
      <section className="s-section">
        <div className="s-narrow">
          <div className="mb-12 text-center">
            <h2>Frequently asked.</h2>
          </div>
          <SiteFaq items={PRICING_FAQ} />
        </div>
      </section>
    </>
  )
}
