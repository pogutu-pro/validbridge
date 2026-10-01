import { dashboardPages } from '@/lib/dashboard-search/registry'

export interface NavigationLink {
  href: string
  label: string
}

/**
 * Validate a path the model proposed as a navigation target (e.g. inside a
 * backtick-wrapped code span, "Branding (`/dash/org/settings/branding`)").
 *
 * The path is untrusted input and is matched against the SearchMeta registry
 * before it can render as a link -- only an exact match is returned, no
 * fuzzy or partial matching, so a hallucinated or injected path is never
 * turned into a clickable link. The registry is the single source of truth
 * for valid destinations.
 */
export function matchDashboardPage(href: string): NavigationLink | null {
  const meta = dashboardPages.find((m) => m.href === href)
  return meta ? { href, label: meta.titleKey } : null
}
