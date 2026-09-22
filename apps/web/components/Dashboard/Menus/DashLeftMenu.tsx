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
  Globe,
  Question,
  Gear,
  SignOut,
  SidebarSimple,
  Check,
  CaretDown,
  PencilSimple,
  ChatsCircle,
  Book,
  ChatCircleDots,
  Headphones,
  ChartBar,
  DotsThree,
  UsersThree,
  Shield,
  UserPlus,
  ClipboardText,
  Palette,
  Rocket,
  Robot,
  LinkSimple,
  Key,
  Lock,
  Wrench,
  ChartLine,
  MagnifyingGlass,
  ChalkboardSimple,
  Cube,
  ShoppingBag,
  Receipt,
  FolderSimple,
  Plus,
  Code,
  Lightning,
  Lifebuoy,
} from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { DiscordIcon } from '@components/Objects/Icons/DiscordIcon'
import CommandPaletteTrigger from '@components/Dashboard/CommandPalette/CommandPaletteTrigger'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useState, useCallback } from 'react'
import UserAvatar from '../../Objects/UserAvatar'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getUriWithOrg, getAPIUrl, getMainDomainUri, isMultiOrgModeEnabled } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@components/ui/tooltip"
import {
  HoverMenu,
  HoverMenuContent,
  HoverMenuItem,
  HoverMenuLabel,
  HoverMenuSeparator,
} from "@components/ui/hover-menu"
import { SidebarGroupLabel } from '@components/AppShell/SidebarNav'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import OrgSquareLogo, { hasOrgLogo } from '@components/Objects/Org/OrgSquareLogo'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'
import { getAssignmentsFromACourse } from '@services/courses/assignments'
import { getDeploymentMode } from '@services/config/config'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { usePlan } from '@components/Hooks/usePlan'
import { planMeetsRequirement } from '@services/plans/plans'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useVBAnalytics, AnalyticsEvent } from '@services/analytics'
import OnboardingSidebarBox from '@components/Dashboard/Onboarding/OnboardingSidebarBox'
import { useOnboarding } from '@components/Hooks/useOnboarding'

// Scattered night-sky starfield for the free-plan upgrade box. Fixed positions
// (top/left %) so the constellation is stable across renders; `north` is the
// brighter amber guide star. dim/bright drive the idle twinkle amplitude.
const UPGRADE_STARS: {
  top: string; left: string; size: number; delay: number; dim: number; bright: number; north?: boolean
}[] = [
  { top: '8%', left: '50%', size: 2.5, delay: 0.0, dim: 0.5, bright: 1, north: true },
  { top: '14%', left: '12%', size: 1, delay: 0.6, dim: 0.15, bright: 0.6 },
  { top: '10%', left: '30%', size: 1.5, delay: 1.1, dim: 0.2, bright: 0.7 },
  { top: '22%', left: '20%', size: 1, delay: 0.3, dim: 0.15, bright: 0.55 },
  { top: '30%', left: '38%', size: 1, delay: 1.5, dim: 0.1, bright: 0.5 },
  { top: '18%', left: '66%', size: 1.5, delay: 0.9, dim: 0.2, bright: 0.75 },
  { top: '26%', left: '78%', size: 1, delay: 0.2, dim: 0.15, bright: 0.6 },
  { top: '12%', left: '88%', size: 1, delay: 1.8, dim: 0.1, bright: 0.5 },
  { top: '34%', left: '60%', size: 1, delay: 1.3, dim: 0.15, bright: 0.55 },
  { top: '6%', left: '72%', size: 1, delay: 0.5, dim: 0.1, bright: 0.5 },
  { top: '32%', left: '90%', size: 1.5, delay: 1.0, dim: 0.2, bright: 0.65 },
  { top: '20%', left: '44%', size: 1, delay: 2.0, dim: 0.1, bright: 0.45 },
]

function DashLeftMenu() {
  const org = useOrg() as any
  const session = useVBSession() as any
  const { t, i18n } = useTranslation()
  const { track } = useVBAnalytics('dashboard')
  const pathname = usePathname() || ''
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [upgradeHovered, setUpgradeHovered] = useState(false)

  // Single active accordion group state
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  useEffect(() => {
    if (pathname.startsWith('/dash/users')) {
      setOpenGroup(t('common.users'))
    } else if (pathname.startsWith('/dash/org')) {
      setOpenGroup(t('common.organization'))
    } else if (pathname.startsWith('/dash/developers')) {
      setOpenGroup(t('dashboard.developers.breadcrumb', { defaultValue: 'Developers' }))
    } else if (pathname.startsWith('/dash/courses')) {
      setOpenGroup(t('courses.courses'))
    } else if (pathname.startsWith('/dash/assignments')) {
      setOpenGroup(t('common.assignments'))
    } else if (pathname.startsWith('/dash/payments')) {
      setOpenGroup(t('common.payments'))
    } else if (pathname.startsWith('/dash/analytics')) {
      setOpenGroup(t('common.analytics'))
    } else {
      setOpenGroup(null)
    }
  }, [pathname, t])

  const handleToggleGroup = useCallback((groupLabel: string) => {
    setOpenGroup((prev) => (prev === groupLabel ? null : groupLabel))
  }, [])
  // Onboarding takes over the search slot until setup is complete / dismissed.
  const onboarding = useOnboarding()
  const showOnboarding =
    !isCollapsed && onboarding.welcomeSeen && !onboarding.dismissed && !onboarding.allCompleted

  const isActivePath = (path: string) => {
    if (path === '/dash') {
      return pathname === '/dash' || pathname === '/dash/'
    }
    return pathname === path || pathname.startsWith(path + '/')
  }
  const [recentAssignments, setRecentAssignments] = useState<any[]>([])
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const access_token = session?.data?.tokens?.access_token

  // Fetch recent courses
  const { data: coursesData } = useQuery({
    queryKey: [...queryKeys.courses.list(org?.slug || ''), 'recent', 8],
    queryFn: async () => {
      const url = `${getAPIUrl()}courses/org_slug/${org.slug}/page/1/limit/8`
      const res = await fetch(url, RequestBodyWithAuthHeader('GET', null, null, access_token))
      if (!res.ok) throw new Error('Failed to fetch courses')
      return res.json()
    },
    enabled: !!org?.slug,
    staleTime: 60_000,
  })
  const recentCourses = coursesData?.slice(0, 8) || []

  // Lazy-load assignments only when the assignments hover menu is opened
  const [assignmentsFetched, setAssignmentsFetched] = useState(false)

  const fetchAssignments = () => {
    if (assignmentsFetched || !coursesData || !access_token) return
    setAssignmentsFetched(true)
    const coursesToFetch = coursesData.slice(0, 5)
    const promises = coursesToFetch.map((course: any) =>
      getAssignmentsFromACourse(course.course_uuid, access_token)
    )
    Promise.all(promises).then((results) => {
      const allAssignments: any[] = []
      results.forEach((res: any, index: number) => {
        if (res?.data) {
          res.data.forEach((assignment: any) => {
            allAssignments.push({
              ...assignment,
              courseName: coursesToFetch[index].name
            })
          })
        }
      })
      setRecentAssignments(allAssignments.slice(0, 8))
    }).catch(() => {})
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dash-menu-collapsed')
      if (saved !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsCollapsed(saved === 'true')
      }
    }
  }, [])

  const toggleCollapse = () => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    localStorage.setItem('dash-menu-collapsed', String(newState))
  }


  async function logOutUI() {
    await signOut({ redirect: true, callbackUrl: getUriWithOrg(org.slug, '/login') })
  }


  const plan = usePlan()
  const mode = getDeploymentMode()
  // Only org managers (admins/superadmins) see billing surfaces — non-admins
  // shouldn't manage the plan/subscription.
  const { canManageOrg, rights } = useAdminStatus()

  if (!org || !session) return null

  const isSuperadmin = session?.data?.user?.is_superadmin === true
  const canManageUsers = isSuperadmin || canManageOrg || rights?.users?.action_read === true || rights?.users?.action_update === true || rights?.users?.action_create === true
  const canManageOrgSettings = isSuperadmin || canManageOrg || rights?.organizations?.action_read === true
  const canManageDevs = isSuperadmin || canManageOrg
  const planLabel =
    mode === 'ee' ? 'Enterprise Edition' :
    mode === 'oss' ? 'OSS' :
    plan  // SaaS: show actual plan name

  // Multi-org (SaaS) hub: the apex /home, /new, /billing routes only exist in
  // multi tenancy. The user's organizations (deduped) come from the session.
  const multiOrg = isMultiOrgModeEnabled()
  const myOrgs: any[] = (() => {
    const roles = session?.data?.roles || []
    const seen = new Set<number>()
    const orgs: any[] = []
    for (const r of roles) {
      const o = r?.org
      if (o && o.id != null && !seen.has(o.id)) { seen.add(o.id); orgs.push(o) }
    }
    return orgs
  })()
  const planPillColor =
    mode === 'ee' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
    mode === 'oss' ? 'bg-green-50 text-green-700 border border-green-200' :
    plan === 'enterprise' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
    plan === 'pro' ? 'bg-orange-50 text-[#FF5A1F] border border-orange-200' :
    'bg-orange-50 text-[#FF5A1F] border border-orange-200'

  // Feature visibility from API resolved_features
  const rf = org?.config?.config?.resolved_features
  const isEnabled = (feature: string) => rf?.[feature]?.enabled === true

  const showLibrary = isEnabled('folders')
  const showCommunities = isEnabled('communities')
  const showPodcasts = isEnabled('podcasts')
  const showBoards = isEnabled('boards')
  const showPlaygrounds = isEnabled('playgrounds')
  const showPayments = isEnabled('payments')
  const hasContent = showLibrary || showCommunities || showPodcasts || showBoards || showPlaygrounds

  return (
    <TooltipProvider delayDuration={0}>
    <nav
      aria-label={t('dashboard.nav.sidebar_navigation')}
      className={cn(
        "flex flex-col text-slate-800 h-screen sticky top-0 z-overlay border-e border-slate-200 bg-white transition-all duration-300 shadow-sm",
        isCollapsed ? "w-[72px]" : "w-64"
      )}
    >
      {/* Header with Logo and Toggle */}
      <div className={cn(
        "relative flex items-center h-16 border-b border-slate-200 px-4 shrink-0 bg-white",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        <Link
          className={cn("flex items-center transition-opacity hover:opacity-70", isCollapsed ? "" : "space-x-3")}
          href={'/'}
        >
          {planMeetsRequirement(plan, 'standard') && hasOrgLogo(org) ? (
            <div className="h-9 w-9 rounded-lg overflow-hidden bg-white shrink-0">
              <OrgSquareLogo org={org} wideInsetClassName="p-1" fallback={null} />
            </div>
          ) : (
            <img
              src="/validbridge-dash.svg"
              alt="ValidBridge logo"
              className="h-8 w-8"
            />
          )}
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-sm text-foreground truncate">
                {org?.name}
              </span>
              <span className={cn(
                "mt-0.5 inline-flex w-fit items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider",
                planPillColor
              )}>
                {planLabel}
              </span>
            </div>
          )}
        </Link>

        {!isCollapsed && (
          <button
            aria-label={t('dashboard.nav.collapse_sidebar')}
            onClick={toggleCollapse}
            className="p-2 rounded-lg text-foreground hover:text-foreground hover:bg-black/[0.04] transition-all"
          >
            <SidebarSimple size={18} weight="fill" />
          </button>
        )}

        {/* Onboarding progress reuses this header's bottom border as its track —
            a neon orange gradient that glows out from the border. */}
        {showOnboarding && (
          <>
            {/* faint full-width track so the border reads as orange even at 0% */}
            <div className="absolute -bottom-px start-0 end-0 h-[2px] bg-orange-500/15" />
            <motion.div
              className="absolute -bottom-px start-0 h-[2px] rounded-e-full"
              style={{
                background: 'linear-gradient(90deg, #f97316 0%, #f97316 55%, #f97316 100%)',
                boxShadow:
                  '0 0 6px rgba(249,115,22,0.85), 0 0 14px rgba(249,115,22,0.55), 0 0 2px rgba(249,115,22,0.9)',
              }}
              initial={false}
              animate={{ width: `${Math.max(onboarding.progress * 100, 6)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </>
        )}
      </div>

      {/* Search trigger — replaced by the onboarding progress in this slot until
          setup is complete (then the search box returns). */}
      <div className={cn('px-3', showOnboarding ? 'pt-2' : 'pt-3')}>
        {showOnboarding ? (
          <OnboardingSidebarBox />
        ) : (
          <CommandPaletteTrigger isCollapsed={isCollapsed} />
        )}
      </div>

      {/* Main Navigation — grouped by intent so learners and administrators can
          scan for what they need instead of reading one long flat list. */}
      <div className="flex-1 overflow-y-auto py-4 scrollbar-hide">
        <AdminAuthorization authorizationMode="component">
          <div className="space-y-1.5 px-3">
            {/* Home */}
            <BrevoNavItem
              href="/dash"
              icon={<House size={20} weight="fill" />}
              label={t('common.home')}
              isCollapsed={isCollapsed}
              onClick={() => {
                setOpenGroup(null)
                track(AnalyticsEvent.DashboardNavClicked, { section: 'home' })
              }}
            />

            {/* Courses */}
            <BrevoNavItem
              label={t('courses.courses')}
              icon={<BookOpen size={20} weight="fill" />}
              isCollapsed={isCollapsed}
              openGroup={openGroup}
              onToggleGroup={handleToggleGroup}
              subItems={[
                { label: t('common.all_courses'), href: '/dash/courses' },
              ]}
            />

            {/* Assignments */}
            <BrevoNavItem
              label={t('common.assignments')}
              icon={<Files size={20} weight="fill" />}
              isCollapsed={isCollapsed}
              openGroup={openGroup}
              onToggleGroup={handleToggleGroup}
              subItems={[
                { label: t('common.all_assignments'), href: '/dash/assignments' },
              ]}
            />

            {/* Content Section */}
            {showLibrary && (
              <BrevoNavItem
                href="/dash/library"
                icon={<FolderSimple size={20} weight="fill" />}
                label={t('library.library')}
                isCollapsed={isCollapsed}
                onClick={() => setOpenGroup(null)}
              />
            )}
            {showCommunities && (
              <BrevoNavItem
                href="/dash/connect"
                icon={<ChatsCircle size={20} weight="fill" />}
                label={t('communities.title')}
                isCollapsed={isCollapsed}
                onClick={() => setOpenGroup(null)}
              />
            )}
            {showPodcasts && (
              <BrevoNavItem
                href="/dash/podcasts"
                icon={<Headphones size={20} weight="fill" />}
                label={t('podcasts.podcasts')}
                isCollapsed={isCollapsed}
                onClick={() => setOpenGroup(null)}
              />
            )}
            {showBoards && (
              <BrevoNavItem
                href="/dash/boards"
                icon={<ChalkboardSimple size={20} weight="fill" />}
                label={t('boards.boards')}
                isCollapsed={isCollapsed}
                onClick={() => setOpenGroup(null)}
              />
            )}
            {showPlaygrounds && (
              <BrevoNavItem
                href="/dash/labs"
                icon={<Cube size={20} weight="fill" />}
                label={t('common.playgrounds')}
                isCollapsed={isCollapsed}
                onClick={() => setOpenGroup(null)}
              />
            )}

            {/* Users / Members */}
            {canManageUsers && (
              <BrevoNavItem
                label={t('common.users')}
                icon={<Users size={20} weight="fill" />}
                isCollapsed={isCollapsed}
                openGroup={openGroup}
                onToggleGroup={handleToggleGroup}
                subItems={[
                  { label: t('dashboard.users.settings.tabs.users'), href: '/dash/users/settings/users' },
                  { label: t('dashboard.users.settings.tabs.usergroups'), href: '/dash/users/settings/usergroups', badge: <PlanBadge currentPlan={plan} requiredPlan="standard" variant="dark" /> },
                  { label: t('dashboard.users.settings.tabs.roles'), href: '/dash/users/settings/roles', badge: <PlanBadge currentPlan={plan} requiredPlan="pro" variant="dark" /> },
                  { label: t('dashboard.users.settings.tabs.signups'), href: '/dash/users/settings/signups' },
                  { label: t('dashboard.users.settings.tabs.add'), href: '/dash/users/settings/add' },
                ]}
              />
            )}

            {/* Payments */}
            {showPayments && canManageOrg && (
              <BrevoNavItem
                label={t('common.payments')}
                icon={<CurrencyCircleDollar size={20} weight="fill" />}
                isCollapsed={isCollapsed}
                openGroup={openGroup}
                onToggleGroup={handleToggleGroup}
                subItems={[
                  { label: t('common.overview'), href: '/dash/payments/overview' },
                ]}
              />
            )}

            {/* Organization Settings */}
            {canManageOrgSettings && (
              <BrevoNavItem
                label={t('common.organization')}
                icon={<Buildings size={20} weight="fill" />}
                isCollapsed={isCollapsed}
                openGroup={openGroup}
                onToggleGroup={handleToggleGroup}
                subItems={[
                  { label: t('dashboard.organization.settings.tabs.general'), href: '/dash/org/settings/general' },
                  { label: t('dashboard.organization.settings.tabs.branding'), href: '/dash/org/settings/branding' },
                  { label: t('dashboard.organization.settings.tabs.landing'), href: '/dash/org/settings/landing' },
                  { label: t('dashboard.organization.settings.tabs.ai'), href: '/dash/org/settings/ai', badge: <PlanBadge currentPlan={plan} requiredPlan="standard" variant="dark" /> },
                  ...(canManageOrg ? [{ label: t('dashboard.organization.settings.tabs.usage') || 'Usage', href: '/dash/org/settings/usage' }] : []),
                  { label: t('dashboard.organization.settings.tabs.other'), href: '/dash/org/settings/other' },
                ]}
              />
            )}

            {/* Developers */}
            {canManageDevs && (
              <BrevoNavItem
                label={t('dashboard.developers.breadcrumb', { defaultValue: 'Developers' })}
                icon={<Code size={20} weight="fill" />}
                isCollapsed={isCollapsed}
                openGroup={openGroup}
                onToggleGroup={handleToggleGroup}
                subItems={[
                  { label: t('dashboard.organization.settings.tabs.api', { defaultValue: 'API Access' }), href: '/dash/developers/api', badge: <PlanBadge currentPlan={plan} requiredPlan="pro" variant="dark" /> },
                  { label: t('dashboard.organization.settings.tabs.automations', { defaultValue: 'Automations' }), href: '/dash/developers/automations', badge: <PlanBadge currentPlan={plan} requiredPlan="pro" variant="dark" /> },
                  { label: t('dashboard.organization.settings.tabs.domains', { defaultValue: 'Domains' }), href: '/dash/developers/domains', badge: <PlanBadge currentPlan={plan} requiredPlan="standard" variant="dark" /> },
                  { label: 'SEO', href: '/dash/developers/seo' },
                  { label: t('dashboard.organization.settings.tabs.sso', { defaultValue: 'SSO' }), href: '/dash/developers/sso', badge: <PlanBadge currentPlan={plan} requiredPlan="enterprise" variant="dark" /> },
                ]}
              />
            )}

            {/* Analytics */}
            <BrevoNavItem
              label={t('common.analytics')}
              icon={<ChartBar size={20} weight="fill" />}
              isCollapsed={isCollapsed}
              openGroup={openGroup}
              onToggleGroup={handleToggleGroup}
              subItems={[
                { label: t('analytics.tabs.overview'), href: '/dash/analytics' },
              ]}
            />

            {/* Disabled features shown in an "Other" hover menu */}
            {(!showCommunities || !showPodcasts || !showBoards || !showPlaygrounds || !showPayments) && (
              <HoverMenu
                content={
                  <HoverMenuContent className="w-64">
                    <HoverMenuLabel className="flex items-center justify-between text-foreground font-medium">
                      <span>{t('common.other')}</span>
                      <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] text-foreground/25">
                        {t('common.disabled')}
                      </span>
                    </HoverMenuLabel>
                    <HoverMenuSeparator />
                    {!showCommunities && (
                      <HoverMenuItem asChild>
                        <Link href="/dash/connect" className="flex items-center gap-2 px-3 py-2 text-sm text-foreground/60 hover:text-foreground hover:bg-white/[0.05] cursor-pointer transition-colors">
                          <ChatsCircle size={16} weight="fill" />
                          <span>{t('communities.title')}</span>
                        </Link>
                      </HoverMenuItem>
                    )}
                    {!showPodcasts && (
                      <HoverMenuItem asChild>
                        <Link href="/dash/podcasts" className="flex items-center gap-2 px-3 py-2 text-sm text-foreground/60 hover:text-foreground hover:bg-white/[0.05] cursor-pointer transition-colors">
                          <Headphones size={16} weight="fill" />
                          <span>{t('podcasts.podcasts')}</span>
                        </Link>
                      </HoverMenuItem>
                    )}
                    {!showBoards && (
                      <HoverMenuItem asChild>
                        <Link href="/dash/boards" className="flex items-center gap-2 px-3 py-2 text-sm text-foreground/60 hover:text-foreground hover:bg-white/[0.05] cursor-pointer transition-colors">
                          <ChalkboardSimple size={16} weight="fill" />
                          <span>{t('common.boards')}</span>
                        </Link>
                      </HoverMenuItem>
                    )}
                    {!showPlaygrounds && (
                      <HoverMenuItem asChild>
                        <Link href="/dash/labs" className="flex items-center gap-2 px-3 py-2 text-sm text-foreground/60 hover:text-foreground hover:bg-white/[0.05] cursor-pointer transition-colors">
                          <Cube size={16} weight="fill" />
                          <span>{t('common.playgrounds')}</span>
                        </Link>
                      </HoverMenuItem>
                    )}
                    {!showPayments && (
                      <HoverMenuItem asChild>
                        <Link href="/dash/payments/overview" className="flex items-center gap-2 px-3 py-2 text-sm text-foreground/60 hover:text-foreground hover:bg-white/[0.05] cursor-pointer transition-colors">
                          <CurrencyCircleDollar size={16} weight="fill" />
                          <span>{t('common.payments')}</span>
                        </Link>
                      </HoverMenuItem>
                    )}
                  </HoverMenuContent>
                }
              >
                <button
                  aria-label={t('dashboard.nav.other')}
                  className={cn(
                    "flex items-center w-full rounded-lg text-foreground/60 hover:text-foreground hover:bg-white/[0.05] transition-all",
                    isCollapsed ? "justify-center h-10" : "px-3 py-2 gap-3"
                  )}
                >
                  <span className="relative flex items-center justify-center">
                    <DotsThree size={20} weight="bold" />
                    {isCollapsed && (
                      <CaretDown aria-hidden="true" size={8} weight="bold" className="absolute -end-2.5 text-foreground/20" />
                    )}
                  </span>
                  {!isCollapsed && (
                    <>
                      <span className="text-sm font-medium flex-1 text-start">{t('common.other')}</span>
                      <CaretDown aria-hidden="true" size={14} weight="bold" className="text-foreground/20" />
                    </>
                  )}
                </button>
              </HoverMenu>
            )}
          </div>
        </AdminAuthorization>
      </div>

      {/* Free-plan upgrade box — replaces the old full-width top banner.
          Sits in the sidebar's empty space; multi-org / SaaS, free plan only.
          Twinkling stars on top; on hover it reveals the premium features the
          org is missing, the gold glow swells and the button sweeps a shimmer. */}
      {multiOrg && plan === 'free' && !isCollapsed && canManageOrg && (
        <motion.div
          className="relative overflow-hidden shrink-0 px-4 pt-6 pb-4"
          onHoverStart={() => setUpgradeHovered(true)}
          onHoverEnd={() => setUpgradeHovered(false)}
        >
          {/* Blueprint grid — same motif as the login/home pages, fading in
              from the bottom. No card/border; it blends into the sidebar. */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px),
                linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)`,
              backgroundSize: '56px 56px, 56px 56px, 14px 14px, 14px 14px',
              maskImage: 'linear-gradient(to top, black 0%, transparent 80%)',
              WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 80%)',
            }}
          />
          {/* Gold glow rising from the bottom — swells on hover. */}
          <motion.div
            className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
            initial={false}
            animate={{ opacity: upgradeHovered ? 1 : 0.5 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            style={{
              background:
                'radial-gradient(120% 90% at 50% 100%, rgba(250,204,21,0.12), rgba(255,255,255,0.05) 38%, transparent 72%)',
            }}
          />
          {/* Night-sky starfield — scattered points of light that twinkle and
              brighten on hover. The single amber "north star" is the plan you're
              reaching for; the white stars are the features it unlocks below. */}
          <div className="absolute inset-x-0 top-0 h-1/2 pointer-events-none">
            {UPGRADE_STARS.map((s, i) => (
              <motion.span
                key={i}
                className="absolute rounded-full"
                style={{
                  top: s.top,
                  left: s.left,
                  width: s.size,
                  height: s.size,
                  background: s.north ? 'rgb(252,211,77)' : 'rgba(255,255,255,0.95)',
                  boxShadow: s.north
                    ? '0 0 6px 1px rgba(250,204,21,0.7)'
                    : s.size >= 2
                      ? '0 0 4px 0.5px rgba(255,255,255,0.6)'
                      : 'none',
                }}
                animate={{
                  opacity: upgradeHovered ? [s.dim + 0.2, 1, s.dim + 0.2] : [s.dim, s.bright, s.dim],
                  scale: upgradeHovered ? [1, s.north ? 1.5 : 1.7, 1] : [1, 1.2, 1],
                }}
                transition={{
                  duration: (upgradeHovered ? 1.3 : 2.4) + s.size * 0.3,
                  repeat: Infinity,
                  delay: s.delay,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>

          <motion.div layout className="relative">
            {/* Plan badge + CTA headline (replaces the plain "Free plan" title). */}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/10 text-foreground/55 text-[8px] font-bold uppercase tracking-wider">
              {t('plan.free_plan_title', { defaultValue: 'Free plan' })}
            </span>
            <p className="mt-2 text-[13px] font-bold text-foreground leading-tight">
              {t('plan.free_plan_cta', { defaultValue: 'Unlock the full platform' })}
            </p>

            {/* Stable one-line pitch — no layout shift on hover; hover only
                intensifies the gold glow / starfield / button halo. */}
            <p className="mt-1 text-[11px] leading-relaxed text-foreground">
              {t('plan.free_plan_desc', {
                defaultValue: 'Everything you need to teach, sell & grow.',
              })}
            </p>

            <motion.a
              href={getMainDomainUri(`/billing?org=${org?.slug ?? ''}`)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              animate={{
                boxShadow: upgradeHovered
                  ? '0 0 0 1px rgba(250,204,21,0.5), 0 8px 24px -6px rgba(250,204,21,0.35)'
                  : '0 0 0 0 rgba(250,204,21,0)',
              }}
              transition={{ duration: 0.35 }}
              className="mt-3 relative overflow-hidden flex items-center justify-center gap-1.5 w-full rounded-lg bg-white text-[#0f0f10] text-[13px] font-semibold py-2"
            >
              <span className="relative z-10 flex items-center gap-1.5">
                <Rocket size={13} weight="duotone" />
                {t('plan.upgrade', { defaultValue: 'Upgrade' })}
              </span>
              {/* Diagonal shimmer sweep across the button. */}
              <motion.span
                aria-hidden
                className="absolute top-0 bottom-0 w-1/3 -skew-x-12 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, rgba(0,0,0,0.07), transparent)',
                }}
                animate={{ left: ['-40%', '140%'] }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  repeatDelay: upgradeHovered ? 0.4 : 2,
                  ease: 'easeInOut',
                }}
              />
            </motion.a>
          </motion.div>
        </motion.div>
      )}

      {/* Bottom Section */}
      <div className="border-t border-border py-3 px-3 shrink-0">
        <div className="space-y-1">
          {/* Expand button when collapsed */}
          {isCollapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={t('dashboard.nav.expand_sidebar')}
                  onClick={toggleCollapse}
                  className="flex items-center justify-center w-full h-10 rounded-lg text-foreground hover:text-foreground hover:bg-black/[0.04] transition-all"
                >
                  <SidebarSimple size={20} weight="fill" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="z-tooltip bg-[#262626] border-border text-foreground text-xs px-2 py-1 shadow-lg shadow-black/5">
                {t('common.expand')}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Language Switcher removed — English-only build. */}

          {/* Help with hover menu */}
          <HoverMenu
            align="end"
            content={
              <HoverMenuContent className="w-56">
                <HoverMenuLabel className="flex items-center gap-2 text-foreground font-medium">
                  <Question size={16} weight="fill" />
                  <span>{t('common.help')}</span>
                </HoverMenuLabel>
                <HoverMenuSeparator />
                <HoverMenuItem asChild>
                  <Link
                    href={getUriWithOrg(org.slug, '/help')}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors"
                  >
                    <Lifebuoy size={16} weight="fill" />
                    <span>Help Center</span>
                  </Link>
                </HoverMenuItem>
                <HoverMenuItem asChild>
                  <a
                    href="https://docs.validbridge.co.ke"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors"
                  >
                    <Book size={16} weight="fill" />
                    <span>{t('common.help_menu.documentation')}</span>
                  </a>
                </HoverMenuItem>
                <HoverMenuItem asChild>
                  <a
                    href="https://validbridge.co.ke"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors"
                  >
                    <Globe size={16} weight="fill" />
                    <span>{t('common.help_menu.website')}</span>
                  </a>
                </HoverMenuItem>
                <HoverMenuItem asChild>
                  <a
                    href="https://discord.gg/CMyZjjYZ6x"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors"
                  >
                    <DiscordIcon size={16} />
                    <span>{t('common.help_menu.discord')}</span>
                  </a>
                </HoverMenuItem>
                <HoverMenuSeparator />
                <HoverMenuItem
                  onClick={() => setFeedbackModalOpen(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors"
                >
                  <ChatCircleDots size={16} weight="fill" />
                  <span>{t('common.help_menu.report_feedback')}</span>
                </HoverMenuItem>
              </HoverMenuContent>
            }
          >
            <button aria-label={t('dashboard.nav.open_help_menu')} className={cn(
              "flex items-center w-full rounded-lg text-foreground hover:text-foreground hover:bg-black/[0.04] transition-all group",
              isCollapsed ? "justify-center h-10" : "px-3 py-2 gap-3"
            )}>
              <Question size={20} weight="fill" />
              {!isCollapsed && (
                <span className="text-sm font-medium">{t('common.help')}</span>
              )}
            </button>
          </HoverMenu>

          {/* My Organizations with hover menu (multi-org / SaaS only) */}
          {multiOrg && (
            <HoverMenu
              align="end"
              content={
                <HoverMenuContent className="w-64 max-h-96 overflow-y-auto">
                  <HoverMenuLabel className="flex items-center gap-2 text-foreground font-medium">
                    <Buildings size={16} weight="fill" />
                    <span>{t('common.organizations', { defaultValue: 'Organizations' })}</span>
                  </HoverMenuLabel>
                  <HoverMenuSeparator />
                  <HoverMenuItem asChild>
                    <a href={getMainDomainUri('/home')} className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors">
                      <House size={16} weight="fill" />
                      <span>{t('common.home', { defaultValue: 'Home' })}</span>
                    </a>
                  </HoverMenuItem>
                  {canManageOrg && (
                    <HoverMenuItem asChild>
                      <a href={getMainDomainUri(`/billing?org=${org?.slug ?? ''}`)} className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors">
                        <CurrencyCircleDollar size={16} weight="fill" />
                        <span>{t('common.billing', { defaultValue: 'Billing' })}</span>
                      </a>
                    </HoverMenuItem>
                  )}
                  {myOrgs.length > 0 && <HoverMenuSeparator />}
                  {myOrgs.map((o: any) => (
                    <HoverMenuItem key={o.id} asChild>
                      <a href={getUriWithOrg(o.slug, '/')} className={cn(
                        "flex items-center gap-2 px-3 py-2 text-sm hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors",
                        o.id === org?.id ? "text-foreground" : "text-foreground"
                      )}>
                        <Buildings size={16} weight="fill" />
                        <span className="truncate flex-1">{o.name}</span>
                        {o.id === org?.id && <Check size={14} weight="bold" className="text-green-500" />}
                      </a>
                    </HoverMenuItem>
                  ))}
                  <HoverMenuSeparator />
                  <HoverMenuItem asChild>
                    <a href={getMainDomainUri('/new')} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors">
                      <Plus size={16} weight="bold" />
                      <span>{t('common.create_organization', { defaultValue: 'Create organization' })}</span>
                    </a>
                  </HoverMenuItem>
                </HoverMenuContent>
              }
            >
              <button aria-label={t('dashboard.nav.open_organizations_menu')} className={cn(
                "flex items-center w-full rounded-lg text-foreground hover:text-foreground hover:bg-black/[0.04] transition-all group",
                isCollapsed ? "justify-center h-10" : "px-3 py-2 gap-3"
              )}>
                <Buildings size={20} weight="fill" />
                {!isCollapsed && (
                  <span className="text-sm font-medium">{t('common.organizations', { defaultValue: 'Organizations' })}</span>
                )}
              </button>
            </HoverMenu>
          )}

          {/* User Menu with hover menu */}
          <HoverMenu
            align="end"
            content={
              <HoverMenuContent className="w-56">
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold text-foreground/90">{session?.data?.user?.username}</p>
                  <p className="text-xs text-foreground">{session?.data?.user?.email}</p>
                </div>
                <HoverMenuSeparator />
                <HoverMenuItem asChild>
                  <Link href="/account/general" className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors">
                    <Gear size={16} weight="fill" />
                    <span>{t('common.settings')}</span>
                  </Link>
                </HoverMenuItem>
                <HoverMenuItem asChild>
                  <Link href={getUriWithOrg(org?.slug, '/account/purchases')} className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors">
                    <ShoppingBag size={16} weight="fill" />
                    <span>{t('account.purchases')}</span>
                  </Link>
                </HoverMenuItem>
                <HoverMenuItem asChild>
                  <Link href={getUriWithOrg(org?.slug, '/account/billing')} className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-black/[0.04] cursor-pointer transition-colors">
                    <Receipt size={16} weight="fill" />
                    <span>{t('account.billing')}</span>
                  </Link>
                </HoverMenuItem>
                <HoverMenuSeparator />
                <HoverMenuItem
                  onClick={() => logOutUI()}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:text-red-400 hover:bg-black/[0.04] cursor-pointer transition-colors"
                >
                  <SignOut size={16} weight="fill" data-dir-flip />
                  <span>{t('user.sign_out')}</span>
                </HoverMenuItem>
              </HoverMenuContent>
            }
          >
            <button className={cn(
              "flex items-center w-full rounded-lg text-foreground hover:text-foreground hover:bg-black/[0.04] transition-all group",
              isCollapsed ? "justify-center h-10" : "px-3 py-2 gap-3"
            )}>
              <UserAvatar width={24} rounded="rounded-full" shadow="shadow-none" />
              {!isCollapsed && (
                <div className="flex flex-col min-w-0 flex-1 text-start">
                  <span className="text-sm font-medium truncate text-foreground/90">{session?.data?.user?.username}</span>
                  <span className="text-xs text-foreground truncate">{session?.data?.user?.email}</span>
                </div>
              )}
            </button>
          </HoverMenu>
        </div>
      </div>
    </nav>

      {/* Feedback Modal */}
      <FeedbackModal
        open={feedbackModalOpen}
        onOpenChange={setFeedbackModalOpen}
        theme="dark"
        userName={session?.data?.user?.username}
        userEmail={session?.data?.user?.email}
      />
    </TooltipProvider>
  )
}

interface BrevoSubItem {
  label: string
  href: string
  badge?: React.ReactNode
}

interface BrevoNavItemProps {
  label: string
  icon: React.ReactNode
  href?: string
  isCollapsed?: boolean
  subItems?: BrevoSubItem[]
  onClick?: () => void
  openGroup?: string | null
  onToggleGroup?: (label: string) => void
}

function BrevoNavItem({
  label,
  icon,
  href,
  isCollapsed,
  subItems,
  onClick,
  openGroup,
  onToggleGroup,
}: BrevoNavItemProps) {
  const pathname = usePathname() || ''

  const isDirectActive = href
    ? href === '/dash'
      ? pathname === '/dash' || pathname === '/dash/'
      : pathname === href || pathname.startsWith(href + '/')
    : false

  const isSubActive = subItems?.some(
    (sub) => pathname === sub.href || pathname.startsWith(sub.href + '/')
  ) || false

  const isGroupActive = isDirectActive || isSubActive

  // Controlled open state: if openGroup is defined, group is open ONLY if openGroup === label.
  const isOpen = openGroup !== undefined ? openGroup === label : isGroupActive

  // Single Item with no sub-items
  if (!subItems || subItems.length === 0) {
    const content = (
      <div
        className={cn(
          "relative flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm transition-all duration-150 group",
          isDirectActive
            ? "bg-[#D1FADF] text-[#027A48] border border-[#A7F3D0]/70 font-bold shadow-2xs"
            : "text-slate-700 hover:bg-slate-100/70 hover:text-slate-900 font-medium",
          isCollapsed && "justify-center h-10 px-0"
        )}
      >
        <span className={cn("shrink-0", isDirectActive ? "text-[#027A48]" : "text-slate-400 group-hover:text-slate-600")}>
          {icon}
        </span>
        {!isCollapsed && <span className="truncate">{label}</span>}
      </div>
    )

    const link = (
      <Link href={href || '#'} onClick={onClick} aria-label={label}>
        {content}
      </Link>
    )

    if (isCollapsed) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 text-white border-slate-800 text-xs px-2.5 py-1 shadow-md">
            {label}
          </TooltipContent>
        </Tooltip>
      )
    }

    return link
  }

  // Accordion Group with Sub-Items
  const header = (
    <div
      onClick={() => {
        if (!isCollapsed && onToggleGroup) {
          onToggleGroup(label)
        }
      }}
      className={cn(
        "relative flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl text-sm transition-all duration-150 cursor-pointer select-none group text-slate-700 hover:bg-slate-100/70 hover:text-slate-900",
        isCollapsed && "justify-center h-10 px-0"
      )}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className={cn("shrink-0", isGroupActive ? "text-slate-900" : "text-slate-400 group-hover:text-slate-600")}>
          {icon}
        </span>
        {!isCollapsed && (
          <span className={cn("truncate", isGroupActive ? "font-bold text-slate-900" : "font-medium")}>
            {label}
          </span>
        )}
      </div>
    </div>
  )

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{header}</TooltipTrigger>
        <TooltipContent side="right" className="bg-slate-900 text-white border-slate-800 text-xs px-2.5 py-1 shadow-md">
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="space-y-1">
      {header}
      {isOpen && (
        <div className="ps-6 pe-1 py-0.5 space-y-1">
          {subItems.map((sub) => {
            const active = pathname === sub.href || pathname.startsWith(sub.href + '/')
            return (
              <Link
                key={sub.href}
                href={sub.href}
                className={cn(
                  "flex items-center justify-between px-3.5 py-2 rounded-xl text-sm transition-all duration-150",
                  active
                    ? "bg-[#D1FADF] text-[#027A48] border border-[#A7F3D0]/70 font-bold shadow-2xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 font-medium"
                )}
              >
                <span className="truncate">{sub.label}</span>
                {sub.badge}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

const NavGroupLabel = ({ children, isCollapsed }: { children: React.ReactNode; isCollapsed: boolean }) => (
  <SidebarGroupLabel collapsed={isCollapsed}>{children}</SidebarGroupLabel>
)

const MenuLink = ({ href, icon, label, isCollapsed, isExternal, active, onClick }: {
  href: string
  icon: React.ReactNode
  label: string
  isCollapsed: boolean
  isExternal?: boolean
  active?: boolean
  onClick?: () => void
}) => {
  const content = (
    <div
      className={cn(
        "relative flex items-center w-full rounded-xl transition-all duration-150 group",
        active
          ? "bg-orange-50/80 text-[#FF5A1F] font-semibold shadow-sm"
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/80",
        isCollapsed ? "justify-center h-10" : "px-3 py-2.5 gap-3"
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute start-0 top-2 bottom-2 w-1 bg-[#FF5A1F] rounded-r-full shadow-sm shadow-[#FF5A1F]/40"
        />
      )}
      <span className={cn("shrink-0 transition-transform group-hover:scale-105", active ? "text-[#FF5A1F]" : "text-slate-400 group-hover:text-slate-600")}>
        {icon}
      </span>
      {!isCollapsed && (
        <span className="text-sm font-medium">{label}</span>
      )}
    </div>
  )

  const ariaCurrent = active ? 'page' : undefined
  const linkElement = isExternal ? (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} onClick={onClick}>
      {content}
    </a>
  ) : (
    <Link aria-label={label} aria-current={ariaCurrent} href={href} onClick={onClick}>
      {content}
    </Link>
  )

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {linkElement}
        </TooltipTrigger>
        <TooltipContent side="right" className="z-tooltip bg-slate-900 text-white border-slate-800 text-xs px-2.5 py-1 shadow-md">
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return linkElement
}

export default DashLeftMenu
