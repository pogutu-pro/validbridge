import { NextResponse } from 'next/server'
import { siteOrigins } from '@lib/site/origin'
import { LEGAL_DOCS } from '@lib/site/legal'

// Sitemap for the marketing site on the apex. The proxy rewrites the apex's
// /sitemap.xml here; org hosts keep their own (app/api/sitemap).
export const dynamic = 'force-dynamic'

export async function GET() {
  const { appOrigin } = await siteOrigins()
  const pages: { path: string; priority: number; changefreq: string; lastmod?: string }[] = [
    { path: '/', priority: 1.0, changefreq: 'weekly' },
    { path: '/pricing', priority: 0.9, changefreq: 'monthly' },
    { path: '/terms', priority: 0.4, changefreq: 'yearly', lastmod: LEGAL_DOCS.terms.updated },
    { path: '/privacy', priority: 0.4, changefreq: 'yearly', lastmod: LEGAL_DOCS.privacy.updated },
  ]
  const urls = pages
    .map(
      (p) =>
        `  <url>\n    <loc>${appOrigin}${p.path}</loc>\n${p.lastmod ? `    <lastmod>${p.lastmod}</lastmod>\n` : ''}    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
