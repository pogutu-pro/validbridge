'use client'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Fixed application topbar. It is intentionally slot-based: the dashboard and
 * the learner workspace each supply their own left context (breadcrumb / page
 * title), centre (global search) and right cluster (actions, profile), while
 * the height, border, blur and layering stay consistent across the product.
 */
export function AppTopbar({
  left,
  center,
  right,
  className,
  sticky = true,
}: {
  left?: React.ReactNode
  center?: React.ReactNode
  right?: React.ReactNode
  className?: string
  sticky?: boolean
}) {
  return (
    <header
      className={cn(
        'flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6',
        sticky && 'sticky top-0 z-[var(--z-sticky-header)]',
        className
      )}
    >
      {left ? <div className="flex min-w-0 items-center gap-3">{left}</div> : null}
      {center ? (
        <div className="hidden flex-1 justify-center px-4 md:flex">{center}</div>
      ) : (
        <div className="hidden flex-1 md:block" />
      )}
      {right ? <div className="ms-auto flex items-center gap-1.5">{right}</div> : null}
    </header>
  )
}

export function TopbarIconButton({
  label,
  onClick,
  children,
  className,
  badge,
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
  className?: string
  badge?: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-[18px]',
        className
      )}
    >
      {children}
      {badge ? (
        <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

/**
 * Collapsed global-search affordance shown in the topbar. Mirrors the command
 * palette trigger already used in the sidebar but sized for the topbar.
 */
export function TopbarSearchButton({
  onClick,
  placeholder = 'Search',
  className,
}: {
  onClick?: () => void
  placeholder?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground',
        className
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="size-4 shrink-0"
        aria-hidden
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <span className="flex-1 truncate text-start">{placeholder}</span>
      <kbd className="hidden shrink-0 items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
        ⌘K
      </kbd>
    </button>
  )
}
