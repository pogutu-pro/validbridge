'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Rocket,
  GraduationCap,
  ChalkboardTeacher,
  Buildings,
  Lifebuoy,
  Book,
  ArrowUp,
  List,
  ChatCircleDots,
  DiscordLogo,
} from '@phosphor-icons/react'
import { HELP_SECTIONS, type HelpIcon } from '@lib/help'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { cn } from '@/lib/utils'

const ICONS: Record<HelpIcon, React.ComponentType<any>> = {
  rocket: Rocket,
  graduation: GraduationCap,
  chalkboard: ChalkboardTeacher,
  buildings: Buildings,
  lifebuoy: Lifebuoy,
}

function HelpCenter({ orgslug }: { orgslug: string }) {
  const session = useVBSession() as any
  const [activeId, setActiveId] = useState<string>(HELP_SECTIONS[0]?.subsections[0]?.id ?? '')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [showTop, setShowTop] = useState(false)
  const tocRef = useRef<HTMLDivElement>(null)

  // All subsection ids, in document order — used for the scroll spy and the TOC.
  const allIds = useMemo(
    () => HELP_SECTIONS.flatMap((s) => s.subsections.map((sub) => sub.id)),
    []
  )

  // Scroll spy: highlight the subsection nearest the top of the viewport.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target.id) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 }
    )
    for (const id of allIds) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [allIds])

  // Deep links (#subsection) arrive before client content mounts; scroll once ready.
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (!hash) return
    const timer = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [])

  // Show the "back to top" affordance after the reader has scrolled a screenful.
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 700)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Keep the active TOC item in view as the reader moves down the page.
  useEffect(() => {
    const active = tocRef.current?.querySelector<HTMLElement>(`[data-toc="${activeId}"]`)
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const goTo = useCallback((e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - 88
    window.scrollTo({ top, behavior: 'smooth' })
    window.history.replaceState(null, '', `#${id}`)
    setActiveId(id)
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero */}
      <header className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 12% 20%, hsl(var(--primary) / 0.18), transparent 42%), radial-gradient(circle at 88% 0%, hsl(var(--primary) / 0.12), transparent 40%)',
          }}
        />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            <Lifebuoy size={13} weight="fill" />
            Help Center
          </span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            How to use ValidBridge
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-7 text-muted-foreground">
            A complete, section-by-section guide to every feature — for learners,
            instructors and administrators. Start with{' '}
            <a
              href="#welcome"
              onClick={(e) => goTo(e, 'welcome')}
              className="font-medium text-primary underline decoration-primary/30 underline-offset-2"
            >
              the basics
            </a>{' '}
            or jump to the section you need.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a
              href="https://docs.validbridge.co.ke"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Book size={16} weight="fill" className="text-primary" />
              Documentation site
            </a>
            <a
              href="https://discord.gg/CMyZjjYZ6x"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <DiscordLogo size={16} weight="fill" className="text-primary" />
              Community Discord
            </a>
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <ChatCircleDots size={16} weight="fill" className="text-primary" />
              Report an issue
            </button>
          </div>
        </div>
      </header>

      {/* Section quick-jump — mobile & tablet */}
      <nav aria-label="Help sections" className="mt-6 lg:hidden">
        <details className="group rounded-xl border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground">
            <List size={16} weight="bold" className="text-primary" />
            Jump to a section
          </summary>
          <div className="border-t border-border p-2">
            {HELP_SECTIONS.map((section) => {
              const Icon = ICONS[section.icon]
              return (
                <div key={section.id} className="py-1">
                  <a
                    href={`#${section.subsections[0]?.id}`}
                    onClick={(e) => section.subsections[0] && goTo(e, section.subsections[0].id)}
                    className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-foreground hover:bg-muted"
                  >
                    <Icon size={16} weight="fill" className="text-primary" />
                    {section.title}
                  </a>
                  <div className="ms-6 flex flex-col">
                    {section.subsections.map((sub) => (
                      <a
                        key={sub.id}
                        href={`#${sub.id}`}
                        onClick={(e) => goTo(e, sub.id)}
                        className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {sub.title}
                      </a>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </details>
      </nav>

      <div className="mt-6 lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-10">
        {/* Sticky table of contents — desktop */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-8 pe-1 scrollbar-hide" ref={tocRef}>
            <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              On this page
            </p>
            <nav aria-label="Table of contents" className="space-y-4">
              {HELP_SECTIONS.map((section) => {
                const Icon = ICONS[section.icon]
                return (
                  <div key={section.id}>
                    <div className="flex items-center gap-2 px-2 py-1">
                      <Icon size={14} weight="fill" className="text-primary" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                        {section.title}
                      </span>
                    </div>
                    <ul className="mt-0.5 space-y-0.5 border-s border-border ps-2">
                      {section.subsections.map((sub) => (
                        <li key={sub.id}>
                          <a
                            href={`#${sub.id}`}
                            data-toc={sub.id}
                            onClick={(e) => goTo(e, sub.id)}
                            className={cn(
                              'block rounded-md px-2 py-1.5 text-[13px] leading-snug transition-colors',
                              activeId === sub.id
                                ? 'bg-primary/10 font-semibold text-primary'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                          >
                            {sub.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <main className="min-w-0">
          {HELP_SECTIONS.map((section, si) => {
            const Icon = ICONS[section.icon]
            return (
              <section key={section.id} id={section.id} className={cn(si > 0 && 'mt-14')}>
                <div className="flex items-start gap-3 border-b border-border pb-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon size={20} weight="fill" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                      {section.title}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{section.tagline}</p>
                  </div>
                </div>

                <div className="mt-8 space-y-12">
                  {section.subsections.map((sub) => (
                    <article key={sub.id} id={sub.id} className="scroll-mt-24">
                      <h3 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
                        {sub.title}
                      </h3>
                      <div className="space-y-4">{sub.content(orgslug)}</div>
                    </article>
                  ))}
                </div>
              </section>
            )
          })}

          {/* Footer help card */}
          <div className="mt-14 rounded-2xl border border-border bg-muted/40 p-6">
            <h3 className="text-base font-semibold text-foreground">Need more help?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask the AI Copilot, browse the documentation, or send us feedback.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={getUriWithOrg(orgslug, '/copilot')}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Ask AI
              </Link>
              <a
                href="https://docs.validbridge.co.ke"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Documentation
              </a>
              <button
                type="button"
                onClick={() => setFeedbackOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Report an issue
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* Back to top */}
      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className="fixed bottom-24 end-5 z-[80] flex size-10 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-lg transition-colors hover:bg-muted lg:bottom-8"
        >
          <ArrowUp size={18} weight="bold" />
        </button>
      )}

      <FeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        theme="light"
        userName={session?.data?.user?.username}
        userEmail={session?.data?.user?.email}
      />
    </div>
  )
}

export default HelpCenter