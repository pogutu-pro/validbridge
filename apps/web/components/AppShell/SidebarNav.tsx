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
    return <div aria-hidden className="mx-3 my-2 h-px bg-slate-200" />
  }
  return (
    <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400 first:pt-0">
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
        'group relative flex items-center rounded-xl text-sm transition-all duration-150',
        collapsed ? 'mx-auto h-10 w-10 justify-center' : 'gap-3 px-3.5 py-2.5',
        item.disabled
          ? 'cursor-not-allowed text-slate-300'
          : item.active
            ? 'bg-[#D1FADF] text-[#027A48] border border-[#A7F3D0]/70 font-bold shadow-2xs'
            : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 font-medium',
        className
      )}
    >
      <span className={cn("flex shrink-0 items-center justify-center [&_svg]:size-[18px]", item.active ? "text-[#027A48]" : "text-slate-400 group-hover:text-slate-600")}>
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
            className="border-slate-800 bg-slate-900 text-xs text-white px-2.5 py-1 shadow-md"
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
