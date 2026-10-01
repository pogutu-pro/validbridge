'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Info, Lightbulb, Warning, ArrowRight, CaretDown } from '@phosphor-icons/react'
import { helpHref } from './links'
import type { HelpContext } from './types'
import { cn } from '@/lib/utils'

/** A paragraph with the standard help reading rhythm. */
export function P({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-7 text-foreground">{children}</p>
}

/** A secondary paragraph, for asides under a main paragraph. */
export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-muted-foreground">{children}</p>
}

export function H4({ children }: { children: ReactNode }) {
  return <h4 className="pt-1 text-[15px] font-semibold text-foreground">{children}</h4>
}

/** Inline UI label — mirrors how a button or menu item reads in the product. */
export function UI({ children }: { children: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 align-baseline text-[13px] font-medium text-foreground">
      {children}
    </span>
  )
}

/** A keyboard key. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground shadow-xs">
      {children}
    </kbd>
  )
}

export function ProseLink({
  href,
  children,
  external,
}: {
  href: string
  children: ReactNode
  external?: boolean
}) {
  const cls =
    'inline-flex items-center gap-1 font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary'
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  )
}

const CALLOUT_STYLES = {
  info: {
    wrap: 'border-border bg-muted/50',
    icon: 'text-primary',
    Icon: Info,
  },
  tip: {
    wrap: 'border-primary/25 bg-primary/[0.06]',
    icon: 'text-primary',
    Icon: Lightbulb,
  },
  warn: {
    wrap: 'border-amber-500/25 bg-amber-500/[0.08]',
    icon: 'text-amber-600',
    Icon: Warning,
  },
} as const

export function Callout({
  kind = 'info',
  title,
  children,
}: {
  kind?: keyof typeof CALLOUT_STYLES
  title?: string
  children: ReactNode
}) {
  const s = CALLOUT_STYLES[kind]
  return (
    <div className={cn('flex gap-3 rounded-xl border p-3.5', s.wrap)}>
      <s.Icon size={18} weight="fill" className={cn('mt-0.5 shrink-0', s.icon)} />
      <div className="min-w-0 space-y-1">
        {title ? <p className="text-sm font-semibold text-foreground">{title}</p> : null}
        <div className="text-sm leading-6 text-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline">
          {children}
        </div>
      </div>
    </div>
  )
}

/** A numbered, step-by-step walkthrough. */
export function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="relative space-y-3 border-s border-border ps-5 [counter-reset:step]">
      {children}
    </ol>
  )
}

export function Step({ children }: { children: ReactNode }) {
  return (
    <li className="relative text-[15px] leading-7 text-foreground [counter-increment:step] before:absolute before:-start-[27px] before:flex before:size-5 before:items-center before:justify-center before:rounded-full before:bg-primary before:text-[11px] before:font-bold before:text-primary-foreground before:content-[counter(step)]">
      {children}
    </li>
  )
}

export function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 ps-5 text-[15px] leading-7 text-foreground marker:text-muted-foreground/60">{children}</ul>
}

export function Numbers({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 ps-5 text-[15px] leading-7 text-foreground marker:text-muted-foreground/60">{children}</ol>
}

/** A definition-style list: bold term followed by an explanation. */
export function Defs({ children }: { children: ReactNode }) {
  return <dl className="space-y-2.5">{children}</dl>
}

export function Def({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="text-[15px] leading-7 text-foreground">
      <dt className="inline font-semibold text-foreground">{term}</dt>
      <dd className="inline"> — {children}</dd>
    </div>
  )
}

/** A lightweight table that matches the platform's surfaces. */
export function Table({
  head,
  rows,
}: {
  head: ReactNode[]
  rows: ReactNode[][]
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/60">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 text-start font-semibold text-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 text-foreground">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Inline link to another Help Center article (`to` is `category/article`). */
export function HelpLink({
  ctx,
  to,
  children,
}: {
  ctx: HelpContext
  to: string
  children: ReactNode
}) {
  return <ProseLink href={helpHref(ctx, to)}>{children}</ProseLink>
}

/** A collapsible question and answer, for FAQ-style articles. */
export function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-border bg-card open:bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[15px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        {q}
        <CaretDown
          size={14}
          weight="bold"
          className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t border-border px-4 py-3 text-[15px] leading-7 text-foreground">
        {children}
      </div>
    </details>
  )
}

/** A cross-reference card pointing at another help article. */
export function Jump({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
    >
      <ArrowRight size={14} weight="bold" className="text-primary" />
      {label}
    </Link>
  )
}

/** Inline code: a header name, a DNS value, an event name. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="mx-0.5 break-all rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
      {children}
    </code>
  )
}

/** A short code sample. Scrolls sideways on narrow screens instead of widening the page. */
export function CodeBlock({ title, children }: { title?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-muted/50">
      {title ? (
        <p className="border-b border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">{title}</p>
      ) : null}
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[13px] leading-6 text-foreground">
        <code>{children}</code>
      </pre>
    </div>
  )
}
