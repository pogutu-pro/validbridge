'use client'

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Rocket,
  BookOpen,
  VideoCamera,
  Users,
  Exam,
  CreditCard,
  ChartBar,
  Buildings,
  PlugsConnected,
  ShieldCheck,
  Sparkle,
  ChatsCircle,
  Lifebuoy,
  MagnifyingGlass,
  CaretRight,
  EnvelopeSimple,
  ChatCircleDots,
  ArrowSquareOut,
  X,
} from '@phosphor-icons/react'
import { HELP_CATEGORIES, type HelpAudience, type HelpContext, type HelpIcon } from '@lib/help'
import { COMPANY, SUPPORT_EMAIL } from '@lib/help/brand'
import { buildHelpIndex, searchHelp, tokenize, type HelpSearchResult } from '@lib/help/search'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { appHref, helpHref } from '@lib/help/links'
import { cn } from '@/lib/utils'

export const HELP_ICONS: Record<HelpIcon, React.ComponentType<any>> = {
  rocket: Rocket,
  book: BookOpen,
  video: VideoCamera,
  users: Users,
  exam: Exam,
  card: CreditCard,
  chart: ChartBar,
  buildings: Buildings,
  plug: PlugsConnected,
  shield: ShieldCheck,
  sparkle: Sparkle,
  chats: ChatsCircle,
  lifebuoy: Lifebuoy,
}

export const helpHome = (ctx: HelpContext) => helpHref(ctx)
export const categoryHref = (ctx: HelpContext, categoryId: string) => helpHref(ctx, categoryId)
export const articleHref = (ctx: HelpContext, categoryId: string, articleId: string) =>
  helpHref(ctx, `${categoryId}/${articleId}`)

const AUDIENCE_LABEL: Record<HelpAudience, string> = {
  everyone: 'Everyone',
  learners: 'Learners',
  instructors: 'Instructors',
  admins: 'Admins',
}

export function AudienceBadges({ audience }: { audience: HelpAudience[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {audience.map((a) => (
        <span
          key={a}
          className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
        >
          {AUDIENCE_LABEL[a]}
        </span>
      ))}
    </div>
  )
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1 text-muted-foreground">
        {items.map((item, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <CaretRight size={12} weight="bold" className="shrink-0 rtl:rotate-180" aria-hidden />}
            {item.href ? (
              <Link href={item.href} className="truncate hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className="truncate font-medium text-foreground" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Wrap each query token in `text` with a highlight. */
function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return <>{text}</>
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  )
}

/**
 * Client-side full-text search over every help article. Results open in a
 * listbox under the input; ↑/↓ move, Enter opens, Esc clears. Press "/"
 * anywhere on the page to focus it.
 */
export function HelpSearch({
  ctx,
  size = 'lg',
  className,
}: {
  ctx: HelpContext
  size?: 'lg' | 'sm'
  className?: string
}) {
  const router = useRouter()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const index = useMemo(() => buildHelpIndex(HELP_CATEGORIES, ctx), [ctx])
  const results: HelpSearchResult[] = useMemo(() => searchHelp(index, query), [index, query])
  const tokens = useMemo(() => tokenize(query), [query])
  const showPanel = open && query.trim().length > 0

  // "/" focuses the search box unless the reader is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close the results when clicking outside.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const go = useCallback(
    (r: HelpSearchResult) => {
      setOpen(false)
      router.push(articleHref(ctx, r.categoryId, r.articleId))
    },
    [ctx, router]
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const r = results[active]
      if (r) {
        e.preventDefault()
        go(r)
      }
    } else if (e.key === 'Escape') {
      if (query) setQuery('')
      else inputRef.current?.blur()
      setOpen(false)
    }
  }

  const lg = size === 'lg'

  return (
    <div ref={wrapRef} className={cn('relative w-full', className)}>
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search help articles
      </label>
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl border border-border bg-background shadow-xs transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
          lg ? 'h-12 px-4 sm:h-14' : 'h-10 px-3'
        )}
      >
        <MagnifyingGlass size={lg ? 20 : 16} weight="bold" className="shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={lg ? 'Search for answers — e.g. “schedule a live lesson”' : 'Search help…'}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden',
            lg ? 'text-base' : 'text-sm'
          )}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={14} weight="bold" />
          </button>
        ) : (
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground sm:inline">
            /
          </kbd>
        )}
      </div>

      {showPanel && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
          {results.length > 0 ? (
            <ul id={listId} role="listbox" aria-label="Help articles" className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
              {results.map((r, i) => (
                <li
                  key={`${r.categoryId}/${r.articleId}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(r)}
                  className={cn(
                    'cursor-pointer rounded-lg px-3 py-2.5 text-start',
                    i === active ? 'bg-primary/10' : 'hover:bg-muted'
                  )}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">{r.categoryTitle}</p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">
                    <Highlight text={r.title} tokens={tokens} />
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                    <Highlight text={r.snippet} tokens={tokens} />
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <div id={listId} role="listbox" aria-label="Help articles" className="px-4 py-5 text-sm">
              <p className="font-semibold text-foreground">No articles match “{query.trim()}”.</p>
              <p className="mt-1 text-muted-foreground">
                Try different words, browse the topics below, or{' '}
                <Link
                  href={articleHref(ctx, 'troubleshooting', 'getting-help')}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  contact support
                </Link>
                .
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** "Still need help?" block with support channels. */
export function ContactSupport({ ctx, className }: { ctx: HelpContext; className?: string }) {
  const session = useVBSession() as any
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const channels = [
    {
      icon: EnvelopeSimple,
      title: 'Email support',
      body: SUPPORT_EMAIL,
      href: `mailto:${SUPPORT_EMAIL}`,
      external: true,
    },
    {
      icon: Sparkle,
      title: 'Ask the AI Copilot',
      body: 'Instant answers about your course material.',
      href: appHref(ctx, '/copilot'),
      external: false,
    },
  ]

  return (
    <section
      aria-labelledby="help-contact-heading"
      className={cn('rounded-2xl border border-border bg-card p-5 sm:p-6', className)}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="help-contact-heading" className="text-lg font-bold tracking-tight text-foreground">
            Still need help?
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            Questions about access, grades or a payment to your school? Your instructor or
            organization admin can usually sort it fastest. For anything else, our support
            team is here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <ChatCircleDots size={16} weight="fill" />
          Report an issue
        </button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {channels.map(({ icon: Icon, title, body, href, external }) => {
          const inner = (
            <>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon size={18} weight="fill" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                  {title}
                  {external && href.startsWith('http') && (
                    <ArrowSquareOut size={12} className="text-muted-foreground" aria-hidden />
                  )}
                </span>
                <span className="block truncate text-[13px] text-muted-foreground">{body}</span>
              </span>
            </>
          )
          const cls =
            'flex items-center gap-3 rounded-xl border border-border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-muted/50'
          return external ? (
            <a key={title} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className={cls}>
              {inner}
            </a>
          ) : (
            <Link key={title} href={href} className={cls}>
              {inner}
            </Link>
          )
        })}
      </div>
      <FeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        theme="light"
        userName={session?.data?.user?.username}
        userEmail={session?.data?.user?.email}
      />
    </section>
  )
}

/** Footer line crediting Stratnovo Systems. */
export function HelpAttribution({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        'flex flex-col items-center justify-between gap-2 border-t border-border pt-6 text-center text-sm text-muted-foreground sm:flex-row sm:text-start',
        className
      )}
    >
      <p>
        ValidBridge is built and supported by{' '}
        <a
          href={COMPANY.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-foreground underline decoration-primary/40 underline-offset-2 hover:text-primary"
        >
          {COMPANY.name}
        </a>
        .
      </p>
      <div className="flex items-center gap-4">
        <a href={COMPANY.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
          {COMPANY.domain}
          <ArrowSquareOut size={12} aria-hidden />
        </a>
      </div>
    </footer>
  )
}

/** Category list used in article/category sidebars and the mobile topic picker. */
export function CategoryNav({
  ctx,
  currentCategory,
  currentArticle,
  onNavigate,
}: {
  ctx: HelpContext
  currentCategory?: string
  currentArticle?: string
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Help topics" className="space-y-1">
      {HELP_CATEGORIES.map((category) => {
        const Icon = HELP_ICONS[category.icon]
        const isCurrent = category.id === currentCategory
        return (
          <div key={category.id}>
            <Link
              href={categoryHref(ctx, category.id)}
              onClick={onNavigate}
              aria-current={isCurrent && !currentArticle ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                isCurrent
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon size={16} weight={isCurrent ? 'fill' : 'regular'} className={isCurrent ? 'text-primary' : undefined} />
              <span className="truncate">{category.title}</span>
            </Link>
            {isCurrent && (
              <ul className="mb-2 ms-4 mt-0.5 space-y-0.5 border-s border-border ps-2">
                {category.articles.map((article) => {
                  const active = article.id === currentArticle
                  return (
                    <li key={article.id}>
                      <Link
                        href={articleHref(ctx, category.id, article.id)}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'block rounded-md px-2 py-1.5 text-[13px] leading-snug transition-colors',
                          active
                            ? 'bg-primary/10 font-semibold text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {article.title}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}

/** Compact header strip shown above category and article pages. */
export function HelpTopBar({ ctx }: { ctx: HelpContext }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
      <Link href={helpHome(ctx)} className="inline-flex items-center gap-2 text-foreground">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Lifebuoy size={18} weight="fill" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-base font-bold tracking-tight">Help Center</span>
          <span className="text-[11px] text-muted-foreground">ValidBridge by {COMPANY.name}</span>
        </span>
      </Link>
      <HelpSearch ctx={ctx} size="sm" className="sm:max-w-sm" />
    </div>
  )
}
