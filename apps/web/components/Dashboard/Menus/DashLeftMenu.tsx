'use client'

import { useOrg } from '@components/Contexts/OrgContext'
import { signOut } from '@components/Contexts/AuthContext'
import {
  House,
  BookOpen,
  Files,
  Users,
  CurrencyCircleDollar,
  Buildings,
  Gear,
  SignOut,
  SidebarSimple,
  ChatsCircle,
  Headphones,
  ChartBar,
  ChalkboardSimple,
  Cube,
  FolderSimple,
  Code,
  ChatCircleDots,
  UserCircle,
  DotsThree,
  CaretDown,
} from '@phosphor-icons/react'
import CommandPaletteTrigger from '@components/Dashboard/CommandPalette/CommandPaletteTrigger'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import UserAvatar from '../../Objects/UserAvatar'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import { billingUrl } from '@services/billing/planIntent'
import { useTranslation } from 'react-i18next'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip'
import {
  HoverMenu,
  HoverMenuContent,
  HoverMenuItem,
  HoverMenuLabel,
  HoverMenuSeparator,
} from '@components/ui/hover-menu'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import OrgSquareLogo, { hasOrgLogo } from '@components/Objects/Org/OrgSquareLogo'
import { cn } from '@/lib/utils'
import { usePlan } from '@components/Hooks/usePlan'
import { PLAN_LABELS, planMeetsRequirement, resolvePlanIdFromOrg } from '@services/plans/plans'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useVBAnalytics, AnalyticsEvent } from '@services/analytics'
import OnboardingSidebarBox from '@components/Dashboard/Onboarding/OnboardingSidebarBox'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import SecondarySidebar from './SecondarySidebar'
import { canSeeSection, dashNavAccess, getPrimarySections, PrimaryNavSection } from './navRegistry'

function NavGroupLabel({ isCollapsed, children }: { isCollapsed: boolean; children: React.ReactNode }) {
  if (isCollapsed) return <div className="my-2 border-t border-border/60" />
  return (
    <div className="px-2.5 pt-3 pb-0.5 text-[11px] font-bold uppercase tracking-wider text-foreground select-none">
      {children}
    </div>
  )
}

function MenuLink({
  href,
  icon,
  label,
  isCollapsed,
  active,
  onClick,
}: {
  href: string
  icon: React.ReactNode
  label: string
  isCollapsed: boolean
  active: boolean
  onClick?: () => void
}) {
  const content = (
    <Link
      href={href}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center w-full rounded-xl transition-all duration-150',
        active
          ? 'bg-primary/10 text-primary font-semibold shadow-2xs'
          : 'text-foreground hover:text-foreground hover:bg-black/[0.04]',
        isCollapsed ? 'justify-center h-9 w-9 my-0.5' : 'px-2.5 py-1.5 gap-2.5'
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute start-0.5 top-1/2 -translate-y-1/2 h-5 w-[3px] bg-primary rounded-full"
        />
      )}
      <span className="shrink-0 flex items-center justify-center">{icon}</span>
      {!isCollapsed && (
        <span className="text-sm font-medium flex-1 truncate text-start">{label}</span>
      )}
    </Link>
  )

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return content
}

function DashLeftMenu() {
  const org = useOrg() as any
  const session = useVBSession() as any
  const { t } = useTranslation()
  const { track } = useVBAnalytics('dashboard')
  const pathname = usePathname() || ''
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)

  const onboarding = useOnboarding()
  const showOnboarding =
    !isCollapsed && onboarding.welcomeSeen && !onboarding.dismissed && !onboarding.allCompleted

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dash-menu-collapsed')
      if (saved !== null) {
        setIsCollapsed(saved === 'true')
      }
    }
  }, [])

  const toggleCollapse = () => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    localStorage.setItem('dash-menu-collapsed', String(newState))
  }

  const plan = resolvePlanIdFromOrg(org)
  const { canManageOrg, rights } = useAdminStatus()
  const access = dashNavAccess(session?.data?.user?.is_superadmin === true, canManageOrg, rights as any)

  if (!org || !session) return null

  // The school's real plan. usePlan() is always 'enterprise' (gating is
  // off in the interface) and the web build always reports mode 'ee'.
  const planLabel = PLAN_LABELS[plan] ?? plan

  const planPillColor =
    plan === 'enterprise' ? 'bg-orange-400/25 text-orange-300' :
    plan === 'business' ? 'bg-orange-400/15 text-orange-300' :
    plan === 'growth' ? 'bg-orange-400/10 text-orange-400' :
    'bg-primary/10 text-foreground'

  async function logOutUI() {
    await signOut({ redirect: true, callbackUrl: getUriWithOrg(org.slug, '/login') })
  }

  const rf = org?.config?.config?.resolved_features
  const isEnabled = (feature: string) => rf?.[feature]?.enabled === true

  const enabledFeatures = {
    library: isEnabled('folders'),
    communities: isEnabled('communities'),
    podcasts: isEnabled('podcasts'),
    boards: isEnabled('boards'),
    playgrounds: isEnabled('playgrounds'),
    payments: isEnabled('payments'),
  }

  const primarySections = getPrimarySections(t, pathname, org.slug, enabledFeatures, canManageOrg).filter((s) =>
    canSeeSection(s.key, access)
  )

  // Determine active primary section based on pathname
  const activeSection = primarySections.find((s) => {
    if (s.key === 'home') return pathname === '/dash' || pathname === '/dash/'
    return pathname.startsWith(s.matchPrefix)
  }) || primarySections[0]

  // Secondary items for contextual sidebar
  const secondaryItems = activeSection?.hasChildren && activeSection?.getChildren
    ? activeSection.getChildren(pathname, org.slug, canManageOrg)
    : []

  const showSecondarySidebar = activeSection?.hasChildren && secondaryItems.length > 0

  // Group sections by category
  const homeSection = primarySections.find((s) => s.group === 'home')
  const learningSections = primarySections.filter((s) => s.group === 'learning')
  const contentSections = primarySections.filter((s) => s.group === 'content')
  const peopleSections = primarySections.filter((s) => s.group === 'people')
  const monetizationSections = primarySections.filter((s) => s.group === 'monetization')
  const adminSections = primarySections.filter((s) => s.group === 'administration')
  const insightSections = primarySections.filter((s) => s.group === 'insights')

  // Features the org has switched off stay reachable from an "Other" menu (as
  // before the sidebar redesign), so admins can still open them. Payments keeps
  // its admin-only gating.
  const disabledFeatures = [
    { key: 'connect', show: !enabledFeatures.communities, href: '/dash/connect', icon: <ChatsCircle size={16} weight="fill" />, label: t('communities.title') },
    { key: 'podcasts', show: !enabledFeatures.podcasts, href: '/dash/podcasts', icon: <Headphones size={16} weight="fill" />, label: t('podcasts.podcasts') },
    { key: 'boards', show: !enabledFeatures.boards, href: '/dash/boards', icon: <ChalkboardSimple size={16} weight="fill" />, label: t('common.boards') },
    { key: 'labs', show: !enabledFeatures.playgrounds, href: '/dash/labs', icon: <Cube size={16} weight="fill" />, label: t('common.playgrounds') },
    { key: 'payments', show: !enabledFeatures.payments && access.payments, href: '/dash/payments/overview', icon: <CurrencyCircleDollar size={16} weight="fill" />, label: t('common.payments') },
  ].filter((f) => f.show)

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex shrink-0 z-30">
        {/* Main Primary Sidebar (Expandable / Collapsible via toggle button) */}
        <nav
          aria-label={t('dashboard.nav.sidebar_navigation', { defaultValue: 'Primary sidebar' })}
          className={cn(
            'flex flex-col text-foreground h-screen sticky top-0 shrink-0 border-e border-border bg-background transition-all duration-300 select-none',
            isCollapsed ? 'w-[64px]' : 'w-56'
          )}
        >
          {/* Header with Logo & Org Name */}
          <div
            className={cn(
              'relative flex items-center h-16 border-b border-border shrink-0 px-3',
              isCollapsed ? 'justify-center' : 'justify-between'
            )}
          >
            <Link
              className={cn(
                'flex items-center transition-opacity hover:opacity-80 min-w-0',
                isCollapsed ? '' : 'space-x-3'
              )}
              href={'/'}
            >
              {planMeetsRequirement(plan, 'starter') && hasOrgLogo(org) ? (
                <div className="h-9 w-9 rounded-lg overflow-hidden bg-white shrink-0 shadow-2xs">
                  <OrgSquareLogo org={org} wideInsetClassName="p-0.5" fallback={null} />
                </div>
              ) : (
                <img
                  src="/validbridge-dash.svg"
                  alt="ValidBridge logo"
                  className="h-8 w-8 shrink-0"
                />
              )}
              {!isCollapsed && (
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold text-sm text-foreground truncate">
                    {org?.name}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 inline-flex w-fit items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider',
                      planPillColor
                    )}
                  >
                    {planLabel}
                  </span>
                </div>
              )}
            </Link>
          </div>

          {/* Search slot / Onboarding Box */}
          <div className={cn('px-2', showOnboarding ? 'pt-2' : 'pt-2.5')}>
            {showOnboarding ? (
              <OnboardingSidebarBox />
            ) : (
              <CommandPaletteTrigger isCollapsed={isCollapsed} />
            )}
          </div>

          {/* Categorized Primary Navigation Items */}
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5 scrollbar-hide">
            <AdminAuthorization authorizationMode="component">
              {/* Home */}
              {homeSection && (
                <MenuLink
                  href={homeSection.href}
                  icon={homeSection.icon}
                  label={homeSection.label}
                  isCollapsed={isCollapsed}
                  active={activeSection.key === 'home'}
                  onClick={() => track(AnalyticsEvent.DashboardNavClicked, { section: 'home' })}
                />
              )}

              {/* Learning Category */}
              {learningSections.length > 0 && (
                <>
                  <NavGroupLabel isCollapsed={isCollapsed}>
                    {t('dashboard.nav.groups.learning', { defaultValue: 'Learning' })}
                  </NavGroupLabel>
                  {learningSections.map((sec) => (
                    <MenuLink
                      key={sec.key}
                      href={sec.href}
                      icon={sec.icon}
                      label={sec.label}
                      isCollapsed={isCollapsed}
                      active={activeSection.key === sec.key}
                      onClick={() => track(AnalyticsEvent.DashboardNavClicked, { section: sec.key })}
                    />
                  ))}
                </>
              )}

              {/* Content Category */}
              {contentSections.length > 0 && (
                <>
                  <NavGroupLabel isCollapsed={isCollapsed}>
                    {t('dashboard.nav.groups.content', { defaultValue: 'Content' })}
                  </NavGroupLabel>
                  {contentSections.map((sec) => (
                    <MenuLink
                      key={sec.key}
                      href={sec.href}
                      icon={sec.icon}
                      label={sec.label}
                      isCollapsed={isCollapsed}
                      active={activeSection.key === sec.key}
                      onClick={() => track(AnalyticsEvent.DashboardNavClicked, { section: sec.key })}
                    />
                  ))}
                </>
              )}

              {/* People Category */}
              {peopleSections.length > 0 && (
                <>
                  <NavGroupLabel isCollapsed={isCollapsed}>
                    {t('dashboard.nav.groups.people', { defaultValue: 'People' })}
                  </NavGroupLabel>
                  {peopleSections.map((sec) => (
                    <MenuLink
                      key={sec.key}
                      href={sec.href}
                      icon={sec.icon}
                      label={sec.label}
                      isCollapsed={isCollapsed}
                      active={activeSection.key === sec.key}
                      onClick={() => track(AnalyticsEvent.DashboardNavClicked, { section: sec.key })}
                    />
                  ))}
                </>
              )}

              {/* Monetization Category */}
              {monetizationSections.length > 0 && (
                <>
                  <NavGroupLabel isCollapsed={isCollapsed}>
                    {t('dashboard.nav.groups.monetization', { defaultValue: 'Monetization' })}
                  </NavGroupLabel>
                  {monetizationSections.map((sec) => (
                    <MenuLink
                      key={sec.key}
                      href={sec.href}
                      icon={sec.icon}
                      label={sec.label}
                      isCollapsed={isCollapsed}
                      active={activeSection.key === sec.key}
                      onClick={() => track(AnalyticsEvent.DashboardNavClicked, { section: sec.key })}
                    />
                  ))}
                </>
              )}

              {/* Administration Category */}
              {adminSections.length > 0 && (
                <>
                  <NavGroupLabel isCollapsed={isCollapsed}>
                    {t('dashboard.nav.groups.administration', { defaultValue: 'Administration' })}
                  </NavGroupLabel>
                  {adminSections.map((sec) => (
                    <MenuLink
                      key={sec.key}
                      href={sec.href}
                      icon={sec.icon}
                      label={sec.label}
                      isCollapsed={isCollapsed}
                      active={activeSection.key === sec.key}
                      onClick={() => track(AnalyticsEvent.DashboardNavClicked, { section: sec.key })}
                    />
                  ))}
                </>
              )}

              {/* Insights Category */}
              {insightSections.length > 0 && (
                <>
                  <NavGroupLabel isCollapsed={isCollapsed}>
                    {t('dashboard.nav.groups.insights', { defaultValue: 'Insights' })}
                  </NavGroupLabel>
                  {insightSections.map((sec) => (
                    <MenuLink
                      key={sec.key}
                      href={sec.href}
                      icon={sec.icon}
                      label={sec.label}
                      isCollapsed={isCollapsed}
                      active={activeSection.key === sec.key}
                      onClick={() => track(AnalyticsEvent.DashboardNavClicked, { section: sec.key })}
                    />
                  ))}
                </>
              )}

              {/* Disabled features shown in an "Other" hover menu */}
              {disabledFeatures.length > 0 && (
                <HoverMenu
                  content={
                    <HoverMenuContent className="w-64">
                      <HoverMenuLabel className="flex items-center justify-between text-foreground font-medium">
                        <span>{t('common.other')}</span>
                        <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/[0.06] text-foreground/50">
                          {t('common.disabled')}
                        </span>
                      </HoverMenuLabel>
                      <HoverMenuSeparator />
                      {disabledFeatures.map((f) => (
                        <HoverMenuItem key={f.key} asChild>
                          <Link
                            href={f.href}
                            onClick={() => track(AnalyticsEvent.DashboardNavClicked, { section: f.key })}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-foreground/60 hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors"
                          >
                            {f.icon}
                            <span>{f.label}</span>
                          </Link>
                        </HoverMenuItem>
                      ))}
                    </HoverMenuContent>
                  }
                >
                  <button
                    aria-label={t('dashboard.nav.other')}
                    className={cn(
                      'flex items-center w-full rounded-xl text-foreground/60 hover:text-foreground hover:bg-black/[0.04] transition-all',
                      isCollapsed ? 'justify-center h-9 w-9 my-0.5' : 'px-2.5 py-1.5 gap-2.5'
                    )}
                  >
                    <span className="relative flex items-center justify-center">
                      <DotsThree size={20} weight="bold" />
                    </span>
                    {!isCollapsed && (
                      <>
                        <span className="text-sm font-medium flex-1 text-start">{t('common.other')}</span>
                        <CaretDown aria-hidden="true" size={14} weight="bold" className="text-foreground/30" />
                      </>
                    )}
                  </button>
                </HoverMenu>
              )}
            </AdminAuthorization>
          </div>

          {/* Plan card: where to upgrade or manage billing, always in reach */}
          {canManageOrg && !isCollapsed && (
            <div className="px-2 pb-2 shrink-0">
              <a
                href={getUriWithoutOrg(billingUrl(org.slug))}
                className="flex items-center gap-2 rounded-xl border border-border bg-black/[0.02] px-2.5 py-2 hover:bg-black/[0.04] transition-colors"
              >
                <CurrencyCircleDollar size={18} weight="fill" className="text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">
                    {t('billing.plan_card_title', { defaultValue: '{{plan}} plan', plan: planLabel })}
                  </div>
                  <div className="text-[11px] text-foreground/60 truncate">
                    {plan === 'enterprise'
                      ? t('billing.plan_card_manage', { defaultValue: 'Manage billing' })
                      : t('billing.plan_card_upgrade', { defaultValue: 'Upgrade or add seats' })}
                  </div>
                </div>
              </a>
            </div>
          )}
          {canManageOrg && isCollapsed && (
            <div className="flex justify-center pb-1 shrink-0">
              <MenuLink
                href={getUriWithoutOrg(billingUrl(org.slug))}
                icon={<CurrencyCircleDollar size={20} weight="fill" />}
                label={t('billing.plan_card_manage', { defaultValue: 'Manage billing' })}
                isCollapsed
                active={false}
              />
            </div>
          )}

          {/* Footer: Account Link, Feedback & Sidebar Toggle */}
          <div
            className={cn(
              'p-2 border-t border-border flex items-center gap-1 shrink-0',
              isCollapsed ? 'flex-col justify-center' : 'justify-between'
            )}
          >
            <MenuLink
              href={getUriWithOrg(org?.slug, '/account')}
              icon={<UserCircle size={20} weight="fill" />}
              label={t('common.account', { defaultValue: 'Account' })}
              isCollapsed={isCollapsed}
              active={pathname.startsWith('/account')}
            />

            <div className={cn('flex items-center gap-1', isCollapsed && 'flex-col') }>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    onClick={toggleCollapse}
                    className="p-2 rounded-xl text-foreground hover:text-foreground hover:bg-black/[0.04] transition-colors shrink-0"
                  >
                    <SidebarSimple
                      size={20}
                      weight="fill"
                      className={cn('transition-transform duration-200', isCollapsed && 'rotate-180 text-primary')}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10}>
                  {isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setFeedbackModalOpen(true)}
                    aria-label={t('common.give_feedback', { defaultValue: 'Feedback' })}
                    className="p-2 rounded-xl text-foreground hover:text-foreground hover:bg-black/[0.04] transition-colors shrink-0"
                  >
                    <ChatCircleDots size={20} weight="fill" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10}>
                  {t('common.give_feedback', { defaultValue: 'Give Feedback' })}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </nav>

        {/* Contextual Secondary Sidebar Panel (opens beside primary sidebar when expandable section is active) */}
        {showSecondarySidebar && (
          <SecondarySidebar
            title={activeSection.label}
            items={secondaryItems}
            currentPath={pathname}
          />
        )}

        {/* Feedback Modal */}
        <FeedbackModal open={feedbackModalOpen} onOpenChange={setFeedbackModalOpen} />
      </div>
    </TooltipProvider>
  )
}

export default DashLeftMenu
