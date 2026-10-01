import { describe, expect, test } from 'bun:test'
import { SITE_ROUTE, siteFileRewritePath, siteRewritePath } from '../lib/site/routes.ts'

describe('marketing site paths', () => {
  test('map the public apex paths to app/site', () => {
    expect(siteRewritePath('/')).toBe(SITE_ROUTE)
    expect(siteRewritePath('/pricing')).toBe('/site/pricing')
    expect(siteRewritePath('/terms')).toBe('/site/terms')
    expect(siteRewritePath('/privacy')).toBe('/site/privacy')
  })

  test('ignore a trailing slash', () => {
    expect(siteRewritePath('/pricing/')).toBe('/site/pricing')
    expect(siteRewritePath('//')).toBe(SITE_ROUTE)
  })

  test('leave app and org paths alone', () => {
    for (const p of ['/login', '/signup', '/home', '/courses', '/pricing/extra', '/site', '/Pricing']) {
      expect(siteRewritePath(p)).toBeNull()
    }
  })
})

describe('marketing site files', () => {
  test('map crawler and LLM files to their handlers', () => {
    expect(siteFileRewritePath('/sitemap.xml')).toBe('/api/site/sitemap')
    expect(siteFileRewritePath('/robots.txt')).toBe('/api/site/robots')
    expect(siteFileRewritePath('/llms.txt')).toBe('/api/site/llms')
    expect(siteFileRewritePath('/terms.md')).toBe('/api/site/legal/terms')
    expect(siteFileRewritePath('/privacy.md')).toBe('/api/site/legal/privacy')
  })

  test('leave other paths alone', () => {
    for (const p of ['/terms', '/README.md', '/sitemap.xml/extra', '/api/site/llms']) {
      expect(siteFileRewritePath(p)).toBeNull()
    }
  })
})
