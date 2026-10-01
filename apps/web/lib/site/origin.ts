import 'server-only'
import { headers } from 'next/headers'
import { getVALIDBRIDGE_DOMAIN_VAL, getVALIDBRIDGE_HTTP_PROTOCOL_VAL } from '@services/config/config'
import { helpSiteOrigin } from '@lib/help/site'

/**
 * Origins for the marketing site. The proxy forwards the frontend domain (from
 * the backend's instance info) as `x-vb-frontend-domain`; the configured
 * domain is the fallback. `appOrigin` is the apex the site is served on.
 */
export async function siteOrigins(): Promise<{ appOrigin: string; helpOrigin: string }> {
  const h = await headers()
  const domain = h.get('x-vb-frontend-domain') || getVALIDBRIDGE_DOMAIN_VAL()
  const protocol = getVALIDBRIDGE_HTTP_PROTOCOL_VAL()
  return { appOrigin: `${protocol}${domain}`, helpOrigin: helpSiteOrigin(protocol, domain) }
}
