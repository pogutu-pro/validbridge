'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { AlertTriangle, Check, CreditCard, Loader2, PauseCircle, Trash2, Wallet } from 'lucide-react'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import { SALES_EMAIL } from '@lib/site/content'
import { clearPlanIntent } from '@services/billing/planIntent'
import {
  billingApi,
  billingErrorMessage,
  formatKesCents,
  type BillingItem,
  type Catalog,
  type Cycle,
  type Overview,
} from '@services/billing/platform'
import PayDialog from './PayDialog'
import BillingComingSoon from './BillingComingSoon'

const RANK: Record<string, number> = { 'public-education': 0, starter: 0, growth: 1, business: 2, enterprise: 3 }
// Enterprise joins the picker once the catalogue gives it a base price.
const PICKER_PLANS = ['starter', 'growth', 'business', 'enterprise'] as const
const card = 'bg-white nice-shadow rounded-2xl p-6'
const h2 = 'text-base font-bold tracking-tight text-gray-900'

function fmtDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'
}

/** Last covered day of a period whose end is exclusive (00:00 UTC on the 1st). */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 max-w-3xl text-xs leading-relaxed text-gray-500">{children}</p>
}

function HowPayingWorks() {
  const { t } = useTranslation()
  const points = [
    t('billing.trust_see_first', { defaultValue: 'You always see the exact amount and dates before you pay.' }),
    t('billing.trust_paystack', {
      defaultValue: 'Payments go through Paystack. We never see or keep your card number.',
    }),
    t('billing.trust_methods', { defaultValue: 'Pay by card, M-Pesa or bank. All prices are in Kenyan shillings (KES).' }),
    t('billing.trust_no_hidden', {
      defaultValue:
        'No hidden charges. You only pay for your plan, the add-ons and packs you choose, and storage above your allowance.',
    }),
    t('billing.trust_nothing_lost', {
      defaultValue: 'If you change plan or stop an add-on, you keep what you already paid for until it ends.',
    }),
  ]
  return (
    <div className="rounded-2xl bg-white p-6 nice-shadow" id="how-paying-works">
      <h2 className="text-base font-bold text-gray-900">
        {t('billing.how_paying_works', { defaultValue: 'How paying works' })}
      </h2>
      <ul className="mt-3 space-y-2 text-sm text-gray-600">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-gray-600">
        {t('billing.questions', { defaultValue: 'A question about a charge?' })}{' '}
        <a href={`mailto:${SALES_EMAIL}?subject=Billing%20question`} className="font-semibold text-gray-900 underline underline-offset-2">
          {SALES_EMAIL}
        </a>
      </p>
    </div>
  )
}

function fmtLastDay(iso: string): string {
  return new Date(new Date(iso).getTime() - 1).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/** Where a plan sits relative to the current one: pay now, or switch at period end. */
function planAction(current: string, currentCycle: Cycle, plan: string, cycle: Cycle): 'current' | 'upgrade' | 'downgrade' {
  if (plan === current && cycle === currentCycle) return 'current'
  const a = RANK[current] ?? 0
  const b = RANK[plan] ?? 0
  if (b > a) return 'upgrade'
  if (b < a) return 'downgrade'
  if (plan === current) return cycle === 'yearly' ? 'upgrade' : 'downgrade'
  return 'upgrade'
}

// ── Meters ───────────────────────────────────────────────────────────────────

const METERS: { key: string; label: string; unit?: 'bytes' | 'seconds' }[] = [
  { key: 'instructor_seats', label: 'Instructor seats' },
  { key: 'learners', label: 'Active learners this month' },
  { key: 'storage', label: 'Storage', unit: 'bytes' },
  { key: 'live_seconds', label: 'Live class hours this month', unit: 'seconds' },
  { key: 'premium_ai_credits', label: 'Premium AI credits this month' },
  { key: 'code_runs', label: 'Code runs this month' },
  { key: 'managed_emails', label: 'Managed emails this month' },
]

function fmtUnit(value: number, unit?: 'bytes' | 'seconds'): string {
  if (unit === 'bytes') {
    const gb = value / 1024 ** 3
    return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`
  }
  if (unit === 'seconds') return `${Math.round((value / 3600) * 10) / 10} h`
  return value.toLocaleString('en-KE')
}

function Meters({ overview }: { overview: Overview }) {
  const { t } = useTranslation()
  return (
    <div className={card} id="usage">
      <h2 className={h2}>{t('billing.usage', { defaultValue: 'Usage' })}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {METERS.filter((m) => overview.meters[m.key]).map((m) => {
          const { used, limit } = overview.meters[m.key]
          const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
          const tone = !limit ? 'bg-gray-300' : pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-gray-900'
          return (
            <div key={m.key}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-gray-700">{t(`billing.meters.${m.key}`, { defaultValue: m.label })}</span>
                <span className={`tabular-nums ${pct >= 100 ? 'font-bold text-rose-600' : 'text-gray-500'}`}>
                  {fmtUnit(used, m.unit)} / {limit == null ? t('billing.unlimited', { defaultValue: 'Unlimited' }) : fmtUnit(limit, m.unit)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.05]">
                <div className={`h-full rounded-full ${tone}`} style={{ width: `${limit ? pct : 0}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-4 text-xs text-gray-400">
        {t('billing.usage_note', {
          defaultValue: 'Monthly allowances reset on the 1st. Packs you buy never expire and are used after the allowance.',
        })}
      </p>
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function BillingDashboard({ org, token }: { org: any; token?: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const orgId: number = org.id
  const orgSlug: string = org.slug
  const [payItem, setPayItem] = useState<BillingItem | null>(null)
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const handledParams = useRef(false)

  const overviewQ = useQuery({
    queryKey: ['billing', 'overview', orgId],
    queryFn: () => billingApi.overview(orgId, token),
    enabled: !!token,
  })
  const catalogQ = useQuery({
    queryKey: ['billing', 'catalog'],
    queryFn: () => billingApi.catalog(token),
    staleTime: 5 * 60_000,
  })
  const invoicesQ = useQuery({
    queryKey: ['billing', 'invoices', orgId],
    queryFn: () => billingApi.invoices(orgId, token),
    enabled: !!token && !!overviewQ.data?.enabled,
  })

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['billing'] })
  }, [queryClient])

  const overview = overviewQ.data
  const catalog = catalogQ.data

  // Deep links: ?billing_reference= (back from Paystack), ?invoice=, ?plan=, ?focus=.
  useEffect(() => {
    if (handledParams.current || !overview || !catalog) return
    handledParams.current = true
    const params = new URLSearchParams(searchParams?.toString() || '')
    const reference = params.get('billing_reference') || params.get('reference')
    const invoiceId = params.get('invoice')
    const plan = params.get('plan')
    const focus = params.get('focus')

    if (reference) {
      billingApi
        .verify(orgId, reference, token)
        .then((res) => {
          if (res.status === 'paid') toast.success(t('billing.paid', { defaultValue: 'Paid. Thank you!' }))
          else if (res.status === 'pending')
            toast(t('billing.pending', { defaultValue: 'Payment is processing. We will update this page when it completes.' }))
          else toast.error(t('billing.not_paid', { defaultValue: 'The payment did not go through. You have not been charged.' }))
          refresh()
        })
        .catch((err) => toast.error(billingErrorMessage(err)))
    }
    if (invoiceId && Number(invoiceId)) {
      setPayItem({ type: 'invoice', invoice_id: Number(invoiceId) })
    } else if (plan && ['growth', 'business', 'enterprise'].includes(plan) && !reference) {
      const wantCycle: Cycle = params.get('cycle') === 'yearly' ? 'yearly' : 'monthly'
      setCycle(wantCycle)
      if (planAction(overview.plan, overview.cycle, plan, wantCycle) === 'upgrade') {
        setPayItem({ type: 'plan', plan, cycle: wantCycle })
      }
      clearPlanIntent()
    }
    if (focus) {
      setTimeout(() => document.getElementById(focus)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
    }
    const consumed = ['billing_reference', 'reference', 'trxref', 'invoice', 'plan', 'cycle', 'focus']
    if (consumed.some((key) => params.has(key))) {
      for (const key of consumed) params.delete(key)
      router.replace(`/billing?${params.toString()}`, { scroll: false })
    }
  }, [overview, catalog, searchParams, orgId, token, router, refresh, t])

  if (overviewQ.isLoading || catalogQ.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-40 w-full animate-pulse rounded-2xl bg-black/[0.03]" />
        <div className="h-64 w-full animate-pulse rounded-2xl bg-black/[0.03]" />
      </div>
    )
  }
  if (overviewQ.isError || !overview || !catalog) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
        <p className="font-semibold text-rose-700">
          {billingErrorMessage(overviewQ.error, t('billing.overview_failed', { defaultValue: "We couldn't load billing." }))}
        </p>
        <button
          onClick={() => overviewQ.refetch()}
          className="mt-3 inline-flex items-center rounded-full bg-rose-700 px-4 py-1.5 text-sm font-bold text-white hover:bg-rose-800"
        >
          {t('common.retry', { defaultValue: 'Retry' })}
        </button>
      </div>
    )
  }
  if (!overview.enabled) return <BillingComingSoon />

  const plans = catalog.catalog.plans
  const planLabel = (id: string) => plans[id]?.label || id
  const openInvoice = overview.open_invoices[0]

  return (
    <div className="space-y-5">
      <Toast />

      {overview.status !== 'active' && openInvoice && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${
            overview.status === 'paused' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div className="flex items-start gap-3">
            {overview.status === 'paused' ? (
              <PauseCircle size={20} className="mt-0.5 shrink-0 text-rose-600" />
            ) : (
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
            )}
            <p className={`text-sm font-semibold ${overview.status === 'paused' ? 'text-rose-800' : 'text-amber-800'}`}>
              {overview.status === 'paused'
                ? t('billing.paused_banner', {
                    defaultValue:
                      'Paid features are paused until invoice {{number}} is paid. Nothing has been deleted.',
                    number: openInvoice.number,
                  })
                : t('billing.past_due_banner', {
                    defaultValue: 'Invoice {{number}} ({{amount}}) is unpaid. Pay it to avoid a pause.',
                    number: openInvoice.number,
                    amount: formatKesCents(openInvoice.total_cents),
                  })}
            </p>
          </div>
          <button
            onClick={() => setPayItem({ type: 'invoice', invoice_id: openInvoice.id })}
            className="rounded-full bg-gray-900 px-4 py-1.5 text-sm font-bold text-white hover:bg-gray-800"
          >
            {t('billing.pay_invoice', { defaultValue: 'Pay invoice' })}
          </button>
        </div>
      )}

      {/* Current plan */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('billing.current_plan', { defaultValue: 'Current plan' })}
            </p>
            <p className="mt-1 text-2xl font-black tracking-tight text-gray-900">
              {planLabel(overview.plan)}
              {(plans[overview.plan]?.price_cents ?? 0) > 0 && (
                <span className="ms-2 text-sm font-semibold text-gray-400">
                  {overview.cycle === 'yearly'
                    ? t('billing.yearly', { defaultValue: 'yearly' })
                    : t('billing.monthly', { defaultValue: 'monthly' })}
                </span>
              )}
            </p>
            {overview.period_end && (plans[overview.plan]?.price_cents ?? 0) > 0 && (
              <p className="mt-1 text-sm text-gray-500">
                {t('billing.paid_through', { defaultValue: 'Paid up to and including {{date}}', date: fmtLastDay(overview.period_end) })}
              </p>
            )}
            {overview.exempt && (
              <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                {t('billing.exempt', { defaultValue: 'Not billed' })}
              </p>
            )}
          </div>
          <div className="text-end">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('billing.wallet', { defaultValue: 'Wallet' })}
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{formatKesCents(overview.wallet_balance_cents)}</p>
          </div>
        </div>
        {overview.pending_plan && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-sm text-gray-700">
              {t('billing.pending_change', {
                defaultValue: 'Switching to {{plan}} ({{cycle}}) on {{date}}.',
                plan: planLabel(overview.pending_plan),
                cycle: overview.pending_cycle || 'monthly',
                date: fmtDate(overview.period_end),
              })}
            </p>
            <button
              onClick={async () => {
                try {
                  await billingApi.cancelSchedule(orgId, token)
                  toast.success(t('billing.change_cancelled', { defaultValue: 'Scheduled change cancelled.' }))
                  refresh()
                } catch (err) {
                  toast.error(billingErrorMessage(err))
                }
              }}
              className="text-sm font-semibold text-gray-900 underline underline-offset-2"
            >
              {t('billing.keep_plan', { defaultValue: 'Keep current plan' })}
            </button>
          </div>
        )}
      </div>

      {/* Plans */}
      <div className={card} id="plans">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={h2}>{t('billing.plans', { defaultValue: 'Plans' })}</h2>
          <div className="inline-flex rounded-full bg-black/[0.04] p-1 text-xs font-bold">
            {(['monthly', 'yearly'] as Cycle[]).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                className={`rounded-full px-3 py-1.5 ${cycle === c ? 'bg-white text-gray-900 nice-shadow' : 'text-gray-500'}`}
              >
                {c === 'monthly'
                  ? t('billing.monthly_cap', { defaultValue: 'Monthly' })
                  : t('billing.yearly_save', {
                      defaultValue: 'Yearly (save {{pct}}%)',
                      pct: catalog.catalog.yearly_discount_percent,
                    })}
              </button>
            ))}
          </div>
        </div>
        <Hint>
          {t('billing.hint_plans', {
            defaultValue:
              'Today you pay for the rest of this month. After that, you pay the plan price on the 1st of every month. If the month ends in less than 7 days, today’s payment also covers next month. Yearly: pay once for 12 months and save 15%.',
          })}
        </Hint>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PICKER_PLANS.map((id) => {
            const p = plans[id]
            if (!p || (id === 'enterprise' && !p.price_cents)) return null
            const action = planAction(overview.plan, overview.cycle, id, p.price_cents ? cycle : 'monthly')
            return (
              <div
                key={id}
                className={`flex flex-col rounded-xl p-4 ring-1 ${
                  overview.plan === id ? 'bg-gray-50 ring-gray-900' : 'ring-black/[0.08]'
                }`}
              >
                <p className="font-bold text-gray-900">{p.label}</p>
                <p className="mt-1 text-lg font-black tabular-nums text-gray-900">
                  {p.price_cents ? (
                    <>
                      {formatKesCents(p.price_cents)}
                      <span className="text-xs font-semibold text-gray-400"> /{t('billing.mo', { defaultValue: 'mo' })}</span>
                    </>
                  ) : (
                    t('billing.free', { defaultValue: 'Free' })
                  )}
                </p>
                <ul className="mt-3 flex-1 space-y-1 text-xs text-gray-500">
                  <li>
                    {p.included_seats == null
                      ? t('billing.unlimited_seats', { defaultValue: 'Unlimited instructor seats' })
                      : t('billing.n_seats', { defaultValue: '{{n}} instructor seat(s)', n: p.included_seats })}
                  </li>
                  <li>
                    {p.learner_allowance != null
                      ? t('billing.n_learners', { defaultValue: '{{n}} active learners', n: p.learner_allowance })
                      : t('billing.learners_per_seat', {
                          defaultValue: '{{n}} active learners per seat',
                          n: catalog.catalog.learners_per_seat,
                        })}
                  </li>
                  {p.storage_bytes != null && <li>{fmtUnit(p.storage_bytes, 'bytes')} storage</li>}
                  {p.live_seconds != null && <li>{fmtUnit(p.live_seconds, 'seconds')} live classes / month</li>}
                </ul>
                <div className="mt-4">
                  {action === 'current' ? (
                    <span className="inline-flex items-center gap-1 text-sm font-bold text-gray-900">
                      <Check size={14} /> {t('billing.your_plan', { defaultValue: 'Your plan' })}
                    </span>
                  ) : action === 'upgrade' ? (
                    <button
                      onClick={() => setPayItem({ type: 'plan', plan: id, cycle })}
                      disabled={overview.status === 'paused'}
                      className="w-full rounded-xl bg-gray-900 px-3 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-40"
                    >
                      {t('billing.upgrade_to', { defaultValue: 'Upgrade to {{plan}}', plan: p.label })}
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        const when = overview.period_end ? fmtDate(overview.period_end) : ''
                        const ok = window.confirm(
                          when
                            ? t('billing.confirm_downgrade', {
                                defaultValue:
                                  'Switch to {{plan}} on {{date}}? You keep everything you paid for until then, and nothing is deleted.',
                                plan: p.label,
                                date: when,
                              })
                            : t('billing.confirm_switch', { defaultValue: 'Switch to {{plan}} now? Nothing is deleted.', plan: p.label })
                        )
                        if (!ok) return
                        try {
                          const res = await billingApi.schedulePlan(orgId, id, p.price_cents ? cycle : 'monthly', token)
                          toast.success(
                            res.status === 'scheduled'
                              ? t('billing.scheduled', { defaultValue: 'Plan change scheduled.' })
                              : t('billing.changed', { defaultValue: 'Plan changed.' })
                          )
                          refresh()
                        } catch (err) {
                          toast.error(billingErrorMessage(err))
                        }
                      }}
                      className="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm font-bold text-gray-800 hover:bg-gray-200"
                    >
                      {t('billing.switch_to', { defaultValue: 'Switch to {{plan}}', plan: p.label })}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {plans.enterprise && !plans.enterprise.price_cents && (
            <div
              className={`flex flex-col rounded-xl p-4 ring-1 ${
                overview.plan === 'enterprise' ? 'bg-gray-50 ring-gray-900' : 'ring-black/[0.08]'
              }`}
            >
              <p className="font-bold text-gray-900">{plans.enterprise.label}</p>
              <p className="mt-1 text-lg font-black text-gray-900">
                {t('billing.custom_price', { defaultValue: 'Custom' })}
              </p>
              <ul className="mt-3 flex-1 space-y-1 text-xs text-gray-500">
                <li>{t('billing.ent_seats', { defaultValue: 'Seats, learners and storage agreed for you' })}</li>
                <li>{t('billing.ent_sso', { defaultValue: 'SSO, SCORM and managed email' })}</li>
                <li>{t('billing.ent_support', { defaultValue: 'Dedicated support' })}</li>
              </ul>
              <div className="mt-4">
                {overview.plan === 'enterprise' ? (
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-gray-900">
                    <Check size={14} /> {t('billing.your_plan', { defaultValue: 'Your plan' })}
                  </span>
                ) : (
                  <a
                    href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`Enterprise plan for ${org.name}`)}`}
                    className="block w-full rounded-xl border border-gray-900 px-3 py-2 text-center text-sm font-bold text-gray-900 hover:bg-gray-50"
                  >
                    {t('billing.talk_to_us_short', { defaultValue: 'Talk to us' })}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500">
          <span>
            {t('billing.enterprise_line', { defaultValue: 'Need a custom deal, more seats or SSO?' })}{' '}
            <a
              href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`Enterprise plan for ${org.name}`)}`}
              className="font-semibold text-gray-900 underline underline-offset-2"
            >
              {t('billing.talk_to_us', { defaultValue: 'Talk to us' })}
            </a>
          </span>
          <span>
            {t('billing.public_ed_line', { defaultValue: 'A public school or university?' })}{' '}
            <a
              href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`Public Education application: ${org.name}`)}`}
              className="font-semibold text-gray-900 underline underline-offset-2"
            >
              {t('billing.apply_public_ed', { defaultValue: 'Apply for Public Education' })}
            </a>
          </span>
        </div>
      </div>

      <Meters overview={overview} />

      <Shop
        overview={overview}
        catalog={catalog}
        onBuy={setPayItem}
        onEnd={async (addonId) => {
          if (!window.confirm(t('billing.confirm_end_addon', { defaultValue: 'Stop this add-on? It stays active until the end of what you already paid for. No refund.' })))
            return
          try {
            const res = await billingApi.endAddon(orgId, addonId, token)
            toast.success(t('billing.addon_ending', { defaultValue: 'Ends on {{date}}.', date: fmtDate(res.ends_at) }))
            refresh()
          } catch (err) {
            toast.error(billingErrorMessage(err))
          }
        }}
      />

      <WalletAndCards
        overview={overview}
        orgId={orgId}
        token={token}
        onTopup={(cents) => setPayItem({ type: 'wallet_topup', amount_cents: cents })}
        refresh={refresh}
      />

      <Invoices
        invoices={invoicesQ.data || []}
        loading={invoicesQ.isLoading}
        onPay={(id) => setPayItem({ type: 'invoice', invoice_id: id })}
      />

      <Settings overview={overview} orgId={orgId} token={token} refresh={refresh} />

      <HowPayingWorks />

      <PayDialog
        key={JSON.stringify(payItem)}
        orgId={orgId}
        orgSlug={orgSlug}
        token={token}
        item={payItem}
        walletBalanceCents={overview.wallet_balance_cents}
        cards={overview.cards}
        onClose={() => setPayItem(null)}
        onPaid={() => {
          setPayItem(null)
          refresh()
        }}
      />
    </div>
  )
}

// ── Shop (packs + add-ons) ───────────────────────────────────────────────────

const PACK_LABELS: Record<string, (_qty: number) => string> = {
  ai_credits: (q) => `${q.toLocaleString('en-KE')} premium AI credits`,
  live_seconds: (q) => `${q / 3600} live class hours`,
  code_runs: (q) => `${q.toLocaleString('en-KE')} code runs`,
}

const ADDON_LABELS: Record<string, string> = {
  extra_seat: 'Extra instructor seat',
  live_unlimited: 'LiveBridge Unlimited (per instructor)',
  managed_email: 'Managed email (5,000 emails / month)',
  remove_badge: 'Remove the "Powered by ValidBridge" badge',
  sso: 'Single sign-on (SSO)',
}

function Shop({
  overview,
  catalog,
  onBuy,
  onEnd,
}: {
  overview: Overview
  catalog: Catalog
  onBuy: (_item: BillingItem) => void
  onEnd: (_addonId: number) => void
}) {
  const { t } = useTranslation()
  const [seatQty, setSeatQty] = useState(1)
  const [liveQty, setLiveQty] = useState(1)
  const addons = useMemo(() => catalog.catalog.addons || {}, [catalog])
  const plan = overview.plan
  const paused = overview.status === 'paused'

  const offered = useMemo(() => {
    const out: { id: string; price?: number; qty?: [number, (_n: number) => void] }[] = []
    const seatPrice = addons.extra_seat?.price_cents_by_plan?.[plan]
    if (seatPrice) out.push({ id: 'extra_seat', price: seatPrice, qty: [seatQty, setSeatQty] })
    if (addons.live_unlimited) out.push({ id: 'live_unlimited', price: addons.live_unlimited.price_cents, qty: [liveQty, setLiveQty] })
    if (addons.managed_email && !(addons.managed_email.included_in_plans || []).includes(plan))
      out.push({ id: 'managed_email', price: addons.managed_email.price_cents })
    if (addons.remove_badge && (addons.remove_badge.available_on_plans || []).includes(plan))
      out.push({ id: 'remove_badge', price: addons.remove_badge.price_cents })
    if (addons.sso && (addons.sso.available_on_plans || []).includes(plan))
      out.push({ id: 'sso', price: addons.sso.price_cents })
    return out
  }, [addons, plan, seatQty, liveQty])

  return (
    <div className={card} id="addons">
      <h2 className={h2}>{t('billing.addons', { defaultValue: 'Add-ons' })}</h2>
      <Hint>
        {t('billing.hint_addons', {
          defaultValue:
            'Add-ons are monthly. Today you pay only for the days left in this month. From the 1st, they are added to your monthly bill. You can stop one any time; it stays on until the end of the month.',
        })}
      </Hint>
      <div className="mt-3 divide-y divide-black/[0.05]" id="seats">
        {offered.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">{t(`billing.addon.${a.id}`, { defaultValue: ADDON_LABELS[a.id] })}</p>
              {a.price != null && (
                <p className="text-xs text-gray-500">
                  {formatKesCents(a.price)} / {t('billing.month', { defaultValue: 'month' })}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {a.qty && (
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={a.qty[0]}
                  onChange={(e) => a.qty![1](Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                  className="w-16 rounded-lg border border-black/10 px-2 py-1.5 text-sm tabular-nums"
                  aria-label={t('billing.quantity', { defaultValue: 'Quantity' })}
                />
              )}
              <button
                disabled={paused}
                onClick={() => onBuy({ type: 'addon', addon: a.id, quantity: a.qty ? a.qty[0] : 1 })}
                className="rounded-xl bg-gray-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-40"
              >
                {t('billing.add', { defaultValue: 'Add' })}
              </button>
            </div>
          </div>
        ))}
        {offered.length === 0 && (
          <p className="py-3 text-sm text-gray-500">
            {t('billing.no_addons', { defaultValue: 'Upgrade to add extra seats and more.' })}
          </p>
        )}
      </div>

      {overview.addons.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-bold text-gray-900">{t('billing.active_addons', { defaultValue: 'Active add-ons' })}</h3>
          <ul className="mt-2 space-y-2">
            {overview.addons.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                <span className="text-gray-700">
                  {a.quantity} × {t(`billing.addon.${a.addon}`, { defaultValue: ADDON_LABELS[a.addon] || a.addon })}
                  {a.ends_at && (
                    <span className="ms-2 text-xs text-gray-400">
                      {t('billing.ends_on', { defaultValue: 'ends {{date}}', date: fmtDate(a.ends_at) })}
                    </span>
                  )}
                </span>
                {!a.ends_at && (
                  <button onClick={() => onEnd(a.id)} className="text-xs font-semibold text-gray-500 hover:text-rose-600">
                    {t('billing.stop', { defaultValue: 'Stop' })}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-6 text-sm font-bold text-gray-900" id="packs">
        {t('billing.packs', { defaultValue: 'Packs (never expire)' })}
      </h3>
      <Hint>
        {t('billing.hint_packs', {
          defaultValue:
            'Pay once, no monthly charge. Packs never expire. They are only used after your monthly allowance runs out.',
        })}
      </Hint>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {Object.entries(catalog.catalog.packs || {}).flatMap(([kind, packs]) =>
          packs.map((pack) => (
            <button
              key={pack.id}
              disabled={paused}
              onClick={() => onBuy({ type: 'pack', pack_id: pack.id, quantity: 1 })}
              className="rounded-xl p-3 text-start ring-1 ring-black/[0.08] hover:ring-gray-900 disabled:opacity-40"
            >
              <p className="text-sm font-semibold text-gray-900">{(PACK_LABELS[kind] || String)(pack.quantity)}</p>
              <p className="text-xs text-gray-500">{formatKesCents(pack.price_cents)}</p>
              {overview.packs[kind] ? (
                <p className="mt-1 text-[11px] text-gray-400">
                  {t('billing.pack_balance', {
                    defaultValue: '{{n}} left',
                    n: kind === 'live_seconds' ? `${Math.round(overview.packs[kind] / 360) / 10} h` : overview.packs[kind].toLocaleString('en-KE'),
                  })}
                </p>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── Wallet + cards ───────────────────────────────────────────────────────────

function WalletAndCards({
  overview,
  orgId,
  token,
  onTopup,
  refresh,
}: {
  overview: Overview
  orgId: number
  token?: string
  onTopup: (_cents: number) => void
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('1000')
  const [showLedger, setShowLedger] = useState(false)
  const ledgerQ = useQuery({
    queryKey: ['billing', 'ledger', orgId],
    queryFn: () => billingApi.ledger(orgId, token),
    enabled: showLedger && !!token,
  })
  const kes = Math.floor(Number(amount) || 0)

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className={card} id="wallet">
        <h2 className={`${h2} flex items-center gap-2`}>
          <Wallet size={16} /> {t('billing.wallet', { defaultValue: 'Wallet' })}
        </h2>
        <p className="mt-2 text-2xl font-black tabular-nums text-gray-900">{formatKesCents(overview.wallet_balance_cents)}</p>
        <p className="mt-1 text-xs text-gray-500">
          {t('billing.wallet_note', {
            defaultValue: 'Monthly bills and packs come out of the wallet first. Top up with M-Pesa, card or bank.',
          })}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-500">KES</span>
          <input
            type="number"
            min={50}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32 rounded-lg border border-black/10 px-2 py-1.5 text-sm tabular-nums"
            aria-label={t('billing.topup_amount', { defaultValue: 'Top-up amount in KES' })}
          />
          <button
            disabled={kes < 50}
            onClick={() => onTopup(kes * 100)}
            className="rounded-xl bg-gray-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {t('billing.top_up', { defaultValue: 'Top up' })}
          </button>
        </div>
        {kes > 0 && kes < 50 && (
          <p className="mt-1 text-xs text-rose-600">{t('billing.min_topup', { defaultValue: 'The minimum top-up is KES 50.' })}</p>
        )}
        <button onClick={() => setShowLedger((s) => !s)} className="mt-4 text-xs font-semibold text-gray-600 underline underline-offset-2">
          {showLedger ? t('billing.hide_history', { defaultValue: 'Hide history' }) : t('billing.show_history', { defaultValue: 'Show history' })}
        </button>
        {showLedger && (
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
            {ledgerQ.isLoading && <li className="text-gray-400">…</li>}
            {(ledgerQ.data || []).map((row) => (
              <li key={row.id} className="flex justify-between gap-2 border-b border-black/[0.04] py-1">
                <span className="text-gray-500">
                  {fmtDate(row.created_at)} · {row.kind}
                </span>
                <span className={`tabular-nums ${row.amount_cents < 0 ? 'text-gray-700' : 'text-emerald-700'}`}>
                  {row.amount_cents > 0 ? '+' : ''}
                  {formatKesCents(row.amount_cents)}
                </span>
              </li>
            ))}
            {ledgerQ.data && ledgerQ.data.length === 0 && <li className="text-gray-400">{t('billing.no_history', { defaultValue: 'No wallet activity yet.' })}</li>}
          </ul>
        )}
      </div>

      <div className={card} id="cards">
        <h2 className={`${h2} flex items-center gap-2`}>
          <CreditCard size={16} /> {t('billing.cards', { defaultValue: 'Saved cards' })}
        </h2>
        {overview.cards.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            {t('billing.no_cards', {
              defaultValue: 'No saved card. Tick "save my card" when you pay by card to save one. M-Pesa can’t be saved.',
            })}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {overview.cards.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                <span className="font-semibold text-gray-800">
                  {(c.brand || 'Card').toUpperCase()} •••• {c.last4}
                  <span className="ms-2 text-xs font-normal text-gray-400">
                    {c.exp_month}/{c.exp_year}
                  </span>
                  {c.is_default && (
                    <span className="ms-2 rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-bold text-white">
                      {t('billing.default', { defaultValue: 'Default' })}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  {!c.is_default && (
                    <button
                      onClick={async () => {
                        try {
                          await billingApi.setDefaultCard(orgId, c.id, token)
                          refresh()
                        } catch (err) {
                          toast.error(billingErrorMessage(err))
                        }
                      }}
                      className="text-xs font-semibold text-gray-600 hover:text-gray-900"
                    >
                      {t('billing.make_default', { defaultValue: 'Make default' })}
                    </button>
                  )}
                  <button
                    aria-label={t('billing.remove_card', { defaultValue: 'Remove card' })}
                    onClick={async () => {
                      if (!window.confirm(t('billing.confirm_remove_card', { defaultValue: 'Remove this card? It will no longer be charged.' }))) return
                      try {
                        await billingApi.deleteCard(orgId, c.id, token)
                        refresh()
                      } catch (err) {
                        toast.error(billingErrorMessage(err))
                      }
                    }}
                    className="text-gray-400 hover:text-rose-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Invoices ─────────────────────────────────────────────────────────────────

function Invoices({
  invoices,
  loading,
  onPay,
}: {
  invoices: import('@services/billing/platform').Invoice[]
  loading: boolean
  onPay: (_id: number) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className={card} id="invoices">
      <h2 className={h2}>{t('billing.invoices', { defaultValue: 'Invoices' })}</h2>
      <Hint>
        {t('billing.hint_invoices', {
          defaultValue:
            'Your monthly bill is made on the 1st. We take it from your wallet first, then your saved card. If there is no money or card, we email you a link to pay. If it is still unpaid after 5 days, paid features pause until you pay. Nothing is deleted.',
        })}
      </Hint>
      {loading ? (
        <Loader2 size={16} className="mt-3 animate-spin text-gray-400" />
      ) : invoices.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{t('billing.no_invoices', { defaultValue: 'No invoices yet.' })}</p>
      ) : (
        <ul className="mt-3 divide-y divide-black/[0.05]">
          {invoices.map((inv) => (
            <li key={inv.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button onClick={() => setOpen(open === inv.id ? null : inv.id)} className="text-start">
                  <p className="text-sm font-semibold text-gray-900">{inv.number}</p>
                  <p className="text-xs text-gray-500">
                    {fmtDate(inv.created_at)} · {formatKesCents(inv.total_cents)}
                  </p>
                </button>
                {inv.status === 'open' || inv.status === 'failed' ? (
                  <button onClick={() => onPay(inv.id)} className="rounded-xl bg-gray-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-gray-800">
                    {t('billing.pay', { defaultValue: 'Pay' })}
                  </button>
                ) : (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                      inv.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {inv.status}
                    {inv.paid_via ? ` · ${inv.paid_via}` : ''}
                  </span>
                )}
              </div>
              {open === inv.id && (
                <ul className="mt-2 space-y-1 rounded-xl bg-gray-50 p-3 text-xs">
                  {inv.lines.map((line, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="text-gray-600">{line.description}</span>
                      <span className="tabular-nums text-gray-800">{formatKesCents(line.amount_cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────────

function Settings({
  overview,
  orgId,
  token,
  refresh,
}: {
  overview: Overview
  orgId: number
  token?: string
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState(overview.billing_email || '')
  const [limit, setLimit] = useState(overview.spending_limit_cents != null ? String(overview.spending_limit_cents / 100) : '')
  const [autoSeats, setAutoSeats] = useState(overview.auto_add_seats)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const trimmed = limit.trim()
      await billingApi.settings(
        orgId,
        {
          billing_email: email.trim(),
          auto_add_seats: autoSeats,
          ...(trimmed === ''
            ? { clear_spending_limit: true }
            : { spending_limit_cents: Math.max(0, Math.floor(Number(trimmed) || 0)) * 100 }),
        },
        token
      )
      toast.success(t('billing.settings_saved', { defaultValue: 'Billing settings saved.' }))
      refresh()
    } catch (err) {
      toast.error(billingErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={card} id="settings">
      <h2 className={h2}>{t('billing.settings', { defaultValue: 'Billing settings' })}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-semibold text-gray-700">{t('billing.billing_email', { defaultValue: 'Billing email' })}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="accounts@school.ac.ke"
            className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-gray-400">
            {t('billing.billing_email_hint', { defaultValue: 'Invoices and receipts go here. Empty = the org admins.' })}
          </span>
        </label>
        <label className="block text-sm">
          <span className="font-semibold text-gray-700">
            {t('billing.spending_limit', { defaultValue: 'Monthly spending limit (KES)' })}
          </span>
          <input
            type="number"
            min={0}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder={t('billing.no_limit', { defaultValue: 'No limit' })}
            className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm tabular-nums"
          />
          <span className="mt-1 block text-xs text-gray-400">
            {t('billing.spending_limit_hint', {
              defaultValue: 'Caps packs and add-ons bought this month ({{spent}} so far). Empty = no limit.',
              spent: formatKesCents(overview.spent_this_month_cents),
            })}
          </span>
        </label>
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={autoSeats} onChange={(e) => setAutoSeats(e.target.checked)} className="mt-1" />
        <span>
          <span className="font-semibold text-gray-700">{t('billing.auto_seats', { defaultValue: 'Add instructor seats automatically' })}</span>
          <span className="block text-xs text-gray-400">
            {t('billing.auto_seats_hint', {
              defaultValue: 'When all seats are in use, buy another on the default card (within the spending limit) instead of blocking.',
            })}
          </span>
        </span>
      </label>
      <button
        onClick={save}
        disabled={saving}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        {t('common.save', { defaultValue: 'Save' })}
      </button>
    </div>
  )
}
