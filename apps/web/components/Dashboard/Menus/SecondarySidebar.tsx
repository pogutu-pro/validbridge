'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { SecondaryNavItem } from './navRegistry'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { usePlan } from '@components/Hooks/usePlan'
import { cn } from '@/lib/utils'

export const SECTION_TABS_SLOT_ID = 'dash-section-tabs'

interface SecondarySidebarProps {
  title: string
  items: SecondaryNavItem[]
  currentPath: string
  searchParams?: string
}

export default function SecondarySidebar({
  title,
  items,
  currentPath,
  searchParams = '',
}: SecondarySidebarProps) {
  const plan = usePlan()
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setSlot(document.getElementById(SECTION_TABS_SLOT_ID))
  }, [])

  if (!items || items.length === 0) return null

  const isItemActive = (item: SecondaryNavItem) => {
    // Exact href match
    if (item.href === currentPath) return true
    
    // Path match without query params or with query params
    const itemPathOnly = item.href.split('?')[0]
    const currentPathOnly = currentPath.split('?')[0]
    
    if (item.href.includes('?')) {
      const itemQuery = item.href.split('?')[1]
      return currentPathOnly === itemPathOnly && (searchParams.includes(itemQuery) || currentPath.includes(itemQuery))
    }
    
    // Subpage matching (e.g. /dash/payments/overview vs subpage param)
    const itemLastSegment = itemPathOnly.split('/').pop()
    const currentLastSegment = currentPathOnly.split('/').pop()
    
    if (itemLastSegment && currentLastSegment && itemLastSegment === currentLastSegment) {
      return true
    }
    
    return currentPath === itemPathOnly
  }

  // Rendered as a tab bar at the top of the page content (the slot sits under
  // the dashboard top bar) rather than a second sidebar column, so section
  // pages keep the full width.
  if (!slot) return null
  return createPortal(
    <nav
      aria-label={`${title} section navigation`}
      className="border-b border-border bg-background/85 backdrop-blur-md"
    >
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide px-4 sm:px-6">
        <span className="me-2 shrink-0 py-2.5 text-sm font-bold text-foreground">{title}</span>
        {items.map((item) => {
          const active = isItemActive(item)
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 px-2.5 py-2.5 text-sm font-medium transition-colors',
                active ? 'text-primary' : 'text-foreground/70 hover:text-foreground'
              )}
            >
              <span className="shrink-0 [&_svg]:size-4">{item.icon}</span>
              <span className="whitespace-nowrap">{item.label}</span>
              {item.requiresPlan && (
                <PlanBadge currentPlan={plan} requiredPlan={item.requiresPlan} variant="dark" />
              )}
              {active && (
                <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-primary" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>,
    slot
  )
}
