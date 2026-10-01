/*
 * ============================================================================
 *  PRESENTATION MOCKUP — Not a real feature
 * ============================================================================
 *  This page renders a **static, hardcoded visual demo** of what the
 *  planned ValidBridge mobile app *will* look like. It exists solely so
 *  the team has something real to show in stakeholder meetings while the
 *  actual React Native app is still in planning.
 *
 *  Key constraints honoured:
 *    • No React Native / Expo / native modules — pure web UI.
 *    • No API calls, no live data, no real backend integration.
 *    • No new dependencies — uses only the existing Next.js / Tailwind /
 *      shadcn-style component library already shipped in this web app.
 *    • Not linked in any production navigation or layout.
 *    • SEO-deindexed so it never appears in search results.
 *
 *  If you find this page linked in a nav menu or used in production
 *  flows, it has been mistakenly promoted and should be removed.
 * ============================================================================
 */

import type { Metadata } from 'next'
import MobileShowcase from './mobile-showcase'

export const metadata: Metadata = {
  title: 'Mobile UX Preview',
  robots: { index: false, follow: false },
  description:
    'Static UX preview of the planned ValidBridge mobile experience. Not a real feature.',
}

export default function MobileShowcasePage() {
  return <MobileShowcase />
}
