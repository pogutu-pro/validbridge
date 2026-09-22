'use client'
import React, { useRef, useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PlanLevel } from '@services/plans/plans'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { usePlan } from '@components/Hooks/usePlan'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'

export interface DashTabItem {
  key: string
  label: string
  icon: React.ReactNode
  href?: string
  onClick?: () => void
  active: boolean
  disabled?: boolean
  disabledTooltip?: React.ReactNode
  requiresPlan?: PlanLevel
}

interface DashTabBarProps {
  tabs: DashTabItem[]
}

export function DashTabBar({ tabs }: DashTabBarProps) {
  const currentPlan = usePlan()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  // Track scroll state and react to resize
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollState()
    el.addEventListener('scroll', updateScrollState, { passive: true })
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      ro.disconnect()
    }
  }, [updateScrollState])

  // Scroll active tab into view whenever the active key changes.
  // Next.js reuses the component across subpage navigations, so scroll state
  // can persist — we need to bring the new active tab back into view.
  const activeKey = tabs.find((t) => t.active)?.key
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const activeEl = container.querySelector('[data-tab-active]') as HTMLElement | null
    if (!activeEl) return
    const left = activeEl.offsetLeft
    const right = left + activeEl.offsetWidth
    const cLeft = container.scrollLeft
    const cRight = cLeft + container.clientWidth
    if (left < cLeft) {
      container.scrollTo({ left: Math.max(0, left - 8) })
    } else if (right > cRight) {
      container.scrollTo({ left: right - container.clientWidth + 8 })
    }
  }, [activeKey])

  const scroll = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir === 'left' ? -140 : 140, behavior: 'smooth' })
  }, [])

  return (
    // overflow-hidden prevents tabs from blowing out the page layout
    <div className="relative min-w-0 overflow-hidden border-b border-gray-200/80">
      {/* Left gradient + button */}
      <div
        className={`absolute start-0 inset-y-0 w-12 bg-gradient-to-r from-white to-transparent z-10 flex items-center pointer-events-none transition-opacity duration-200 ${
          canScrollLeft ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          onClick={() => scroll('left')}
          aria-label="Scroll tabs left"
          className="pointer-events-auto flex items-center justify-center w-6 h-6 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-gray-900 transition-colors duration-150 shadow-sm"
        >
          <ChevronLeft size={13} strokeWidth={2.5} />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex space-x-6 overflow-x-auto scrollbar-hide pt-1"
      >
        {tabs.map((tab) => {
          const inner = (
            <div className="flex items-center space-x-2">
              {tab.icon}
              <span className="whitespace-nowrap">
                {tab.label}
              </span>
              {tab.requiresPlan && (
                <PlanBadge currentPlan={currentPlan} requiredPlan={tab.requiresPlan} />
              )}
            </div>
          )

          if (tab.disabled) {
            const el = (
              <div className="py-2.5 px-1 font-medium text-sm text-gray-300 border-b-2 border-transparent cursor-not-allowed">
                {inner}
              </div>
            )
            return tab.disabledTooltip ? (
              <ToolTip key={tab.key} content={tab.disabledTooltip}>
                {el}
              </ToolTip>
            ) : (
              <div key={tab.key}>{el}</div>
            )
          }

          const tabClass = `py-2.5 px-1 font-semibold text-sm border-b-2 transition-all duration-150 ease-in-out cursor-pointer ${
            tab.active
              ? 'border-[#FF5A1F] text-[#FF5A1F]'
              : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
          }`

          if (tab.href) {
            return (
              <Link key={tab.key} href={tab.href} prefetch={false}>
                <div className={tabClass} {...(tab.active ? { 'data-tab-active': '' } : {})}>
                  {inner}
                </div>
              </Link>
            )
          }

          if (tab.onClick) {
            return (
              <button key={tab.key} onClick={tab.onClick}>
                <div className={tabClass} {...(tab.active ? { 'data-tab-active': '' } : {})}>
                  {inner}
                </div>
              </button>
            )
          }

          return null
        })}
      </div>

      {/* Right gradient + button */}
      <div
        className={`absolute end-0 inset-y-0 w-12 bg-gradient-to-l from-white to-transparent z-10 flex items-center justify-end pointer-events-none transition-opacity duration-200 ${
          canScrollRight ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          onClick={() => scroll('right')}
          aria-label="Scroll tabs right"
          className="pointer-events-auto flex items-center justify-center w-6 h-6 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-gray-900 transition-colors duration-150 shadow-sm"
        >
          <ChevronRight size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}
