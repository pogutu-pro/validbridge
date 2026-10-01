import * as React from 'react'
import { cn } from '@/lib/utils'

type StatTone = 'primary' | 'blue' | 'green' | 'violet' | 'amber' | 'neutral'

const TONE_CLASSES: Record<StatTone, string> = {
  primary: 'bg-primary/10 text-primary',
  blue: 'bg-blue-500/10 text-blue-600',
  green: 'bg-emerald-500/10 text-emerald-600',
  violet: 'bg-orange-500/10 text-orange-600',
  amber: 'bg-amber-500/10 text-amber-600',
  neutral: 'bg-muted text-muted-foreground',
}

/**
 * Compact metric card. `value` may be any node (e.g. animated number) and
 * `hint` is reserved for a secondary line such as a delta or context label.
 */
export function StatCard({
  icon,
  label,
  value,
  hint,
  tone = 'primary',
  href,
  className,
}: {
  icon?: React.ReactNode
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: StatTone
  href?: string
  className?: string
}) {
  const body = (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors',
        href && 'hover:border-primary/40 hover:bg-primary/[0.02]',
        className
      )}
    >
      {icon ? (
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px]',
            TONE_CLASSES[tone]
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xl font-bold leading-tight tracking-tight text-foreground tabular-nums">
          {value}
        </p>
        {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  )

  if (href) {
    return (
      <a href={href} className="block focus:outline-none">
        {body}
      </a>
    )
  }
  return body
}
