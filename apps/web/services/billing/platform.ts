// Client for the platform billing API (apps/api/src/routers/billing.py): a
// school paying ValidBridge for its plan, add-ons, packs and invoices.
//
// Every amount is integer KES cents and is computed by the server. The UI
// never prices anything itself: it asks for a quote and shows what comes back.

import { getAPIUrl } from '@services/config/config'
import { errorHandling } from '@services/utils/ts/requests'

export type Cycle = 'monthly' | 'yearly'

export type BillingItem =
  | { type: 'plan'; plan: string; cycle: Cycle }
  | { type: 'pack'; pack_id: string; quantity?: number }
  | { type: 'addon'; addon: string; quantity?: number }
  | { type: 'wallet_topup'; amount_cents: number }
  | { type: 'invoice'; invoice_id: number }

export interface Meter {
  used: number
  limit: number | null
}

export interface Card {
  id: number
  brand: string | null
  last4: string | null
  exp_month: number | null
  exp_year: number | null
  bank: string | null
  is_default: boolean
}

export interface InvoiceLine {
  code: string
  description: string
  amount_cents: number
  quantity?: number
}

export interface Invoice {
  id: number
  number: string
  period: string
  lines: InvoiceLine[]
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  status: 'draft' | 'open' | 'paid' | 'void' | 'failed'
  paid_via: string | null
  created_at: string | null
}

export interface HeldAddon {
  id: number
  addon: string
  quantity: number
  started_at: string | null
  ends_at: string | null
}

export interface Overview {
  enabled: boolean
  public_key: string | null
  plan: string
  effective_plan: string
  cycle: Cycle
  period_start: string | null
  period_end: string | null
  pending_plan: string | null
  pending_cycle: Cycle | null
  status: 'active' | 'past_due' | 'paused'
  exempt: boolean
  wallet_balance_cents: number
  spent_this_month_cents: number
  spending_limit_cents: number | null
  auto_add_seats: boolean
  billing_email: string | null
  meters: Record<string, Meter>
  features: Record<string, boolean>
  packs: Record<string, number>
  live_concurrency: number | null
  addons: HeldAddon[]
  cards: Card[]
  open_invoices: Invoice[]
}

export interface CatalogPlan {
  label: string
  price_cents: number | null
  self_serve: boolean
  requires_verification: boolean
  included_seats: number | null
  extra_seat_price_cents: number | null
  learner_allowance: number | null
  storage_bytes: number | null
  live_seconds: number | null
  premium_ai_credits: number | null
  code_runs: number | null
  support: string
}

export interface CatalogPack {
  id: string
  quantity: number
  price_cents: number
}

export interface Catalog {
  enabled: boolean
  public_key: string | null
  version: number
  catalog: {
    currency: string
    plan_order: string[]
    plans: Record<string, CatalogPlan>
    packs: Record<string, CatalogPack[]>
    addons: Record<string, any>
    yearly_discount_percent: number
    learners_per_seat: number
  }
}

/** One part of what a payment buys. ``end`` is exclusive (00:00 UTC on the
 * day after the last covered day). Parts sum to the quote amount. */
export interface QuoteLine {
  label: string
  amount_cents: number
  start: string | null
  end: string | null
}

export interface Quote {
  item: BillingItem
  amount_cents: number
  description: string
  period_start: string | null
  covers_until: string | null
  lines: QuoteLine[]
  next_charge_at: string | null
  next_charge_cents: number | null
  /** Plain-language explanation from the server, e.g. why next month is included. */
  note?: string | null
}

export interface CheckoutResult {
  status: 'pending' | 'paid' | 'failed'
  reference: string
  amount_cents: number
  authorization_url?: string | null
  replayed?: boolean
}

export interface PurchaseResult {
  status: 'paid' | 'pending' | 'failed' | 'action_required'
  reference?: string
  amount_cents?: number
  message?: string
}

export interface LedgerRow {
  id: number
  amount_cents: number
  kind: 'topup' | 'charge' | 'grant' | 'refund' | 'adjustment'
  ref_type: string | null
  ref_id: string | null
  balance_after_cents: number
  created_at: string | null
}

async function request<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${getAPIUrl()}billing/${path}`, {
    method,
    headers,
    credentials: 'include',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return errorHandling(res) as Promise<T>
}

export const billingApi = {
  catalog: (token?: string) => request<Catalog>('GET', 'catalog', token),
  overview: (orgId: number, token?: string) => request<Overview>('GET', `${orgId}/overview`, token),
  quote: (orgId: number, item: BillingItem, token?: string) =>
    request<Quote>('POST', `${orgId}/quote`, token, { item }),
  checkout: (
    orgId: number,
    body: { item: BillingItem; return_url: string; save_card: boolean; idempotency_key: string },
    token?: string
  ) => request<CheckoutResult>('POST', `${orgId}/checkout`, token, body),
  purchase: (
    orgId: number,
    body: { item: BillingItem; pay_with: 'wallet' | 'card'; payment_method_id?: number; idempotency_key: string },
    token?: string
  ) => request<PurchaseResult>('POST', `${orgId}/purchase`, token, body),
  verify: (orgId: number, reference: string, token?: string) =>
    request<{ status: string; reference: string }>('POST', `${orgId}/verify/${encodeURIComponent(reference)}`, token),
  schedulePlan: (orgId: number, plan: string, cycle: Cycle, token?: string) =>
    request<{ status: 'changed' | 'scheduled'; plan: string; cycle: Cycle; effective_at?: string }>(
      'POST',
      `${orgId}/plan/schedule`,
      token,
      { plan, cycle }
    ),
  cancelSchedule: (orgId: number, token?: string) => request('DELETE', `${orgId}/plan/schedule`, token),
  endAddon: (orgId: number, addonId: number, token?: string) =>
    request<{ status: string; ends_at: string }>('DELETE', `${orgId}/addons/${addonId}`, token),
  setDefaultCard: (orgId: number, cardId: number, token?: string) =>
    request('PUT', `${orgId}/cards/${cardId}/default`, token),
  deleteCard: (orgId: number, cardId: number, token?: string) =>
    request('DELETE', `${orgId}/cards/${cardId}`, token),
  invoices: (orgId: number, token?: string) => request<Invoice[]>('GET', `${orgId}/invoices`, token),
  ledger: (orgId: number, token?: string) => request<LedgerRow[]>('GET', `${orgId}/ledger`, token),
  settings: (
    orgId: number,
    body: {
      spending_limit_cents?: number | null
      clear_spending_limit?: boolean
      auto_add_seats?: boolean
      billing_email?: string
    },
    token?: string
  ) => request('PUT', `${orgId}/settings`, token, body),
}

/** A fresh idempotency key per user action (one click = one key). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** `KES 3,500` / `KES 1,234.50` from integer cents. */
export function formatKesCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const whole = cents % 100 === 0
  return `KES ${(cents / 100).toLocaleString('en-KE', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

/** Error body message from a thrown billing request (see errorHandling). */
export function billingErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  const detail = (err as any)?.detail
  if (typeof detail === 'string' && detail) return detail
  if (detail && typeof detail.message === 'string') return detail.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}
