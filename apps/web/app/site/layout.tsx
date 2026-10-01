import React from 'react'
import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { cookies } from 'next/headers'
import { siteOrigins } from '@lib/site/origin'
import SiteHeader from '@components/Site/SiteHeader'
import SiteFooter from '@components/Site/SiteFooter'
import './site.css'

// Public marketing site on the apex (validbridge.co.ke). The proxy rewrites
// `/`, `/pricing`, `/terms` and `/privacy` there to this route; it is not tied
// to an organization.
export const dynamic = 'force-dynamic'

// Archivo (variable weight, Latin subset) is self-hosted so builds never
// depend on reaching Google Fonts.
const archivo = localFont({
  src: './fonts/archivo-latin-wght.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-site',
})

const DESCRIPTION =
  'Courses, live classes, AI tools and payments together on your own branded site. ValidBridge is the learning platform for schools, training teams and course creators.'

export async function generateMetadata(): Promise<Metadata> {
  const { appOrigin } = await siteOrigins()
  return {
    metadataBase: new URL(appOrigin),
    title: {
      default: 'ValidBridge | Every course, brought to life.',
      template: '%s | ValidBridge',
    },
    description: DESCRIPTION,
    openGraph: {
      type: 'website',
      siteName: 'ValidBridge',
      title: 'ValidBridge | Every course, brought to life.',
      description: DESCRIPTION,
      images: [{ url: '/site-og-image.png', width: 1200, height: 630, alt: 'ValidBridge' }],
    },
    twitter: { card: 'summary_large_image', images: ['/site-og-image.png'] },
  }
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { helpOrigin } = await siteOrigins()
  // The non-httpOnly session marker: enough to pick header buttons. /home
  // re-verifies the session itself.
  const signedIn = !!(await cookies()).get('VB_session')?.value
  return (
    <div className={`vb-site ${archivo.variable}`}>
      <a
        href="#site-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[60] focus:bg-[var(--s-accent)] focus:rounded-full focus:px-4 focus:py-2 focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <SiteHeader helpOrigin={helpOrigin} signedIn={signedIn} />
      <div id="site-main">{children}</div>
      <SiteFooter helpOrigin={helpOrigin} />
    </div>
  )
}
