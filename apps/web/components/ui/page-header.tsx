import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Consistent page header: optional breadcrumb slot, a title/description block
 * and a right-aligned actions cluster. Keeps dashboard sub-pages aligned to the
 * same rhythm instead of each one hand-rolling its own header card.
 */
export function PageHeader({
  breadcrumbs,
  icon,
  title,
  description,
  actions,
  className,
}: {
  breadcrumbs?: React.ReactNode
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {breadcrumbs ? <div>{breadcrumbs}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {icon ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary [&_svg]:size-5">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight text-foreground">{title}</h1>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
