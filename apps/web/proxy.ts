import { getAPIUrl, getVALIDBRIDGE_HTTP_PROTOCOL_VAL } from './services/config/config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isLocalhost as isLocalhostCheck } from './services/utils/ts/hostUtils'
import {
  isDocsHost,
  isHelpHost,
  helpSiteOrigin,
  helpSiteRewritePath,
  orgHelpPathToSitePath,
  shouldRedirectToHelpSite,
} from './lib/help/site'
import { SITE_ROUTE, siteFileRewritePath, siteRewritePath } from './lib/site/routes'

// =============================================================================
// Tenancy
// =============================================================================
//
// Three runtime behaviors selected by `instance.tenancy`:
//
//   1. multi (EE-only):   slug.{VALIDBRIDGE_DOMAIN} subdomain detection +
//                         per-org custom domains. The detection logic lives in
//                         `./ee/services/tenancy/...` and is dynamic-imported
//                         here — OSS proxy.ts never references subdomain or
//                         custom-domain helpers directly.
//   2. single (localhost): always serves the default org. Host-only cookies.
//   3. single (VPS):       any domain on a self-hosted VPS. Same as #2 — we
//                         trust the incoming Host header.
//
// Modes 2 and 3 share `tenancy === "single"`. The OSS code path returns the
// default org without ever calling subdomain extraction.

interface InstanceInfo {
  multi_org_enabled: boolean
  default_org_slug: string
  mode: 'saas' | 'oss' | 'ee'
  tenancy: 'multi' | 'single'
  frontend_domain: string
  top_domain: string
}

// Cached instance info from backend (30-second TTL)
let _instanceCache: { data: InstanceInfo; ts: number } | null = null
const INSTANCE_CACHE_TTL = 30 * 1000

async function getInstanceInfo(): Promise<InstanceInfo> {
  if (_instanceCache && Date.now() - _instanceCache.ts < INSTANCE_CACHE_TTL) {
    return _instanceCache.data
  }

  try {
    const apiUrl = getAPIUrl()
    const res = await fetch(`${apiUrl}instance/info`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const raw = await res.json()
      // Older backends only return `multi_org_enabled`; derive `tenancy`.
      const tenancy: 'multi' | 'single' =
        raw.tenancy === 'multi' || raw.multi_org_enabled ? 'multi' : 'single'
      _instanceCache = { data: { ...raw, tenancy }, ts: Date.now() }
      return _instanceCache.data
    }
  } catch {
    // Backend unavailable — use safe defaults
  }
  return {
    multi_org_enabled: false,
    default_org_slug: 'default',
    mode: 'oss' as const,
    tenancy: 'single',
    frontend_domain: 'localhost:3000',
    top_domain: 'localhost',
  }
}

// =============================================================================
// Resolver
// =============================================================================

interface ResolvedTenant {
  slug: string
  customDomain?: string
  source: 'custom-domain' | 'subdomain' | 'cookie' | 'default'
}

/**
 * Resolve the active tenant for this request.
 *
 * In `single` tenancy this is unconditionally the default org — no EE code
 * loaded, no custom-domain lookup, no subdomain extraction. In `multi`
 * tenancy we delegate to the EE resolver via dynamic import; if the import
 * or resolver throws (e.g. EE folder removed at deploy time), we log and
 * fall back to the default org so the site stays up.
 */
async function resolveTenant(req: NextRequest, instance: InstanceInfo): Promise<ResolvedTenant> {
  if (instance.tenancy === 'single') {
    return { slug: instance.default_org_slug, source: 'default' }
  }

  try {
    const mod = await import('./ee/services/tenancy/resolveMulti.middleware')
    return await mod.resolveMultiFromRequest(req, instance)
  } catch (err) {
    console.warn('[proxy] EE multi-tenant resolver unavailable; falling back to default org', err)
    return { slug: instance.default_org_slug, source: 'default' }
  }
}

/**
 * In `multi` tenancy, ask the EE module whether this Host is a custom domain
 * (used by the `/redirect_from_auth` handler). Always false in `single`.
 */
async function hostIsCustomDomain(host: string | null, instance: InstanceInfo): Promise<boolean> {
  if (instance.tenancy === 'single' || !host) return false
  try {
    const mod = await import('./ee/services/tenancy/resolveMulti.middleware')
    return mod.isCustomDomain(host, instance.frontend_domain)
  } catch {
    return false
  }
}

/**
 * Detect the admin subdomain (multi tenancy only). In single mode there is no
 * admin subdomain — operators reach admin via /admin path.
 */
async function isAdminSubdomain(host: string | null, instance: InstanceInfo): Promise<boolean> {
  if (instance.tenancy === 'single' || !host) return false
  try {
    const mod = await import('./ee/services/tenancy/resolveMulti.middleware')
    return mod.extractOrgSubdomain(host, instance.frontend_domain) === 'admin'
      // The EE helper filters out reserved subdomains; check raw too:
      || host.split(':')[0] === `admin.${instance.frontend_domain.split(':')[0]}`
      || host.startsWith('admin.')
  } catch {
    return host.startsWith('admin.')
  }
}

// =============================================================================
// Cookies
// =============================================================================

/**
 * Compute the cookie `domain` attribute given the current tenant.
 * - single tenancy → '' (host-only cookie)
 * - multi tenancy + custom domain → '' (host-only cookie)
 * - multi tenancy + apex/subdomain → '.{top_domain}' (cross-subdomain auth)
 * - localhost in either mode → '' (browsers refuse `Domain=.localhost`)
 */
function cookieDomainFor(instance: InstanceInfo, customDomain?: string): string {
  if (instance.tenancy === 'single') return ''
  if (customDomain) return ''
  if (instance.top_domain === 'localhost') return ''
  return `.${instance.top_domain}`
}

function setOrgCookies(
  response: NextResponse,
  resolved: ResolvedTenant,
  instance: InstanceInfo,
) {
  const domain = cookieDomainFor(instance, resolved.customDomain)
  response.cookies.set({
    name: 'VB_org',
    value: resolved.slug,
    domain,
    path: '/',
  })
  if (resolved.customDomain) {
    response.cookies.set({
      name: 'VB_custom_domain',
      value: resolved.customDomain,
      path: '/',
    })
    response.headers.set('x-custom-domain', resolved.customDomain)
  }
}

function setInstanceCookies(response: NextResponse, info: InstanceInfo) {
  response.cookies.set({ name: 'VB_tenancy', value: info.tenancy, path: '/' })
  response.cookies.set({ name: 'VB_default_org', value: info.default_org_slug, path: '/' })
  response.cookies.set({ name: 'VB_frontend_domain', value: info.frontend_domain, path: '/' })
  response.cookies.set({ name: 'VB_top_domain', value: info.top_domain, path: '/' })
  response.cookies.set({ name: 'VB_mode', value: info.mode, path: '/' })
  return response
}

/**
 * Build a request-header bag that propagates tenancy context to downstream
 * Server Components on THIS request. Cookies set in the response only become
 * visible to RSC on the *next* request, so server-side helpers like
 * `getCanonicalUrl` can't rely on them on the first cold load. Reading the
 * `x-vb-*` headers via `next/headers` gives them an immediately-available
 * source of truth.
 */
function tenantRequestHeaders(
  req: NextRequest,
  resolved: ResolvedTenant,
  instance: InstanceInfo,
): Headers {
  const headers = new Headers(req.headers)
  headers.set('x-vb-tenancy', instance.tenancy)
  headers.set('x-vb-org', resolved.slug)
  headers.set('x-vb-top-domain', instance.top_domain)
  headers.set('x-vb-frontend-domain', instance.frontend_domain)
  headers.set('x-vb-mode', instance.mode)
  if (resolved.customDomain) {
    headers.set('x-vb-custom-domain', resolved.customDomain)
  }
  return headers
}

// =============================================================================
// Middleware
// =============================================================================

export const config = {
  matcher: [
    /*
     * Match all paths except for:
     * 1. /api routes
     * 2. /_next (Next.js internals)
     * 3. /fonts (inside /public)
     * 4. Umami Analytics
     * 5. /examples (inside /public)
     * 6. all root files inside /public (e.g. /favicon.ico)
     * 7. /embed (activity embeds)
     * 8. /ingest (PostHog reverse proxy — must reach the next.config rewrite
     *    untouched; otherwise the middleware mis-routes it and ingestion 404s)
     */
    '/((?!api|_next|fonts|umami|ingest|examples|embed|monitoring|[\\w-]+\\.\\w+).*)',
    '/sitemap.xml',
    '/robots.txt',
    // Marketing-site files on the apex (see lib/site/routes.ts SITE_FILES).
    '/llms.txt',
    '/terms.md',
    '/privacy.md',
    '/podcast/:path*/feed',
  ],
}

export default async function proxy(req: NextRequest) {
  const instance = await getInstanceInfo()
  const { pathname, search } = req.nextUrl
  const fullhost = req.headers.get('host')

  // SEO: canonicalize mixed-case top-level route names (/Login → /login). Scoped
  // to KNOWN static routes only so it never lowercases data-bearing segments
  // (org slugs, course/activity UUIDs, media paths).
  const CANONICAL_LOWER = new Set([
    '/login', '/signup', '/forgot', '/reset', '/verify-email',
    '/home', '/billing', '/new', '/account', '/organizations', '/subscriptions',
  ])
  if (pathname !== pathname.toLowerCase() && CANONICAL_LOWER.has(pathname.toLowerCase())) {
    return NextResponse.redirect(new URL(`${pathname.toLowerCase()}${search}`, req.url), 308)
  }

  // -------------------------------------------------------------------------
  // 0. Help Center host (multi only): help.{domain} serves the public Help
  //    Center from app/help-center. It is not org-scoped, so no tenant is
  //    resolved and no org cookies are written. `help` is a reserved
  //    subdomain, so this never shadows an organization.
  // -------------------------------------------------------------------------
  // The public docs site is retired (ValidBridge is a private product):
  // docs.{domain} and any old deep link land on the Help Center home.
  if (instance.tenancy === 'multi' && isDocsHost(fullhost, instance.frontend_domain)) {
    return NextResponse.redirect(`${helpSiteOrigin(getVALIDBRIDGE_HTTP_PROTOCOL_VAL(), instance.frontend_domain)}/`, 308)
  }

  if (instance.tenancy === 'multi' && isHelpHost(fullhost, instance.frontend_domain)) {
    const headers = new Headers(req.headers)
    headers.set('x-vb-tenancy', instance.tenancy)
    headers.set('x-vb-top-domain', instance.top_domain)
    headers.set('x-vb-frontend-domain', instance.frontend_domain)
    headers.set('x-vb-mode', instance.mode)
    const response = NextResponse.rewrite(
      new URL(`${helpSiteRewritePath(pathname)}${search}`, req.url),
      { request: { headers } },
    )
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 1. Admin subdomain (multi only) → rewrite to /admin route group.
  //    Idempotent: if the path already starts with /admin (e.g. internal nav
  //    uses /admin/organizations so it works in both subdomain and path mode),
  //    don't double-prefix.
  // -------------------------------------------------------------------------
  if (await isAdminSubdomain(fullhost, instance)) {
    const target = pathname === '/admin' || pathname.startsWith('/admin/')
      ? pathname
      : `/admin${pathname}`
    const response = NextResponse.rewrite(new URL(`${target}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 1b. Admin path — direct /admin access works in any tenancy mode.
  //     In single mode this is the only way to reach the admin panel; in
  //     multi mode it's an alternative to the admin.{domain} subdomain.
  // -------------------------------------------------------------------------
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 1b. Legacy /dashboard/* → hub redirects
  //
  //    The old platform (validbridge.co.ke) used /dashboard/{slug}/plan, /dashboard/
  //    new, /dashboard/account, etc. Those paths do NOT exist on .io and would
  //    404. Old bookmarks and emails can still point here, so permanently map
  //    them onto the hub instead of dead-ending. SaaS/multi only.
  // -------------------------------------------------------------------------
  if (instance.tenancy === 'multi' && pathname.startsWith('/dashboard')) {
    let dest = '/home'
    const planMatch = pathname.match(/^\/dashboard\/([^/]+)\/plan\/?$/)
    if (planMatch && planMatch[1] !== 'new') {
      dest = `/billing?org=${planMatch[1]}`
    } else if (pathname === '/dashboard/new' || pathname.startsWith('/dashboard/new/')) {
      dest = '/new'
    } else if (pathname === '/dashboard/subscriptions') {
      dest = '/subscriptions'
    } else if (pathname === '/dashboard/account' || pathname.startsWith('/dashboard/account/')) {
      dest = '/account'
    }
    // Preserve query markers (checkout=cancelled, session_id, …). /billing?org=
    // already carries a query, so merge with & in that case.
    const extraQuery = search ? (dest.includes('?') ? `&${search.slice(1)}` : search) : ''
    return NextResponse.redirect(new URL(`${dest}${extraQuery}`, req.url), 308)
  }

  // -------------------------------------------------------------------------
  // 2. Standard out-of-org paths (root hub)
  //
  //    These render at the apex/root and must NEVER fall into the tenant
  //    catch-all (which would rewrite them to /orgs/{slug}/...). `/home` is the
  //    org picker and works in every tenancy. The rest form the central
  //    account + org-management hub (create / upgrade / delete an org, billing,
  //    account) and only exist in `multi` tenancy (SaaS); the (hub) route-group
  //    layout additionally enforces SaaS gating. We set instance cookies so the
  //    hub's client components can read tenancy/mode/top-domain.
  // -------------------------------------------------------------------------
  const HUB_ROOT_PATHS = ['/home', '/organizations', '/account', '/billing', '/subscriptions', '/new']
  const isHubRoot = HUB_ROOT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
  // `/billing` is where a school pays ValidBridge, so it must work in every
  // tenancy. In single tenancy it used to fall through to the tenant catch-all
  // (→ /orgs/{slug}/billing, which doesn't exist) and bounce the admin back.
  const isBilling = pathname === '/billing' || pathname.startsWith('/billing/')
  if (pathname === '/home' || isBilling || (instance.tenancy === 'multi' && isHubRoot)) {
    // `/account/*` ALSO exists as an org-scoped dashboard route
    // (/orgs/{slug}/account/[subpage] — general/security/purchases). On an org
    // subdomain or custom domain it must resolve there, NOT the apex hub (which
    // has no /account subpages), so let it fall through to the tenant catch-all.
    let onOrgHost = false
    if ((pathname === '/account' || pathname.startsWith('/account/')) && instance.tenancy === 'multi') {
      const resolved = await resolveTenant(req, instance)
      onOrgHost = resolved.source === 'subdomain' || resolved.source === 'custom-domain'
    }
    if (!onOrgHost) {
      const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
      setInstanceCookies(response, instance)
      return response
    }
    // account on an org host → fall through to the tenant-scoped rewrite below.
  }

  // -------------------------------------------------------------------------
  // 3. Auth pages — resolve tenant for cookie context, rewrite to /auth
  // -------------------------------------------------------------------------
  const authPaths = ['/login', '/signup', '/reset', '/forgot', '/verify-email']
  if (authPaths.includes(pathname)) {
    const hasSession = !!req.cookies.get('VB_session')?.value

    // NOTE: `/login` is intentionally NOT bounced to `/home` here. The marker
    // cookie can outlive a real session (expired/refreshed tokens, a cleared
    // backend), and bouncing on the marker alone trapped those users: the login
    // page never rendered, so they could never sign back in. The login page
    // itself redirects genuinely-authenticated users to `/home`, so letting it
    // render is both correct and recovery-friendly.

    const resolved = await resolveTenant(req, instance)

    // `/signup` is NOT only a signup page: for a signed-in user on an org host
    // it is the JOIN screen (the "Join this organization" banner and every
    // invite link point at it). Bouncing them to /home dropped them on the org
    // picker instead — and silently threw away any ?inviteCode. So only send a
    // signed-in visitor to the hub when there is genuinely no org to join here:
    // the org-less apex, with no invite code in hand.
    if (pathname === '/signup' && hasSession) {
      const onOrgHost =
        instance.tenancy === 'single'
        || resolved.source === 'subdomain'
        || resolved.source === 'custom-domain'
      const hasInviteCode = !!req.nextUrl.searchParams.get('inviteCode')
      if (!onOrgHost && !hasInviteCode) {
        // Keep a pricing-page plan choice ("Choose Growth") so the hub can
        // offer to take the admin to that plan's checkout.
        const home = new URL('/home', req.url)
        for (const key of ['plan', 'cycle']) {
          const value = req.nextUrl.searchParams.get(key)
          if (value && /^[a-z-]{1,32}$/.test(value)) home.searchParams.set(key, value)
        }
        return NextResponse.redirect(home)
      }
    }

    const requestHeaders = tenantRequestHeaders(req, resolved, instance)
    const response = NextResponse.rewrite(
      new URL(`/auth${pathname}${search}`, req.url),
      { request: { headers: requestHeaders } },
    )
    setOrgCookies(response, resolved, instance)
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 4. Auth callbacks — pass through without org rewrite
  // -------------------------------------------------------------------------
  if (
    pathname.startsWith('/auth/sso/')
    || pathname.startsWith('/auth/callback/')
    || pathname.startsWith('/auth/token-exchange')
  ) {
    const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // Magic login links are emailed as /auth/magic?token=… — already the internal
  // path, so it needs a pass-through of its own. Without one it fell to the
  // tenant catch-all, was rewritten to /orgs/{slug}/auth/magic, and every
  // emailed link 404'd. Tenant is resolved (unlike the callbacks above) because
  // the page finishes through /redirect_from_auth, which reads the org cookies
  // to know which host to land on.
  if (pathname === '/auth/magic') {
    const resolved = await resolveTenant(req, instance)
    const requestHeaders = tenantRequestHeaders(req, resolved, instance)
    const response = NextResponse.rewrite(
      new URL(`${pathname}${search}`, req.url),
      { request: { headers: requestHeaders } },
    )
    setOrgCookies(response, resolved, instance)
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 5. Standalone editors / boards — bypass org rewrite
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/course\/[^/]+\/activity\/[^/]+\/edit$/)) {
    return NextResponse.rewrite(new URL(`/editor${pathname}`, req.url))
  }
  if (pathname.startsWith('/board/')) {
    const response = NextResponse.rewrite(new URL(pathname + search, req.url))
    setInstanceCookies(response, instance)
    return response
  }
  if (pathname.startsWith('/editor/labs/')) {
    const response = NextResponse.rewrite(new URL(pathname + search, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 5b. /showcase — presentation mockup route, bypass org rewrite
  //
  //    /showcase/mobile is a static, hardcoded UI mockup of the planned
  //    mobile app (see app/showcase/mobile/). It renders under the root
  //    layout only — it must NOT be tenant-rewritten to /orgs/{slug}/... or
  //    it would inherit org chrome (nav, footer) and lose its standalone
  //    presentation frame, and it MUST NOT reach customers. It is not linked
  //    from any navigation. Remove this branch if/when the route is removed.
  // -------------------------------------------------------------------------
  if (pathname === '/showcase' || pathname.startsWith('/showcase/')) {
    const response = NextResponse.rewrite(new URL(pathname + search, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 5c. Marketing site preview on localhost. Plain localhost always serves
  //     the default org at `/`, so the apex branch (10) never runs there; open
  //     /site, /site/pricing, … directly instead. Production hosts never reach
  //     app/site by this path — only through the apex rewrite.
  // -------------------------------------------------------------------------
  //     /pricing, /terms and /privacy (and their .md copies) are served too, so
  //     the site's own links work in the preview; `/` stays the default org.
  const localSitePath = pathname === '/' ? null : (siteRewritePath(pathname) ?? siteFileRewritePath(pathname))
  const localSiteTarget = pathname === SITE_ROUTE || pathname.startsWith(`${SITE_ROUTE}/`)
    ? pathname
    : localSitePath !== null && !['/sitemap.xml', '/robots.txt'].includes(pathname)
      ? localSitePath
      : null
  if (localSiteTarget !== null && isLocalhostCheck(fullhost)) {
    const response = NextResponse.rewrite(new URL(localSiteTarget + search, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 6. Health check
  // -------------------------------------------------------------------------
  if (pathname.startsWith('/health')) {
    return NextResponse.rewrite(new URL(`/api/health`, req.url))
  }

  // -------------------------------------------------------------------------
  // 8. Auth redirect bridge (cross-domain return path)
  // -------------------------------------------------------------------------
  if (pathname === '/redirect_from_auth') {
    const params = new URLSearchParams(req.nextUrl.searchParams)

    const rawNext = params.get('next')
    params.delete('next')

    const customDomain = req.cookies.get('VB_custom_domain')?.value
    const base = customDomain
      ? `${req.nextUrl.protocol}//${customDomain}`
      : req.url
    const baseOrigin = new URL(base).origin

    // Every auth flow forwards where the user was headed as ?next. Landing them
    // on "/" instead threw that away, so a deep link that prompted a sign-in
    // always returned to the org picker.
    //
    // Resolve the candidate and compare origins rather than pattern-matching the
    // raw string: this is an open-redirect sink, and a prefix test lets through
    // anything the URL parser later normalises into another origin ("//evil",
    // "/\evil", encoded control characters). Only the path survives.
    let dest = '/'
    if (rawNext) {
      try {
        const candidate = new URL(rawNext, baseOrigin)
        if (candidate.origin === baseOrigin) {
          dest = `${candidate.pathname}${candidate.search}${candidate.hash}`
        }
      } catch {
        // Unparseable — fall back to the root.
      }
    }

    // On the apex, "/" is the public marketing site, not a signed-in page:
    // land the user on the org picker instead. Org hosts keep "/" (org home).
    if (
      dest === '/'
      && !customDomain
      && instance.tenancy === 'multi'
      && fullhost
      && !isLocalhostCheck(fullhost)
      && (await resolveTenant(req, instance)).source === 'default'
    ) {
      dest = '/home'
    }

    const redirectUrl = new URL(dest, base)
    const remaining = params.toString()
    if (remaining) {
      redirectUrl.search = redirectUrl.search
        ? `${redirectUrl.search}&${remaining}`
        : remaining
    }
    return NextResponse.redirect(redirectUrl)
  }

  // -------------------------------------------------------------------------
  // 8b. Marketing-site files on the apex: sitemap.xml, robots.txt, llms.txt
  //     and the Markdown copies of the legal pages. Org hosts fall through to
  //     their per-org sitemap/robots below (and have no llms.txt or .md pages).
  // -------------------------------------------------------------------------
  const siteFile = siteFileRewritePath(pathname)
  if (
    siteFile !== null
    && instance.tenancy === 'multi'
    && fullhost
    && !isLocalhostCheck(fullhost)
    && !(await hostIsCustomDomain(fullhost, instance))
  ) {
    const resolved = await resolveTenant(req, instance)
    if (resolved.source === 'default') {
      return NextResponse.rewrite(new URL(siteFile, req.url), {
        request: { headers: tenantRequestHeaders(req, resolved, instance) },
      })
    }
  }

  // -------------------------------------------------------------------------
  // 9. Per-org metadata endpoints (sitemap, robots, podcast feed)
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/podcast\/([^/]+)\/feed$/)) {
    const resolved = await resolveTenant(req, instance)
    const feedUrl = new URL(`/api${pathname}`, req.url)
    const response = NextResponse.rewrite(feedUrl)
    response.headers.set('X-Feed-Orgslug', resolved.slug)
    return response
  }
  if (pathname.startsWith('/sitemap.xml')) {
    const resolved = await resolveTenant(req, instance)
    const sitemapUrl = new URL(`/api/sitemap`, req.url)
    const response = NextResponse.rewrite(sitemapUrl)
    response.headers.set('X-Sitemap-Orgslug', resolved.slug)
    return response
  }
  if (pathname === '/robots.txt') {
    const resolved = await resolveTenant(req, instance)
    const robotsUrl = new URL(`/api/robots`, req.url)
    const response = NextResponse.rewrite(robotsUrl)
    response.headers.set('X-Robots-Orgslug', resolved.slug)
    return response
  }

  // -------------------------------------------------------------------------
  // 9b. Org Help Center → help.{domain}. `/help`, `/help/{category}` and
  //     `/help/{category}/{article}` redirect to the same page on the help
  //     host (browsers carry a `#anchor` across the redirect, and the help
  //     home maps old single-page anchors to articles). Custom domains, plain
  //     localhost and single tenancy keep the in-org pages — see
  //     shouldRedirectToHelpSite. 307, not permanent, so turning the help host
  //     off later does not leave stale cached redirects behind.
  // -------------------------------------------------------------------------
  const helpSitePath = orgHelpPathToSitePath(pathname)
  if (
    helpSitePath !== null
    && shouldRedirectToHelpSite({
      tenancy: instance.tenancy,
      host: fullhost,
      isCustomDomain: await hostIsCustomDomain(fullhost, instance),
    })
  ) {
    const origin = helpSiteOrigin(getVALIDBRIDGE_HTTP_PROTOCOL_VAL(), instance.frontend_domain)
    return NextResponse.redirect(`${origin}${helpSitePath}${search}`, 307)
  }

  // -------------------------------------------------------------------------
  // 10. Apex marketing site (multi tenancy only) — landing, pricing, legal.
  //
  //     The bare apex (validbridge.co.ke) is NOT org-scoped: `/`, /pricing,
  //     /terms and /privacy are the public marketing site (app/site) for
  //     everyone, signed in or not. Signed-in visitors get an "Open ValidBridge"
  //     link in the site header to the /home org picker, where they choose an
  //     org — which lives on its own subdomain ({slug}.validbridge.co.ke) or
  //     custom domain. Org content is ONLY served on a subdomain/custom domain,
  //     never at the apex. Auth flows land on /home, not `/` (see
  //     /redirect_from_auth above).
  // -------------------------------------------------------------------------
  if (
    instance.tenancy === 'multi'
    && siteRewritePath(pathname) !== null
    && fullhost
    && !isLocalhostCheck(fullhost)
    && !(await hostIsCustomDomain(fullhost, instance))
  ) {
    const resolved = await resolveTenant(req, instance)
    if (resolved.source === 'default') {
      const target = `${siteRewritePath(pathname)}${search}`
      const requestHeaders = tenantRequestHeaders(req, resolved, instance)
      const response = NextResponse.rewrite(new URL(target, req.url), {
        request: { headers: requestHeaders },
      })
      setOrgCookies(response, resolved, instance)
      setInstanceCookies(response, instance)
      return response
    }
  }

  // -------------------------------------------------------------------------
  // 11. Tenant-scoped rewrite — the catch-all that puts us under /orgs/{slug}
  // -------------------------------------------------------------------------
  const resolved = await resolveTenant(req, instance)
  const requestHeaders = tenantRequestHeaders(req, resolved, instance)
  // `${search}` is load-bearing: a rewrite destination built from an absolute
  // path drops the base URL's query, and Next treats the destination's search
  // as the request's. Every other branch above appends it; this one did not, so
  // org-scoped pages lost their query string (?page, ?q, ?tab, …).
  const response = NextResponse.rewrite(
    new URL(`/orgs/${resolved.slug}${pathname}${search}`, req.url),
    { request: { headers: requestHeaders } },
  )
  setOrgCookies(response, resolved, instance)
  setInstanceCookies(response, instance)
  return response
}
