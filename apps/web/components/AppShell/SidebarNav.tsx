'use client'
import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip'

export interface SidebarNavItem {
  key: string
  href: string
  label: string
  icon: React.ReactNode
  active?: boolean
  external?: boolean
  onClick?: () => void
  /** Optional adornment rendered at the trailing edge of the label. */
  trailing?: React.ReactNode
  disabled?: boolean
}

export interface SidebarNavGroup {
  key: string
  /** Section heading. Omitted groups render without a label. */
  label?: string
  items: SidebarNavItem[]
}

export function SidebarGroupLabel({
  children,
  collapsed,
}: {
  children: React.ReactNode
  collapsed?: boolean
}) {
  if (collapsed) {
    return <div aria-hidden className="mx-3 my-2 h-px bg-border" />
  }
  return (
    <p className="px-3 pb-1.5 pt-5 text-[10px] font-bold uppercase tracking-wider text-foreground first:pt-0">
      {children}
    </p>
  )
}

export function SidebarNavLink({
  item,
  collapsed,
  className,
}: {
  item: SidebarNavItem
  collapsed?: boolean
  className?: string
}) {
  const content = (
    <div
      className={cn(
        'group relative flex items-center rounded-lg text-sm transition-colors',
        collapsed ? 'mx-auto h-10 w-10 justify-center' : 'gap-3 px-3 py-2',
        item.disabled
          ? 'cursor-not-allowed text-muted-foreground/45'
          : item.active
            ? 'bg-primary/10 font-semibold text-foreground'
            : 'text-foreground hover:bg-muted',
        className
      )}
    >
      {item.active ? (
        <span
          aria-hidden
          className="absolute start-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary"
        />
      ) : null}
      <span className="flex shrink-0 items-center justify-center [&_svg]:size-[18px]">
        {item.icon}
      </span>
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1 truncate text-start">{item.label}</span>
          {item.trailing}
        </>
      ) : null}
    </div>
  )

  const link = item.external ? (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={item.label}
      aria-current={item.active ? 'page' : undefined}
      onClick={item.onClick}
      className={cn(item.disabled && 'pointer-events-none')}
    >
      {content}
    </a>
  ) : (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={item.active ? 'page' : undefined}
      onClick={item.onClick}
      className={cn(item.disabled && 'pointer-events-none')}
    >
      {content}
    </Link>
  )

  if (collapsed) {
    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent
            side="right"
            className="border-border bg-foreground text-xs text-background"
          >
            {item.label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return link
}

export function SidebarNav({
  groups,
  collapsed,
  className,
}: {
  groups: SidebarNavGroup[]
  collapsed?: boolean
  className?: string
}) {
  return (
    <nav
      className={cn('flex flex-col gap-1 px-3', className)}
      aria-label="Primary"
    >
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5">
          {group.label ? (
            <SidebarGroupLabel collapsed={collapsed}>{group.label}</SidebarGroupLabel>
          ) : null}
          {group.items.map((item) => (
            <SidebarNavLink key={item.key} item={item} collapsed={collapsed} />
          ))}
        </div>
      ))}
    </nav>
  )
}
