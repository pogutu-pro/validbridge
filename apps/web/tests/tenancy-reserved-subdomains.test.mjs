import { describe, expect, test } from 'bun:test'
import {
  extractOrgSubdomain,
  isReservedSubdomain,
  resolveMultiTenant,
} from '../ee/services/tenancy/core.ts'

const instance = {
  multi_org_enabled: true,
  default_org_slug: 'default',
  mode: 'saas',
  tenancy: 'multi',
  frontend_domain: 'validbridge.co.ke',
  top_domain: 'validbridge.co.ke',
}

describe('reserved platform subdomains', () => {
  test('a normal subdomain is an org slug', () => {
    expect(extractOrgSubdomain('acme.validbridge.co.ke', 'validbridge.co.ke')).toBe('acme')
    expect(isReservedSubdomain('acme.validbridge.co.ke', 'validbridge.co.ke')).toBe(false)
  })

  test('the docs subdomain is never an org slug', () => {
    expect(extractOrgSubdomain('docs.validbridge.co.ke', 'validbridge.co.ke')).toBe(null)
    expect(isReservedSubdomain('docs.validbridge.co.ke', 'validbridge.co.ke')).toBe(true)
  })

  test('other platform service subdomains are reserved too', () => {
    for (const sub of ['auth', 'www', 'api', 'admin', 'university', 'classroom', 'partners']) {
      expect(extractOrgSubdomain(`${sub}.validbridge.co.ke`, 'validbridge.co.ke')).toBe(null)
    }
  })

  test('the bare apex and foreign hosts are not reserved subdomains', () => {
    expect(isReservedSubdomain('validbridge.co.ke', 'validbridge.co.ke')).toBe(false)
    expect(isReservedSubdomain('learn.acme.org', 'validbridge.co.ke')).toBe(false)
  })
})

describe('resolveMultiTenant on a reserved host', () => {
  test('does not resurrect the org "docs" from a stale VB_org cookie', async () => {
    const resolved = await resolveMultiTenant({
      host: 'docs.validbridge.co.ke',
      cookieOrgslug: 'docs',
      instance,
    })
    expect(resolved).toEqual({ slug: 'default', source: 'default' })
  })

  test('still honours a normal org subdomain over the cookie', async () => {
    const resolved = await resolveMultiTenant({
      host: 'acme.validbridge.co.ke',
      cookieOrgslug: 'other',
      instance,
    })
    expect(resolved).toEqual({ slug: 'acme', source: 'subdomain' })
  })
})
