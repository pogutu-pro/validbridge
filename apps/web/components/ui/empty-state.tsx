import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Shared, polished empty state used across the LMS. Consolidates the many
 * ad-hoc "nothing here yet" blocks found throughout the dashboard so they
 * share one visual language: soft icon tile, clear title, helpful description
 * and a single primary action.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  secondaryAction?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className
      )}
    >
      {icon ? (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}
