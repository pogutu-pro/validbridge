import { describe, expect, test } from 'bun:test'
import {
  helpHostFor,
  helpSiteOrigin,
  helpSiteRewritePath,
  isDocsHost,
  isHelpHost,
  orgHelpPathToSitePath,
  shouldRedirectToHelpSite,
} from '../lib/help/site.ts'
import {
  RESERVED_SUBDOMAINS,
  extractOrgSubdomain,
  isCustomDomain,
  resolveMultiTenant,
} from '../ee/services/tenancy/core.ts'

const DOMAIN = 'validbridge.co.ke'
const instance = {
  multi_org_enabled: true,
  default_org_slug: 'default',
  mode: 'ee',
  tenancy: 'multi',
  frontend_domain: DOMAIN,
  top_domain: DOMAIN,
}

describe('reserved subdomains', () => {
  test('help and docs are reserved alongside the platform hosts', () => {
    for (const sub of ['help', 'docs', 'auth', 'www', 'api', 'admin']) {
      expect(RESERVED_SUBDOMAINS.has(sub)).toBe(true)
      expect(extractOrgSubdomain(`${sub}.${DOMAIN}`, DOMAIN)).toBeNull()
    }
  })

  test('organization subdomains still resolve, including look-alikes', () => {
    expect(extractOrgSubdomain(`acme.${DOMAIN}`, DOMAIN)).toBe('acme')
    expect(extractOrgSubdomain(`helpdesk.${DOMAIN}`, DOMAIN)).toBe('helpdesk')
    expect(extractOrgSubdomain(`docs-team.${DOMAIN}:3000`, `${DOMAIN}:3000`)).toBe('docs-team')
  })

  test('the help host is never resolved as an organization', async () => {
    const resolved = await resolveMultiTenant({ host: `help.${DOMAIN}`, cookieOrgslug: null, instance })
    expect(resolved.source).not.toBe('subdomain')
    const org = await resolveMultiTenant({ host: `acme.${DOMAIN}`, cookieOrgslug: null, instance })
    expect(org).toEqual({ slug: 'acme', source: 'subdomain' })
  })

  test('custom domain detection is unchanged', () => {
    expect(isCustomDomain('learn.acme.com', DOMAIN)).toBe(true)
    expect(isCustomDomain(`help.${DOMAIN}`, DOMAIN)).toBe(false)
    expect(isCustomDomain(DOMAIN, DOMAIN)).toBe(false)
    expect(isCustomDomain('localhost:3000', DOMAIN)).toBe(false)
  })
})

describe('help host', () => {
  test('is detected with or without a port, and only exactly help.{domain}', () => {
    expect(isHelpHost(`help.${DOMAIN}`, DOMAIN)).toBe(true)
    expect(isHelpHost('HELP.validbridge.co.ke', DOMAIN)).toBe(true)
    expect(isHelpHost('help.localhost:3000', 'localhost:3000')).toBe(true)
    expect(isHelpHost(`acme.${DOMAIN}`, DOMAIN)).toBe(false)
    expect(isHelpHost(`x.help.${DOMAIN}`, DOMAIN)).toBe(false)
    expect(isHelpHost(DOMAIN, DOMAIN)).toBe(false)
    expect(isHelpHost('help.acme.com', DOMAIN)).toBe(false)
    expect(isHelpHost(null, DOMAIN)).toBe(false)
  })

  test('builds the origin from the configured domain, keeping the port', () => {
    expect(helpHostFor('localhost:3000')).toBe('help.localhost:3000')
    expect(helpSiteOrigin('https://', DOMAIN)).toBe('https://help.validbridge.co.ke')
  })

  test('rewrites every help-host path under the internal route, idempotently', () => {
    expect(helpSiteRewritePath('/')).toBe('/help-center')
    expect(helpSiteRewritePath('/payments/create-offer')).toBe('/help-center/payments/create-offer')
    expect(helpSiteRewritePath('/help-center/courses')).toBe('/help-center/courses')
  })
})

describe('org /help redirect', () => {
  test('maps org help paths to help-site paths', () => {
    expect(orgHelpPathToSitePath('/help')).toBe('/')
    expect(orgHelpPathToSitePath('/help/')).toBe('/')
    expect(orgHelpPathToSitePath('/help/livebridge')).toBe('/livebridge')
    expect(orgHelpPathToSitePath('/help/payments/create-offer')).toBe('/payments/create-offer')
    expect(orgHelpPathToSitePath('/helpful')).toBeNull()
    expect(orgHelpPathToSitePath('/course/help')).toBeNull()
    expect(orgHelpPathToSitePath('/')).toBeNull()
  })

  test('redirects only on the platform domain in multi tenancy', () => {
    const base = { tenancy: 'multi', isCustomDomain: false }
    expect(shouldRedirectToHelpSite({ ...base, host: `acme.${DOMAIN}` })).toBe(true)
    expect(shouldRedirectToHelpSite({ ...base, host: DOMAIN })).toBe(true)
    // Fallbacks: keep the in-org pages.
    expect(shouldRedirectToHelpSite({ ...base, host: 'learn.acme.com', isCustomDomain: true })).toBe(false)
    expect(shouldRedirectToHelpSite({ ...base, host: 'localhost:3000' })).toBe(false)
    expect(shouldRedirectToHelpSite({ ...base, tenancy: 'single', host: 'lms.school.ac.ke' })).toBe(false)
    expect(shouldRedirectToHelpSite({ ...base, host: null })).toBe(false)
  })
})

describe('retired docs host', () => {
  test('docs.{domain} is detected so it can redirect to the Help Center', () => {
    expect(isDocsHost(`docs.${DOMAIN}`, DOMAIN)).toBe(true)
    expect(isDocsHost('DOCS.validbridge.co.ke', DOMAIN)).toBe(true)
    expect(isDocsHost(`help.${DOMAIN}`, DOMAIN)).toBe(false)
    expect(isDocsHost(`docs-team.${DOMAIN}`, DOMAIN)).toBe(false)
    expect(isDocsHost(DOMAIN, DOMAIN)).toBe(false)
  })
})
