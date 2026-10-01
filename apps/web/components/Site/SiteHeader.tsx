'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { List, X } from '@phosphor-icons/react'
import { SITE_LINKS } from '@lib/site/content'
import SiteLogo from './SiteLogo'

/** Sticky, translucent top bar of the marketing site. Collapses to a menu sheet under 768px. */
export default function SiteHeader({ helpOrigin, signedIn = false }: { helpOrigin: string; signedIn?: boolean }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  // The proxy rewrites /pricing → /site/pricing, and the client router sees either.
  const onPricing = pathname.endsWith('/pricing')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  const links = [
    { label: 'Features', href: SITE_LINKS.features },
    { label: 'Pricing', href: SITE_LINKS.pricing, current: onPricing },
    { label: 'FAQ', href: SITE_LINKS.faq },
    { label: 'Help', href: `${helpOrigin}/`, external: true },
  ]

  return (
    <nav className="s-nav" aria-label="Main">
      <div className="mx-auto flex h-16 max-w-[1224px] items-center justify-between gap-4 px-5 sm:px-8">
        <Link href={SITE_LINKS.home} aria-label="ValidBridge home" onClick={() => setOpen(false)}>
          <SiteLogo />
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) =>
            l.external ? (
              <a key={l.label} href={l.href} className="s-nav-link">
                {l.label}
              </a>
            ) : (
              <Link key={l.label} href={l.href} className="s-nav-link" aria-current={l.current ? 'page' : undefined}>
                {l.label}
              </Link>
            ),
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-5">
          {signedIn ? (
            <a href={SITE_LINKS.app} className="s-btn s-btn-primary !min-h-9 !px-4 !py-2 !text-sm">
              Open ValidBridge
            </a>
          ) : (
            <>
              <a href={SITE_LINKS.login} className="s-nav-link hidden sm:inline">
                Log in
              </a>
              <a href={SITE_LINKS.signup} className="s-btn s-btn-primary !min-h-9 !px-4 !py-2 !text-sm">
                Start free
              </a>
            </>
          )}
          <button
            type="button"
            className="s-btn !min-h-11 !w-11 !p-0 md:!hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={22} aria-hidden /> : <List size={22} aria-hidden />}
          </button>
        </div>
      </div>

      {open && (
        <div
          id="site-menu"
          className="fixed inset-x-0 bottom-0 top-16 z-50 flex flex-col bg-white px-5 pt-4 md:hidden"
        >
          {[...links, ...(signedIn ? [] : [{ label: 'Log in', href: SITE_LINKS.login, external: true }])].map((l) => (
            <a
              key={l.label}
              href={l.href}
              onClick={() => setOpen(false)}
              className="flex min-h-14 items-center border-b border-[var(--s-divider)] text-2xl font-semibold tracking-[-0.02em] text-[var(--s-text)]"
            >
              {l.label}
            </a>
          ))}
          <a href={signedIn ? SITE_LINKS.app : SITE_LINKS.signup} className="s-btn s-btn-lg s-btn-primary mt-8">
            {signedIn ? 'Open ValidBridge' : 'Start free'}
          </a>
        </div>
      )}
    </nav>
  )
}
