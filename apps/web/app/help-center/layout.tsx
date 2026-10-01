import React from 'react'
import type { Metadata } from 'next'
import HelpSiteHeader from '@components/Help/HelpSiteHeader'
import { getSiteHelpContext } from './context'

// Standalone Help Center served on help.{domain}. The proxy rewrites that host
// here; it is not tied to an organization.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: {
    default: 'ValidBridge Help Center',
    template: '%s | ValidBridge Help Center',
  },
  description:
    'Guides and answers for ValidBridge — courses, LiveBridge live classes, assessments, payments, analytics and more. ValidBridge is a product of Stratnovo Systems.',
}

export default async function HelpSiteLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSiteHelpContext()
  return (
    <div className="min-h-screen bg-background text-foreground">
      <HelpSiteHeader appOrigin={ctx.appOrigin} />
      {children}
    </div>
  )
}
