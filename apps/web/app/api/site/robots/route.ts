import { NextResponse } from 'next/server'
import { siteOrigins } from '@lib/site/origin'

// robots.txt for the apex. Marketing and legal pages are open to every
// crawler, including AI crawlers; the signed-in hub and internals are not.
export const dynamic = 'force-dynamic'

export async function GET() {
  const { appOrigin } = await siteOrigins()
  const body = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /auth/
Disallow: /admin/
Disallow: /home
Disallow: /account
Disallow: /billing
Disallow: /new
Disallow: /organizations
Disallow: /subscriptions

# Plain-text summary of ValidBridge for LLMs: ${appOrigin}/llms.txt
Sitemap: ${appOrigin}/sitemap.xml
`
  return new NextResponse(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
