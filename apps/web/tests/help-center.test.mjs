import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isValidElement } from 'react'
import { HELP_CATEGORIES, POPULAR_ARTICLES, resolveArticlePath, resolveLegacyAnchor } from '../lib/help/index.ts'
import { buildHelpIndex, extractText, searchHelp } from '../lib/help/search.ts'
import { COMPANY } from '../lib/help/brand.ts'
import { appHref, helpHref } from '../lib/help/links.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORG = { orgslug: 'acme', appOrigin: '' }
const SITE = { orgslug: null, appOrigin: 'https://validbridge.test' }

/** Collect every `to` prop (HelpLink targets) in an article's JSX tree. */
function collectLinkTargets(node, out = []) {
  if (Array.isArray(node)) {
    for (const n of node) collectLinkTargets(n, out)
  } else if (isValidElement(node)) {
    const props = node.props ?? {}
    if (typeof props.to === 'string') out.push(props.to)
    for (const key of ['children', 'term', 'rows', 'head']) collectLinkTargets(props[key], out)
  }
  return out
}

describe('help center catalogue', () => {
  test('categories and article ids are unique and non-empty', () => {
    const categoryIds = HELP_CATEGORIES.map((c) => c.id)
    expect(new Set(categoryIds).size).toBe(categoryIds.length)
    const articleIds = HELP_CATEGORIES.flatMap((c) => c.articles.map((a) => a.id))
    expect(new Set(articleIds).size).toBe(articleIds.length)
    for (const c of HELP_CATEGORIES) {
      expect(c.articles.length).toBeGreaterThan(0)
      for (const a of c.articles) {
        expect(a.title.length).toBeGreaterThan(0)
        expect(a.summary.length).toBeGreaterThan(0)
        expect(a.audience.length).toBeGreaterThan(0)
      }
    }
  })

  test('covers the core product areas, including LiveBridge and payments', () => {
    const ids = HELP_CATEGORIES.map((c) => c.id)
    for (const id of ['getting-started', 'courses', 'livebridge', 'students', 'assessments', 'payments', 'analytics', 'organization', 'integrations', 'account', 'troubleshooting']) {
      expect(ids).toContain(id)
    }
  })

  test('integrations topic has a guide per Developers page, and the old article still resolves', () => {
    for (const path of ['integrations/api-access', 'integrations/webhooks', 'integrations/custom-domains', 'integrations/single-sign-on', 'integrations/seo']) {
      expect(resolveArticlePath(path)).toBeDefined()
    }
    // Old links pointed at organization/developers (and the #developers anchor).
    expect(resolveArticlePath('organization/developers')).toBeDefined()
    expect(resolveLegacyAnchor('developers')).toBe('organization/developers')
  })

  test('custom domain guide matches the verification records the product asks for', () => {
    const text = extractText(resolveArticlePath('integrations/custom-domains').article.content(ORG))
    expect(text).toContain('_validbridge-verification')
    expect(text).toContain('validbridge-verify=')
    expect(text).toMatch(/CNAME/)
  })

  test('webhook guide documents the signature header', () => {
    const text = extractText(resolveArticlePath('integrations/webhooks').article.content(ORG))
    expect(text).toContain('X-Webhook-Signature')
    expect(text).toContain('sha256=')
  })

  test('every internal help link and popular article resolves', () => {
    for (const c of HELP_CATEGORIES) {
      for (const a of c.articles) {
        for (const to of collectLinkTargets(a.content(ORG))) {
          expect({ from: `${c.id}/${a.id}`, to, ok: !!resolveArticlePath(to) }).toEqual({ from: `${c.id}/${a.id}`, to, ok: true })
        }
      }
    }
    for (const path of POPULAR_ARTICLES) expect(resolveArticlePath(path)).toBeDefined()
  })

  test('legacy single-page anchors redirect to articles', () => {
    for (const anchor of ['ai-copilot', 'roles-and-permissions', 'boards-teaching', 'payments-admin', 'getting-help']) {
      const path = resolveLegacyAnchor(anchor)
      expect(path).toBeDefined()
      expect(resolveArticlePath(path)).toBeDefined()
    }
    expect(resolveLegacyAnchor('no-such-anchor')).toBeUndefined()
  })
})

describe('help content accuracy', () => {
  const allText = HELP_CATEGORIES.flatMap((c) =>
    c.articles.map((a) => `${a.title} ${a.summary} ${extractText(a.content(ORG))}`)
  ).join('\n')

  test('no open-source, upstream or Stripe leftovers', () => {
    expect(allText).not.toMatch(/open[- ]source|learnhouse|discord|community edition|self-host/i)
    expect(allText).not.toMatch(/stripe/i)
  })

  // ValidBridge is a private commercial product: Help is for customers, not for
  // running or modifying the platform.
  const FORBIDDEN = /open[- ]source|self[- ]?host|docker|kubernetes|docs\.validbridge|environment variable|\benv var|github|contribut(e|ing) to|source code|VALIDBRIDGE_[A-Z]|NEXT_PUBLIC_/i

  test('articles say nothing about hosting, infrastructure or contributing', () => {
    for (const c of HELP_CATEGORIES) {
      for (const a of c.articles) {
        for (const ctx of [ORG, SITE]) {
          const text = [c.title, c.description, a.title, a.summary, ...(a.keywords ?? []), extractText(a.content(ctx))].join(' ')
          const hit = text.match(FORBIDDEN)?.[0] ?? null
          expect({ article: `${c.id}/${a.id}`, hit }).toEqual({ article: `${c.id}/${a.id}`, hit: null })
        }
      }
    }
  })

  test('help source files carry no hosting or public-docs references', () => {
    const dirs = [join(ROOT, 'lib/help'), join(ROOT, 'components/Help')]
    for (const dir of dirs) {
      for (const file of readdirSync(dir)) {
        if (!/\.(ts|tsx)$/.test(file)) continue
        const source = readFileSync(join(dir, file), 'utf8')
        const hit = source.match(/open[- ]source|self[- ]?host|docker|docs\.validbridge|github\.com/i)?.[0] ?? null
        expect({ file, hit }).toEqual({ file, hit: null })
      }
    }
  })

  test('credits Stratnovo Systems', () => {
    expect(COMPANY.url).toBe('https://stratnovo.co.ke')
    expect(allText).toContain(COMPANY.name)
  })
})

describe('help search', () => {
  const index = buildHelpIndex(HELP_CATEGORIES, ORG)

  test('extracts table and definition text', () => {
    const entry = index.find((e) => e.articleId === 'live-attendance-reports')
    expect(entry.text).toContain('Left early')
  })

  test('ranks the obvious article first', () => {
    expect(searchHelp(index, 'schedule live lesson')[0].articleId).toBe('schedule-live-lesson')
    expect(searchHelp(index, 'webhook paystack')[0].articleId).toBe('connect-paystack')
    expect(searchHelp(index, 'two factor')[0].articleId).toBe('two-factor')
  })

  test('finds the integrations guides', () => {
    expect(searchHelp(index, 'api token')[0].articleId).toBe('api-access')
    expect(searchHelp(index, 'webhook signature')[0].articleId).toBe('webhooks')
    expect(searchHelp(index, 'custom domain')[0].articleId).toBe('custom-domains')
    expect(searchHelp(index, 'sso')[0].articleId).toBe('single-sign-on')
    expect(searchHelp(index, 'zapier')[0].articleId).toBe('webhooks')
  })

  test('requires every word to match', () => {
    expect(searchHelp(index, 'zzzz')).toEqual([])
    expect(searchHelp(index, '   ')).toEqual([])
  })
})

describe('help links by context', () => {
  test('standalone help site links stay on the help host and send app links to the main address', () => {
    expect(helpHref(SITE)).toBe('/')
    expect(helpHref(SITE, 'payments/create-offer')).toBe('/payments/create-offer')
    expect(appHref(SITE, '/dash/courses')).toBe('https://validbridge.test/')
  })

  test('every article renders in both contexts', () => {
    for (const c of HELP_CATEGORIES) {
      for (const a of c.articles) {
        expect(extractText(a.content(SITE)).length).toBeGreaterThan(0)
        expect(extractText(a.content(ORG)).length).toBeGreaterThan(0)
      }
    }
  })
})
