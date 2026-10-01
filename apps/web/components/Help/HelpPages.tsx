'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, CaretDown, List, ThumbsDown, ThumbsUp } from '@phosphor-icons/react'
import { findArticle, findCategory, type HelpContext } from '@lib/help'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import {
  AudienceBadges,
  Breadcrumbs,
  CategoryNav,
  ContactSupport,
  HELP_ICONS,
  HelpAttribution,
  HelpTopBar,
  articleHref,
  categoryHref,
  helpHome,
} from './HelpParts'

/** Two-column shell: topic sidebar on desktop, a collapsible topic picker on small screens. */
function HelpLayout({
  ctx,
  categoryId,
  articleId,
  children,
}: {
  ctx: HelpContext
  categoryId: string
  articleId?: string
  children: React.ReactNode
}) {
  const [pickerKey, setPickerKey] = useState(0)
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <HelpTopBar ctx={ctx} />

      {/* Topic picker — phones & tablets */}
      <details key={pickerKey} className="group mt-5 rounded-xl border border-border bg-card lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
          <List size={16} weight="bold" className="text-primary" />
          Browse topics
          <CaretDown size={14} weight="bold" className="ms-auto text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border p-2">
          <CategoryNav
            ctx={ctx}
            currentCategory={categoryId}
            currentArticle={articleId}
            onNavigate={() => setPickerKey((k) => k + 1)}
          />
        </div>
      </details>

      <div className="mt-6 lg:grid lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-6 pe-1 scrollbar-hide">
            <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Topics
            </p>
            <CategoryNav ctx={ctx} currentCategory={categoryId} currentArticle={articleId} />
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>

      <HelpAttribution className="mt-12" />
    </div>
  )
}

export function HelpCategoryView({ ctx, categoryId }: { ctx: HelpContext; categoryId: string }) {
  const category = findCategory(categoryId)
  if (!category) return null
  const Icon = HELP_ICONS[category.icon]

  return (
    <HelpLayout ctx={ctx} categoryId={category.id}>
      <Breadcrumbs items={[{ label: 'Help Center', href: helpHome(ctx) }, { label: category.title }]} />
      <header className="mt-4 flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon size={24} weight="fill" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{category.title}</h1>
          <p className="mt-1.5 max-w-2xl text-[15px] leading-7 text-muted-foreground">{category.description}</p>
        </div>
      </header>

      <ul className="mt-8 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {category.articles.map((article) => (
          <li key={article.id}>
            <Link
              href={articleHref(ctx, category.id, article.id)}
              className="group flex items-start gap-4 p-4 transition-colors hover:bg-muted/40 sm:p-5"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-foreground group-hover:text-primary">
                  {article.title}
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">{article.summary}</span>
                <span className="mt-2 block">
                  <AudienceBadges audience={article.audience} />
                </span>
              </span>
              <ArrowRight
                size={16}
                weight="bold"
                className="mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary rtl:rotate-180"
              />
            </Link>
          </li>
        ))}
      </ul>

      <ContactSupport ctx={ctx} className="mt-10" />
    </HelpLayout>
  )
}

function WasThisHelpful() {
  const session = useVBSession() as any
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const btn =
    'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted'

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      {answer === null ? (
        <>
          <p className="text-sm font-semibold text-foreground">Was this article helpful?</p>
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => setAnswer('yes')}>
              <ThumbsUp size={15} weight="bold" className="text-primary" /> Yes
            </button>
            <button type="button" className={btn} onClick={() => setAnswer('no')}>
              <ThumbsDown size={15} weight="bold" className="text-primary" /> No
            </button>
          </div>
        </>
      ) : answer === 'yes' ? (
        <p className="text-sm font-medium text-foreground">Thanks for letting us know!</p>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground">Sorry about that. What was missing?</p>
          <button type="button" className={btn} onClick={() => setFeedbackOpen(true)}>
            Tell us
          </button>
        </>
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

export function HelpArticleView({
  ctx,
  categoryId,
  articleId,
}: {
  ctx: HelpContext
  categoryId: string
  articleId: string
}) {
  const match = findArticle(categoryId, articleId)
  if (!match) return null
  const { category, article, index } = match
  const prev = category.articles[index - 1]
  const next = category.articles[index + 1]

  return (
    <HelpLayout ctx={ctx} categoryId={category.id} articleId={article.id}>
      <article className="max-w-3xl">
        <Breadcrumbs
          items={[
            { label: 'Help Center', href: helpHome(ctx) },
            { label: category.title, href: categoryHref(ctx, category.id) },
            { label: article.title },
          ]}
        />
        <header className="mt-4 border-b border-border pb-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{article.title}</h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">{article.summary}</p>
          <div className="mt-4">
            <AudienceBadges audience={article.audience} />
          </div>
        </header>

        <div className="mt-8 space-y-4">{article.content(ctx)}</div>

        <div className="mt-12">
          <WasThisHelpful key={`${category.id}/${article.id}`} />
        </div>

        {(prev || next) && (
          <nav aria-label="More in this topic" className="mt-6 grid gap-3 sm:grid-cols-2">
            {prev ? (
              <Link
                href={articleHref(ctx, category.id, prev.id)}
                className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ArrowLeft size={12} weight="bold" className="rtl:rotate-180" /> Previous
                </span>
                <span className="mt-1 block text-sm font-semibold text-foreground group-hover:text-primary">
                  {prev.title}
                </span>
              </Link>
            ) : (
              <span className="hidden sm:block" />
            )}
            {next && (
              <Link
                href={articleHref(ctx, category.id, next.id)}
                className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 sm:text-end"
              >
                <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:justify-end">
                  Next <ArrowRight size={12} weight="bold" className="rtl:rotate-180" />
                </span>
                <span className="mt-1 block text-sm font-semibold text-foreground group-hover:text-primary">
                  {next.title}
                </span>
              </Link>
            )}
          </nav>
        )}
      </article>

      <ContactSupport ctx={ctx} className="mt-10" />
    </HelpLayout>
  )
}
