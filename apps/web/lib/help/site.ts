// Routing rules for the standalone Help Center (help.{domain}).
//
// Pure functions with no Next.js imports so the proxy (Edge runtime), server
// components and unit tests can all share them.

import { extractSubdomain, isLocalhost } from '@services/utils/ts/hostUtils'

export const HELP_SUBDOMAIN = 'help'

/** Retired: the old public docs site. Everything customer-facing lives in Help. */
export const DOCS_SUBDOMAIN = 'docs'

/** Internal route the help host is rewritten to (app/help-center). */
export const HELP_SITE_ROUTE = '/help-center'

/** Host of the help site for a frontend domain, keeping any port: `help.validbridge.co.ke`. */
export function helpHostFor(frontendDomain: string): string {
  return `${HELP_SUBDOMAIN}.${frontendDomain}`
}

/** Origin of the help site, e.g. `https://help.validbridge.co.ke`. `protocol` is `https://` or `http://`. */
export function helpSiteOrigin(protocol: string, frontendDomain: string): string {
  return `${protocol}${helpHostFor(frontendDomain)}`
}

/** Is this request for the help site? Only meaningful in multi tenancy. */
export function isHelpHost(host: string | null | undefined, frontendDomain: string): boolean {
  return extractSubdomain(host, frontendDomain) === HELP_SUBDOMAIN
}

/** Is this request for the retired docs host? Redirected to the Help Center. */
export function isDocsHost(host: string | null | undefined, frontendDomain: string): boolean {
  return extractSubdomain(host, frontendDomain) === DOCS_SUBDOMAIN
}

/**
 * Internal path for a request on the help host. Idempotent, so a path that is
 * already under the internal route is not prefixed twice.
 */
export function helpSiteRewritePath(pathname: string): string {
  if (pathname === HELP_SITE_ROUTE || pathname.startsWith(`${HELP_SITE_ROUTE}/`)) return pathname
  return pathname === '/' ? HELP_SITE_ROUTE : `${HELP_SITE_ROUTE}${pathname}`
}

/**
 * Map an organization's `/help…` path to the matching help-site path:
 * `/help` → `/`, `/help/payments/create-offer` → `/payments/create-offer`.
 * Returns null for anything that is not a Help Center path.
 */
export function orgHelpPathToSitePath(pathname: string): string | null {
  if (pathname === '/help' || pathname === '/help/') return '/'
  if (pathname.startsWith('/help/')) return pathname.slice('/help'.length).replace(/\/+$/, '') || '/'
  return null
}

/**
 * Should an organization's `/help` pages redirect to the help site?
 *
 * Only in multi tenancy on the platform's own domain (apex or an org
 * subdomain), where `help.{domain}` is served by the wildcard DNS entry.
 * Everywhere else the in-org pages stay:
 * - single tenancy: there is no help subdomain;
 * - plain localhost: `help.localhost` is not set up in most dev setups;
 * - custom domains (`learn.acme.com`): the help host may not exist for them,
 *   and leaving the customer's domain for ours would be surprising.
 */
export function shouldRedirectToHelpSite(args: {
  tenancy: 'multi' | 'single'
  host: string | null | undefined
  isCustomDomain: boolean
}): boolean {
  if (args.tenancy !== 'multi') return false
  if (!args.host || isLocalhost(args.host)) return false
  return !args.isCustomDomain
}
