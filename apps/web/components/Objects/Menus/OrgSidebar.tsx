'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Signpost,
  SquaresFour,
  Gear,
  SidebarSimple,
  Broadcast,
} from '@phosphor-icons/react'
import { useMyLiveLessons } from '@/hooks/queries/useLive'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useFocusMode } from '@components/Hooks/useFocusMode'
import { getUriWithOrg } from '@services/config/config'
import { SidebarNav, type SidebarNavGroup, type SidebarNavItem } from '@components/AppShell/SidebarNav'
import { useOrgMenuItems } from '@components/Objects/Menus/OrgMenuLinks'
import OrgSquareLogo from '@components/Objects/Org/OrgSquareLogo'
import { cn } from '@/lib/utils'

export default function OrgSidebar({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useVBSession() as any
  const { rights } = useAdminStatus()
  const pathname = usePathname() || ''
  const isFocusMode = useFocusMode()

  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem('org-menu-collapsed')
    if (saved !== null) setIsCollapsed(saved === 'true')
  }, [])

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('org-menu-collapsed', String(next))
      return next
    })
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/' || pathname === ''
    return pathname === href || pathname.startsWith(href + '/')
  }

  // Resolved before the early return below so hook order stays stable.
  const resolvedMenuItems = useOrgMenuItems(orgslug)
  const { data: myLive } = useMyLiveLessons(org?.id)
  const liveNow = !!myLive?.sessions.some((s) => s.status === 'live')

  if (isFocusMode) return null

  const isAuthenticated = session?.status === 'authenticated'
  const canAccessDashboard = isAuthenticated && rights?.dashboard?.action_access === true

  // The learner's everyday destinations, resolved from the org's own menu
  // configuration so custom links and feature gating are respected.
  const exploreItems: SidebarNavItem[] = resolvedMenuItems.map((it) => ({
    key: it.key,
    href: it.href,
    label: it.label,
    icon: <it.Icon size={18} weight="fill" />,
    external: it.external,
    active: !it.external && isActive(it.href),
  }))

  const liveItem: SidebarNavItem = {
    key: 'live',
    href: getUriWithOrg(orgslug, '/live'),
    label: t('live.my.title'),
    icon: <Broadcast size={18} weight="fill" />,
    active: isActive(getUriWithOrg(orgslug, '/live')),
    trailing: liveNow ? (
      <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white">
        {t('live.status.live')}
      </span>
    ) : undefined,
  }

  // Live lessons sit directly below the marketplace (or at the end of the
  // org's menu when the marketplace is off).
  const storeIndex = exploreItems.findIndex((it) => it.key === 'store')
  const liveAt = storeIndex === -1 ? exploreItems.length : storeIndex + 1
  const learnerItems: SidebarNavItem[] = isAuthenticated
    ? [...exploreItems.slice(0, liveAt), liveItem, ...exploreItems.slice(liveAt)]
    : exploreItems

  // Flat list — no section headings. The organization home is reachable from
  // the brand logo above, so it is not repeated as a nav item; courses (and the
  // rest of the org menu) are the learner's primary destinations.
  const primaryItems: SidebarNavItem[] = [
    ...(isAuthenticated
      ? [
          {
            key: 'trail',
            href: getUriWithOrg(orgslug, '/trail'),
            label: t('courses.progress', { defaultValue: 'My learning' }),
            icon: <Signpost size={18} weight="fill" />,
            active: isActive(getUriWithOrg(orgslug, '/trail')),
          },
        ]
      : []),
    ...learnerItems,
    ...(canAccessDashboard
      ? [
          {
            key: 'dashboard',
            href: '/dash',
            label: t('common.dashboard'),
            icon: <SquaresFour size={18} weight="fill" />,
            active: pathname.startsWith('/dash'),
          },
        ]
      : []),
  ]

  const groups: SidebarNavGroup[] = [
    {
      key: 'primary',
      items: primaryItems,
    },
  ]

  const footerItems: SidebarNavItem[] = isAuthenticated
    ? [
        {
          key: 'account',
          href: '/account/general',
          label: t('user.user_settings'),
          icon: <Gear size={18} weight="fill" />,
          active: pathname.startsWith('/account'),
        },
      ]
    : []

  return (
    <aside
      aria-label={t('dashboard.nav.sidebar_navigation')}
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-e border-border bg-background transition-all duration-300 lg:flex',
        isCollapsed ? 'w-[72px]' : 'w-64'
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          'flex h-16 shrink-0 items-center border-b border-border px-4',
          isCollapsed ? 'justify-center' : 'justify-between'
        )}
      >
        <Link
          href={getUriWithOrg(orgslug, '/')}
          className={cn('flex min-w-0 items-center transition-opacity hover:opacity-80', !isCollapsed && 'gap-3')}
        >
          {org?.logo_image ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-card">
              <OrgSquareLogo org={org} alt="" wideInsetClassName="p-1" fallback={null} />
            </span>
          ) : (
            <img src="/validbridge-dash.svg" alt="ValidBridge" className="h-8 w-8" />
          )}
          {!isCollapsed && (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-foreground">{org?.name}</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('common.learning_platform', { defaultValue: 'Learning platform' })}
              </span>
            </div>
          )}
        </Link>
        {!isCollapsed && (
          <button
            type="button"
            aria-label={t('dashboard.nav.collapse_sidebar')}
            onClick={toggleCollapse}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SidebarSimple size={18} weight="fill" />
          </button>
        )}
      </div>

      {/* Primary navigation */}
      <div className="flex-1 overflow-y-auto py-4 scrollbar-hide">
        <SidebarNav groups={groups} collapsed={isCollapsed} />
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border px-3 py-3">
        {isCollapsed ? (
          <button
            type="button"
            aria-label={t('dashboard.nav.expand_sidebar')}
            onClick={toggleCollapse}
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SidebarSimple size={18} weight="fill" />
          </button>
        ) : (
          <SidebarNav groups={[{ key: 'account', items: footerItems }]} collapsed={isCollapsed} />
        )}
      </div>
    </aside>
  )
}
