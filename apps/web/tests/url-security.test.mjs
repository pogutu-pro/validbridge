import { afterEach, describe, expect, test } from 'bun:test'
import { safeExternalUrl, safeHref, safeImageSrc, safeInternalPath } from '../services/security/url.ts'
import { safeRedirectUrl } from '../services/auth/redirects.ts'
import { getUriWithOrg } from '../services/config/config.ts'
import { redirectToSSOLogin } from '../services/auth/sso.ts'

const originalWindow = globalThis.window
const originalDocument = globalThis.document
const originalFetch = globalThis.fetch

function browserAt(origin = 'https://school.validbridge.example', cookie = '') {
  globalThis.window = {
    location: new URL(origin),
    __RUNTIME_CONFIG__: {
      NEXT_PUBLIC_VALIDBRIDGE_DOMAIN: 'validbridge.example',
      NEXT_PUBLIC_VALIDBRIDGE_TOP_DOMAIN: 'validbridge.example',
    },
  }
  globalThis.document = { cookie }
}

afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window
  else globalThis.window = originalWindow
  if (originalDocument === undefined) delete globalThis.document
  else globalThis.document = originalDocument
  globalThis.fetch = originalFetch
})

describe('URL parsing at links, images and navigation sinks', () => {
  for (const value of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)',
    'java\nscript:alert(1)', '\u0000javascript:alert(1)', 'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>', '//attacker.example/path',
    '/\\attacker.example/path', '\\attacker.example/path',
    '/\n/attacker.example/path', 'https://school.example@attacker.example/path',
  ]) {
    test(`rejects browser-normalized unsafe input ${JSON.stringify(value)}`, () => {
      expect(safeHref(value)).toBe('#')
      expect(safeExternalUrl(value)).toBeNull()
      expect(safeImageSrc(value)).toBeUndefined()
      browserAt()
      expect(safeRedirectUrl(value)).toBe('/')
    })
  }

  test('keeps ordinary links and query strings intact', () => {
    for (const value of ['/course/123?tab=about', 'course/123', '#lesson', '?tab=2', 'https://example.org/a', 'mailto:help@example.org']) {
      expect(safeHref(value)).toBe(value)
    }
    expect(safeExternalUrl('https://idp.example.org/authorize?state=a%2Fb')).toBe('https://idp.example.org/authorize?state=a%2Fb')
    expect(safeExternalUrl('/authorize')).toBeNull()
    expect(safeExternalUrl('mailto:help@example.org')).toBeNull()
  })

  test('image previews retain object URLs and raster data without allowing HTML or SVG', () => {
    for (const value of ['blob:https://school.example/1234', 'data:image/png;base64,aGVsbG8=', '/content/avatar.png', 'https://cdn.example/image.webp']) {
      expect(safeImageSrc(value)).toBe(value)
    }
    expect(safeImageSrc('data:image/svg+xml,<svg onload="alert(1)"/>')).toBeUndefined()
    expect(safeImageSrc('mailto:help@example.org')).toBeUndefined()
    expect(safeHref('blob:https://school.example/1234')).toBe('#')
  })

  test('internal path builders cannot be turned into external navigation', () => {
    for (const value of ['https://attacker.example', '//attacker.example', '/\\attacker.example', 'javascript:alert(1)']) {
      expect(safeInternalPath(value)).toBe('/')
    }
    expect(safeInternalPath('')).toBe('')
    expect(safeInternalPath('/course/a?next=%2Flesson')).toBe('/course/a?next=%2Flesson')
  })
})

describe('organization and authentication redirects', () => {
  test('preserves same-origin paths and sibling organization navigation', () => {
    browserAt()
    expect(safeRedirectUrl('/dash?tab=users')).toBe('/dash?tab=users')
    expect(safeRedirectUrl('https://other.validbridge.example/dash')).toBe('https://other.validbridge.example/dash')
    expect(safeRedirectUrl('https://validbridge.example/dash')).toBe('https://validbridge.example/dash')
  })

  test('rejects external hosts, suffix tricks, ports and HTTPS downgrade', () => {
    browserAt()
    for (const value of ['https://attacker.example', 'https://validbridge.example.attacker.example', 'https://notvalidbridge.example', 'https://other.validbridge.example:444', 'http://school.validbridge.example/dash']) {
      expect(safeRedirectUrl(value, '/login')).toBe('/login')
    }
  })

  test('keeps custom-domain and localhost authentication working', () => {
    browserAt('https://custom.example')
    expect(safeRedirectUrl('https://custom.example/dash')).toBe('https://custom.example/dash')
    browserAt('http://localhost:3000')
    expect(safeRedirectUrl('http://localhost:3000/dash')).toBe('http://localhost:3000/dash')
  })

  test('malformed cookies do not crash authentication', () => {
    browserAt('https://school.validbridge.example', 'VB_top_domain=%')
    expect(safeRedirectUrl('https://attacker.example')).toBe('/')
  })

  test('organization links validate the slug and the path before building a hostname', () => {
    browserAt('https://validbridge.example', 'VB_tenancy=multi')
    expect(getUriWithOrg('school', '/course/123')).toBe('https://school.validbridge.example/course/123')
    for (const slug of ['attacker.example/', 'attacker.example@', '../attacker', 'school\\attacker', 'a'.repeat(64)]) {
      expect(getUriWithOrg(slug, '/course/123')).toBe('/course/123')
    }
    expect(getUriWithOrg('school', '//attacker.example')).toBe('https://school.validbridge.example/')
    browserAt('https://school.validbridge.example', 'VB_tenancy=single')
    expect(getUriWithOrg('school', '/\\attacker.example')).toBe('/')
  })

  test('SSO refuses a script URL returned by the upstream API', async () => {
    browserAt()
    const before = window.location.href
    globalThis.fetch = async () => Response.json({ authorization_url: 'javascript:alert(1)' })
    await expect(redirectToSSOLogin('school')).rejects.toThrow('Invalid SSO authorization URL')
    expect(window.location.href).toBe(before)
  })

  test('SSO accepts configured providers on other hosts', async () => {
    browserAt()
    const destination = 'https://idp.example.org/authorize?state=123'
    globalThis.fetch = async () => Response.json({ authorization_url: destination })
    await redirectToSSOLogin('school')
    expect(window.location.href).toBe(destination)
  })
})
