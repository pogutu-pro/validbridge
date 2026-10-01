'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, FileText, Lifebuoy, VideoCamera } from '@phosphor-icons/react'
import { HELP_CATEGORIES, POPULAR_ARTICLES, resolveArticlePath, resolveLegacyAnchor, type HelpContext } from '@lib/help'
import {
  ContactSupport,
  HELP_ICONS,
  HelpAttribution,
  HelpSearch,
  articleHref,
  categoryHref,
} from './HelpParts'
import { COMPANY } from '@lib/help/brand'
import { helpHref } from '@lib/help/links'

/** Help Center home: search, topic cards, popular articles and support. */
function HelpCenter({ ctx }: { ctx: HelpContext }) {
  const router = useRouter()

  // The Help Center used to be one long page with `#section` anchors. Send
  // those old links to the article that now holds the content.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    if (!hash) return
    const path = resolveLegacyAnchor(hash)
    if (path) router.replace(helpHref(ctx, path))
  }, [ctx, router])

  const popular = POPULAR_ARTICLES.map(resolveArticlePath).filter(
    (m): m is NonNullable<typeof m> => !!m
  )
  const articleCount = HELP_CATEGORIES.reduce((n, c) => n + c.articles.length, 0)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* Hero */}
      <header className="relative rounded-2xl border border-border bg-card px-5 py-8 sm:px-10 sm:py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
          style={{
            backgroundImage:
              'radial-gradient(circle at 10% 0%, hsl(var(--primary) / 0.14), transparent 45%), radial-gradient(circle at 95% 100%, hsl(var(--primary) / 0.10), transparent 40%)',
          }}
        />
        <div className="relative mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            <Lifebuoy size={14} weight="fill" />
            ValidBridge Help Center
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            How can we help?
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-muted-foreground sm:text-base">
            Step-by-step guides and answers for learners, instructors and admins —{' '}
            {articleCount} articles across {HELP_CATEGORIES.length} topics.
          </p>
          <HelpSearch ctx={ctx} className="mx-auto mt-6 max-w-xl text-start" />
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="text-muted-foreground">Popular:</span>
            {popular.slice(0, 4).map(({ category, article }) => (
              <Link
                key={`${category.id}/${article.id}`}
                href={articleHref(ctx, category.id, article.id)}
                className="rounded-full border border-border bg-background px-3 py-1 font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {article.title}
              </Link>
            ))}
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            ValidBridge is a product of{' '}
            <a
              href={COMPANY.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-foreground underline decoration-primary/40 underline-offset-2 hover:text-primary"
            >
              {COMPANY.name}
            </a>
          </p>
        </div>
      </header>

      {/* What's new: LiveBridge */}
      <Link
        href={categoryHref(ctx, 'livebridge')}
        className="group mt-6 flex items-center gap-4 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 transition-colors hover:bg-primary/10 sm:p-5"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <VideoCamera size={22} weight="fill" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-foreground sm:text-base">
            Teach live with LiveBridge
          </span>
          <span className="block text-sm text-muted-foreground">
            Schedule live classes from any course, share your screen, run polls and quizzes,
            and get recordings and attendance automatically.
          </span>
        </span>
        <ArrowRight
          size={18}
          weight="bold"
          className="hidden shrink-0 text-primary transition-transform group-hover:translate-x-0.5 sm:block rtl:rotate-180"
        />
      </Link>

      {/* Topics */}
      <section aria-labelledby="help-topics" className="mt-10">
        <h2 id="help-topics" className="text-xl font-bold tracking-tight text-foreground">
          Browse by topic
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HELP_CATEGORIES.map((category) => {
            const Icon = HELP_ICONS[category.icon]
            return (
              <Link
                key={category.id}
                href={categoryHref(ctx, category.id)}
                className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon size={20} weight="fill" />
                </span>
                <span className="mt-4 text-base font-semibold text-foreground">{category.title}</span>
                <span className="mt-1 flex-1 text-sm leading-6 text-muted-foreground">
                  {category.description}
                </span>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  {category.articles.length} {category.articles.length === 1 ? 'article' : 'articles'}
                  <ArrowRight size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      {/* Popular articles */}
      <section aria-labelledby="help-popular" className="mt-10">
        <h2 id="help-popular" className="text-xl font-bold tracking-tight text-foreground">
          Popular articles
        </h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {popular.map(({ category, article }) => (
            <li key={`${category.id}/${article.id}`}>
              <Link
                href={articleHref(ctx, category.id, article.id)}
                className="flex h-full items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <FileText size={18} weight="duotone" className="mt-0.5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{article.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[13px] leading-5 text-muted-foreground">
                    {article.summary}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <ContactSupport ctx={ctx} className="mt-10" />

      <HelpAttribution className="mt-10" />
    </div>
  )
}

export default HelpCenter
