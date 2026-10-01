import React from 'react'
import Link from 'next/link'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr'
import { COMPANY } from '@lib/help/brand'

/** Top bar of the standalone help site (help.{domain}). */
export default function HelpSiteHeader({ appOrigin }: { appOrigin: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-2" aria-label="ValidBridge Help Center home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/validbridge-text.svg" alt="ValidBridge" className="h-5 w-auto sm:h-6" />
          <span className="hidden border-s border-border ps-2 text-sm font-semibold text-muted-foreground sm:inline">
            Help Center
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <a
            href={COMPANY.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1 rounded-lg px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground md:inline-flex"
          >
            {COMPANY.name}
            <ArrowSquareOut size={12} aria-hidden />
          </a>
          <a
            href={`${appOrigin}/`}
            className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Open ValidBridge
          </a>
        </nav>
      </div>
    </header>
  )
}
