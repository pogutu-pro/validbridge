import React from 'react'
import Link from 'next/link'
import { COMPANY, SUPPORT_EMAIL } from '@lib/help/brand'
import { SITE_LINKS } from '@lib/site/content'
import SiteLogo from './SiteLogo'

type FooterLink = { label: string; href: string; external?: boolean }

export default function SiteFooter({ helpOrigin }: { helpOrigin: string }) {
  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: 'Product',
      links: [
        { label: 'Features', href: SITE_LINKS.features },
        { label: 'Pricing', href: SITE_LINKS.pricing },
      ],
    },
    {
      title: 'Resources',
      links: [
        { label: 'Help Center', href: `${helpOrigin}/`, external: true },
        { label: 'FAQ', href: SITE_LINKS.faq },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: `${COMPANY.name} ↗`, href: COMPANY.url, external: true },
        { label: 'Contact', href: SITE_LINKS.contact },
      ],
    },
    {
      title: 'Legal',
      links: [
        { label: 'Terms', href: SITE_LINKS.terms },
        { label: 'Privacy', href: SITE_LINKS.privacy },
      ],
    },
  ]

  return (
    <footer className="px-5 pb-10 pt-16 sm:px-8 md:pt-20">
      <div className="s-container">
        <div className="mb-14 grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
          <div className="col-span-2 lg:col-span-1">
            <div className="mb-4">
              <SiteLogo size={26} />
            </div>
            <p className="s-muted m-0 max-w-[260px] text-sm">
              The learning platform for schools, training teams and course creators.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <div className="mb-4 text-sm font-semibold">{col.title}</div>
              <div className="flex flex-col gap-3 text-sm">
                {col.links.map((l) =>
                  l.external ? (
                    <a key={l.label} href={l.href} className="s-muted transition-colors hover:!text-[var(--s-text)]">
                      {l.label}
                    </a>
                  ) : (
                    <Link key={l.label} href={l.href} className="s-muted transition-colors hover:!text-[var(--s-text)]">
                      {l.label}
                    </Link>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="s-subtle flex flex-wrap justify-between gap-2.5 border-t border-[var(--s-divider)] pt-6 text-[13px]">
          <span>
            © {new Date().getFullYear()} ValidBridge, a product of{' '}
            <a href={COMPANY.url} className="s-muted transition-colors hover:!text-[var(--s-text)]">
              {COMPANY.name}
            </a>
          </span>
          <span>
            Support:{' '}
            <a href={SITE_LINKS.support} className="s-muted transition-colors hover:!text-[var(--s-text)]">
              {SUPPORT_EMAIL}
            </a>
          </span>
        </div>
      </div>
    </footer>
  )
}
