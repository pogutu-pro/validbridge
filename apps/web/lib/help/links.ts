import { getUriWithOrg } from '@services/config/config'
import type { HelpContext } from './types'

/** Help Center shown inside an organization (`/help` on the org's host). */
export function orgHelpContext(orgslug: string): HelpContext {
  return { orgslug, appOrigin: '' }
}

/** Standalone Help Center on help.{domain}; `appOrigin` is the main app, e.g. `https://validbridge.co.ke`. */
export function siteHelpContext(appOrigin: string): HelpContext {
  return { orgslug: null, appOrigin: appOrigin.replace(/\/+$/, '') }
}

/**
 * Link to a page of the app (dashboard, Live lessons, account…).
 *
 * Inside an organization it points at that organization. On the standalone
 * help site there is no organization, so it points at the main address, where
 * the visitor signs in and picks their organization.
 */
export function appHref(ctx: HelpContext, path: string): string {
  if (ctx.orgslug) return getUriWithOrg(ctx.orgslug, path)
  return `${ctx.appOrigin}/`
}

/** Link to a Help Center page; `to` is '', a category id, or `category/article`. */
export function helpHref(ctx: HelpContext, to = ''): string {
  const suffix = to ? `/${to}` : ''
  if (ctx.orgslug) return getUriWithOrg(ctx.orgslug, `/help${suffix}`)
  return suffix || '/'
}
