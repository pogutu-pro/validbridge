// Copy and links for the public marketing site (app/site). Content follows the
// design handoff (ValidBridge Landing / Pricing); keep claims here in step with
// what the product actually ships.

import { SUPPORT_EMAIL } from '@lib/help/brand'

/** Sales / demo inbox. */
export const SALES_EMAIL = 'hello@validbridge.co.ke'

export const DEMO_MAILTO = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent('ValidBridge demo request')}`

/**
 * Links between marketing pages and into the app. The site is served on the
 * apex, so app routes (/login, /signup) are plain same-origin paths.
 */
export const SITE_LINKS = {
  home: '/',
  features: '/#features',
  livebridge: '/#livebridge',
  faq: '/#faq',
  contact: '/#contact',
  pricing: '/pricing',
  terms: '/terms',
  privacy: '/privacy',
  login: '/login',
  /** Signed-in hub: the org picker. */
  app: '/home',
  signup: '/signup',
  demo: DEMO_MAILTO,
  support: `mailto:${SUPPORT_EMAIL}`,
} as const

/** Plan card call-to-action for each kind of plan in lib/site/pricing.ts. */
export const PLAN_CTA = {
  apply: { label: 'Apply for free access', href: SITE_LINKS.signup, note: 'Verified public institutions · approval required' },
  signup: { label: 'Start free', href: SITE_LINKS.signup, note: null },
  contact: { label: 'Talk to us', href: SITE_LINKS.demo, note: null },
} as const

export interface PlanCta {
  label: string
  href: string
  note: string | null
}

/**
 * The call-to-action for one plan card. A paid plan must not share the free
 * "Start free" button: that sent visitors who chose Growth or Business to the
 * same signup as Starter and quietly gave them a free Starter school. Paid
 * plans carry the choice (`?plan=`) through signup to the billing page, where
 * it is paid for — nothing is activated before payment.
 */
export function planCta(
  plan: { id: string; name: string; priceCents: number | null; cta: keyof typeof PLAN_CTA },
  billing: 'monthly' | 'yearly' = 'monthly'
): PlanCta {
  if (plan.cta === 'signup' && plan.priceCents) {
    const q = new URLSearchParams({ plan: plan.id, cycle: billing })
    return {
      label: `Choose ${plan.name}`,
      href: `${SITE_LINKS.signup}?${q.toString()}`,
      note: 'Create your school, then pay by card, M-Pesa or bank',
    }
  }
  return PLAN_CTA[plan.cta]
}

export interface FaqItem {
  q: string
  a: string
}

export const FAQ: FaqItem[] = [
  { q: 'Do my learners need to install anything?', a: 'No, it runs in the browser, including live classes.' },
  {
    q: 'Can I use my own Paystack account? Does ValidBridge take a cut?',
    a: "Yes, and there's no cut, 0% platform fee on your course sales.",
  },
  { q: 'Can learners pay with M-Pesa?', a: 'Yes, alongside card and bank payments.' },
  { q: "Can I brand it with my school's logo and colours?", a: 'Yes, logo, colours, font and your own subdomain.' },
  {
    q: 'Is there a free plan?',
    a: 'Yes. Starter is free with no card needed. Verified public schools, colleges and universities get Public Education free, with more room for instructors and live classes.',
  },
  {
    q: 'How do recordings and attendance work?',
    a: 'Recordings are added back to the course automatically; attendance is tracked per student.',
  },
  { q: 'Where do I get help?', a: `help.validbridge.co.ke and ${SUPPORT_EMAIL}.` },
]

/** Questions on the pricing page. */
export const PRICING_FAQ: FaqItem[] = [
  {
    q: 'How do I pay? Can I use M-Pesa?',
    a: 'Prices are in Kenyan shillings and paid through Paystack by card, M-Pesa or bank transfer. You can also top up a prepaid wallet: monthly bills and packs come out of the wallet first, then your saved card.',
  },
  {
    q: 'Do you store my card?',
    a: 'Only if you choose to save it. Your card is saved securely by Paystack; we keep only a token plus the card brand, last 4 digits and expiry, never the card number. M-Pesa can’t be saved, so M-Pesa payers top up the wallet or pay each bill with a prompt.',
  },
  {
    q: 'What happens when we reach a limit?',
    a: 'We warn admins at 80% and 100%. At the limit, new usage of that kind pauses until you buy a pack, add a seat or upgrade. Nothing is ever deleted, and a live class in progress is never cut off. You can also set a monthly spending limit.',
  },
  {
    q: 'Do packs expire?',
    a: 'No. Premium AI credits, live class hours and code run packs are one-time purchases that never expire. Your plan’s monthly allowance is used first and resets on the 1st.',
  },
  {
    q: 'Who can get Public Education for free?',
    a: 'Public primary and secondary schools, TVETs, public universities and government training centres in Kenya. Apply with an official email address (such as .ac.ke, .sc.ke, .go.ke or .ed.ke) and a registration document or TSC, KUCCPS or TVETA number. We check every application, and access renews yearly. In return we may list your institution as a customer, and the ValidBridge badge stays on your site. Private institutions can use Starter or Growth.',
  },
  {
    q: 'Is there a discount for paying yearly?',
    a: 'Yes. Pay for 12 months upfront and get 15% off the plan price and instructor seats.',
  },
  {
    q: 'Do you take a cut of course sales?',
    a: 'No, 0%. You sell with your own Paystack account and the money goes straight to you. Paystack charges its usual fees.',
  },
  {
    q: 'Can I change plans or cancel?',
    a: 'Yes, any time from your billing settings. If you cancel, your plan runs to the end of the period you’ve paid for.',
  },
]
