// Routing rules for the public marketing site (landing, pricing, legal pages)
// served on the apex domain (validbridge.co.ke).
//
// Pure functions with no Next.js imports so the proxy (Edge runtime), server
// components and unit tests can all share them.

/** Internal route the marketing pages live under (app/site). */
export const SITE_ROUTE = '/site'

/** Public apex paths served by the marketing site, mapped to their internal route. */
const SITE_PATHS: Record<string, string> = {
  '/': SITE_ROUTE,
  '/pricing': `${SITE_ROUTE}/pricing`,
  '/terms': `${SITE_ROUTE}/terms`,
  '/privacy': `${SITE_ROUTE}/privacy`,
}

/**
 * Internal path for a marketing page on the apex, or null when the path is not
 * a marketing page. A trailing slash is ignored: `/pricing/` → `/site/pricing`.
 */
export function siteRewritePath(pathname: string): string | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname
  return SITE_PATHS[normalized] ?? null
}

/**
 * Crawler- and LLM-facing files served by the marketing site on the apex,
 * mapped to their route handlers under app/api/site. On org hosts these paths
 * keep their per-organization handlers (sitemap, robots) or do not exist.
 */
const SITE_FILES: Record<string, string> = {
  '/sitemap.xml': '/api/site/sitemap',
  '/robots.txt': '/api/site/robots',
  '/llms.txt': '/api/site/llms',
  '/terms.md': '/api/site/legal/terms',
  '/privacy.md': '/api/site/legal/privacy',
}

/** Route handler for a marketing-site file on the apex, or null. */
export function siteFileRewritePath(pathname: string): string | null {
  return SITE_FILES[pathname] ?? null
}
