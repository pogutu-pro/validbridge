import 'server-only'
import { headers } from 'next/headers'
import { getVALIDBRIDGE_DOMAIN_VAL, getVALIDBRIDGE_HTTP_PROTOCOL_VAL } from '@services/config/config'
import { siteHelpContext } from '@lib/help/links'
import type { HelpContext } from '@lib/help/types'

/**
 * Context for the standalone help site. The proxy forwards the frontend
 * domain (from the backend's instance info) as `x-vb-frontend-domain`; the
 * configured domain is the fallback. Links into the app go to that apex.
 */
export async function getSiteHelpContext(): Promise<HelpContext> {
  const h = await headers()
  const domain = h.get('x-vb-frontend-domain') || getVALIDBRIDGE_DOMAIN_VAL()
  return siteHelpContext(`${getVALIDBRIDGE_HTTP_PROTOCOL_VAL()}${domain}`)
}
