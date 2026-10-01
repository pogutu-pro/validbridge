import { NextResponse } from 'next/server'
import { siteOrigins } from '@lib/site/origin'
import { COMPANY, SUPPORT_EMAIL } from '@lib/help/brand'
import { LEGAL_DOCS } from '@lib/site/legal'
import {
  AI_CREDIT_PACKS,
  LIVE_HOUR_PACKS,
  LIVE_UNLIMITED,
  MANAGED_EMAIL,
  PLANS,
  REMOVE_BADGE_CENTS,
  SSO_ADDON_CENTS,
  STORAGE_GB_CENTS,
  YEARLY_DISCOUNT,
  formatKes,
  formatUsdApprox,
  planHighlights,
} from '@lib/site/pricing'

// /llms.txt (https://llmstxt.org): a plain summary of ValidBridge with links to
// the pages worth reading, so LLMs can describe the product accurately.
export const dynamic = 'force-dynamic'

function pricingSection(): string {
  const plans = PLANS.map((p) => {
    const price =
      p.priceCents === null
        ? 'custom price'
        : p.priceCents === 0
          ? p.requiresApproval
            ? 'free for verified public institutions'
            : 'free'
          : `${formatKes(p.priceCents)} a month (${formatUsdApprox(p.priceCents)})`
    return `- ${p.name}: ${price}. ${planHighlights(p).join('; ')}.`
  }).join('\n')
  const packs = (list: { size: number; priceCents: number }[], unit: string) =>
    list.map((x) => `${x.size.toLocaleString('en-US')} ${unit} = ${formatKes(x.priceCents)}`).join(', ')
  return `## Pricing

Prices are in Kenyan shillings (KES), paid through Paystack by card, M-Pesa or bank transfer; US dollar amounts are approximate. Paying yearly takes ${Math.round(YEARLY_DISCOUNT * 100)}% off the plan and instructor seats.

${plans}

Free on every plan: unlimited courses, assessments, certificates, advanced analytics, communities, roles and 2FA, content versioning, course sales with 0% platform fee, AI on ValidBridge's own model (fair use) and essential email. Single sign-on (SSO) is available on Enterprise only.

Pay for what you use, above the plan's allowance:
- Storage: ${formatKes(STORAGE_GB_CENTS)} per GB a month
- Premium AI credits (one-time packs, never expire): ${packs(AI_CREDIT_PACKS, 'credits')}
- Live class hours (one-time packs, never expire): ${packs(LIVE_HOUR_PACKS, 'hours')}; or LiveBridge Unlimited at ${formatKes(LIVE_UNLIMITED.perInstructorCents)} per instructor a month (fair use about ${LIVE_UNLIMITED.fairUseHours} hours each)
- Managed email: ${formatKes(MANAGED_EMAIL.monthlyCents)} a month for ${MANAGED_EMAIL.includedEmails.toLocaleString('en-US')} emails (free with your own email key; included in Business)
- Remove the "Powered by ValidBridge" badge on Growth: ${formatKes(REMOVE_BADGE_CENTS)} a month
- Single sign-on (SSO), optional on any paid plan: ${formatKes(SSO_ADDON_CENTS)} a month

Public Education is free for verified public schools, TVETs, public universities and government training centres in Kenya; approval renews yearly.
`
}

export async function GET() {
  const { appOrigin, helpOrigin } = await siteOrigins()
  const body = `# ValidBridge

> ValidBridge is a learning platform for schools, colleges, training teams and course creators, built in Kenya by ${COMPANY.name}. It brings courses, live classes, assessments, AI tools and payments together on an organization's own branded site.

- Each organization gets its own site, such as school.validbridge.co.ke, with its logo, colours and font.
- Courses are built in a block editor: text, video, PDF, quizzes, code exercises, math, flip cards, scenarios and H5P embeds, with real-time co-editing.
- LiveBridge live classes run in the browser inside a course: camera, microphone and screen sharing, chat, Q&A, polls, live quizzes, recordings added back to the course, and per-student attendance (present, late, left early, partial, absent).
- Assessments: six assignment task types, auto-graded code exercises in 30 languages, and certificates with QR verification.
- Payments: organizations sell courses with their own Paystack account; learners pay by card, bank or M-Pesa, and ValidBridge takes no platform fee on course sales. Prices default to KES.
- AI tools draft lessons and quizzes, generate images and narrated audio, and caption and translate videos (including into Swahili).
- Administration: roles and permissions, user groups, invite-only sign-up, two-factor authentication, analytics, an API and signed webhooks, and Zapier.

${pricingSection()}
## Pages

- [ValidBridge home](${appOrigin}/): overview of the platform
- [Pricing](${appOrigin}/pricing): plans, usage prices and a cost calculator
- [Help Center](${helpOrigin}/): how-to guides for administrators, instructors and learners

## Legal

- [Terms of Service](${appOrigin}/terms.md): ${LEGAL_DOCS.terms.description}
- [Privacy Policy](${appOrigin}/privacy.md): ${LEGAL_DOCS.privacy.description}

## Contact

- Support: ${SUPPORT_EMAIL}
- Company: [${COMPANY.name}](${COMPANY.url})
`
  return new NextResponse(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
