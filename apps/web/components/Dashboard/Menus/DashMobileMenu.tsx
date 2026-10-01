'use client'
import { createPortal } from 'react-dom'
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
  ChatsCircle,
  Headphones,
  ChartBar,
  ChalkboardSimple,
  Cube,
  FolderSimple,
  List,
  X,
  ChatCircleDots,
  MagnifyingGlass,
  Code,
  Lifebuoy,
} from '@phosphor-icons/react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import UserAvatar from '../../Objects/UserAvatar'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import OrgSquareLogo, { hasOrgLogo } from '@components/Objects/Org/OrgSquareLogo'
import { cn } from '@/lib/utils'
import { usePlan } from '@components/Hooks/usePlan'
import { PLAN_LABELS, planMeetsRequirement, resolvePlanIdFromOrg } from '@services/plans/plans'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import { useCommandPalette } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { dashNavAccess } from './navRegistry'

function DashMobileMenu() {
  const org = useOrg() as any
  const session = useVBSession() as any
  const { t, i18n } = useTranslation()
  const pathname = usePathname() || ''
  const plan = resolvePlanIdFromOrg(org)
  const { toggle: openSearch } = useCommandPalette()
  const [menuOpen, setMenuOpen] = useState(false)
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { canManageOrg, rights } = useAdminStatus()
  const access = dashNavAccess(session?.data?.user?.is_superadmin === true, canManageOrg, rights as any)

  React.useEffect(() => { setMounted(true) }, [])

  if (!org || !session || !mounted) return null

  // The school's real plan. usePlan() is always 'enterprise' (gating is
  // off in the interface) and the web build always reports mode 'ee'.
  const planLabel = PLAN_LABELS[plan] ?? plan

  const rf = org?.config?.config?.resolved_features
  const isEnabled = (f: string) => rf?.[f]?.enabled === true

  const isActive = (path: string) => {
    if (path === '/dash') return pathname === '/dash' || pathname === '/dash/'
    return pathname === path || pathname.startsWith(path + '/')
  }

  async function logOutUI() {
    await signOut({ redirect: true, callbackUrl: getUriWithOrg(org.slug, '/login') })
  }

  const close = () => { setMenuOpen(false) }

  return createPortal(
    <>
      {/* Floating pill */}
      <nav
        aria-label={t('dashboard.nav.mobile_navigation')}
        className="fixed inset-x-0 mx-auto w-[calc(100%-2rem)] max-w-md sm:max-w-lg z-[9999]"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <div
          className="flex items-center justify-around sm:justify-between gap-1 p-1 bg-background/90 backdrop-blur-xl rounded-2xl border border-border"
          style={{
            boxShadow: '0 8px 30px -4px rgba(0,0,0,0.08), 0 2px 6px -1px rgba(0,0,0,0.04)',
          }}
        >
          {/* ValidBridge logo — links to home */}
          <Link
            href="/dash"
            className={cn(
              'flex items-center justify-center h-8 px-2.5 rounded-xl transition-all duration-200',
              isActive('/dash')
                ? 'bg-foreground/[0.08] text-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
            )}
            aria-label={t('common.home')}
          >
            <img
              src="/validbridge-dash.svg"
              alt="ValidBridge"
              className="h-4 w-4 opacity-85 hover:opacity-100 transition-opacity"
            />
          </Link>
          {/* Progressive reveal — more icons as viewport widens */}
          <PillLink href="/dash/courses" icon={<BookOpen size={17} weight="fill" />} active={isActive('/dash/courses')} className="flex" />
          <PillLink href="/dash/assignments" icon={<Files size={17} weight="fill" />} active={isActive('/dash/assignments')} className="flex" />
          {access.users && <PillLink href="/dash/users/settings/users" icon={<Users size={17} weight="fill" />} active={isActive('/dash/users')} className="hidden min-[410px]:flex" />}
          {isEnabled('communities') && (
            <PillLink href="/dash/connect" icon={<ChatsCircle size={17} weight="fill" />} active={isActive('/dash/connect')} className="hidden min-[460px]:flex" />
          )}
          {isEnabled('podcasts') && (
            <PillLink href="/dash/podcasts" icon={<Headphones size={17} weight="fill" />} active={isActive('/dash/podcasts')} className="hidden min-[500px]:flex" />
          )}
          {isEnabled('boards') && (
            <PillLink href="/dash/boards" icon={<ChalkboardSimple size={17} weight="fill" />} active={isActive('/dash/boards')} className="hidden min-[540px]:flex" />
          )}
          {isEnabled('playgrounds') && (
            <PillLink href="/dash/labs" icon={<Cube size={17} weight="fill" />} active={isActive('/dash/labs')} className="hidden min-[580px]:flex" />
          )}
          <PillLink href="/dash/analytics" icon={<ChartBar size={17} weight="fill" />} active={isActive('/dash/analytics')} className="hidden min-[620px]:flex" />
          {access.org && <PillLink href="/dash/org/settings/general" icon={<Buildings size={17} weight="fill" />} active={isActive('/dash/org')} className="hidden min-[660px]:flex" />}
          {access.developers && <PillLink href="/dash/developers/api" icon={<Code size={17} weight="fill" />} active={isActive('/dash/developers')} className="hidden min-[700px]:flex" />}
          {isEnabled('payments') && access.payments && (
            <PillLink href="/dash/payments/overview" icon={<CurrencyCircleDollar size={17} weight="fill" />} active={isActive('/dash/payments')} className="hidden min-[740px]:flex" />
          )}

          <span className="w-px h-3.5 bg-border mx-0.5 shrink-0" />

          {/* Search */}
          <button
            onClick={openSearch}
            aria-label={t('common.search')}
            className="flex items-center justify-center h-8 px-2.5 rounded-xl transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-muted/60"
          >
            <MagnifyingGlass size={17} weight="bold" />
          </button>

          {/* Menu toggle */}
          <button
            onClick={() => setMenuOpen(v => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className={cn(
              'flex items-center justify-center h-8 px-2.5 rounded-xl transition-all duration-200 overflow-hidden',
              menuOpen
                ? 'bg-foreground/[0.1] text-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              {menuOpen
                ? <motion.span key="x" className="flex" initial={{ rotate: -45, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 45, opacity: 0 }} transition={{ duration: 0.15 }}><X size={17} weight="bold" /></motion.span>
                : <motion.span key="list" className="flex" initial={{ rotate: 45, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -45, opacity: 0 }} transition={{ duration: 0.15 }}><List size={17} /></motion.span>
              }
            </AnimatePresence>
          </button>

        </div>
      </nav>

      {/* Compact menu panel */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[9997] bg-black/20 backdrop-blur-[2px]"
              onClick={close}
            />

            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ type: 'spring', damping: 30, stiffness: 360 }}
              className="fixed start-4 end-4 z-[9998] max-w-sm mx-auto bg-background/95 backdrop-blur-xl rounded-2xl overflow-hidden border border-border"
              style={{
                bottom: 'calc(env(safe-area-inset-bottom) + 4.5rem)',
                boxShadow: '0 16px 40px -8px rgba(0,0,0,0.12)',
              }}
            >
              {/* Org header */}
              <div className="flex items-center gap-3 px-4 py-3.5">
                {planMeetsRequirement(plan, 'starter') && hasOrgLogo(org) ? (
                  <div className="h-7 w-7 rounded-lg overflow-hidden bg-card border border-border shrink-0">
                    <OrgSquareLogo org={org} wideInsetClassName="p-0.5" fallback={null} />
                  </div>
                ) : (
                  <div className="h-7 w-7 flex items-center justify-center bg-muted rounded-lg">
                    <img src="/validbridge-dash.svg" alt="ValidBridge" className="h-4 w-4" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate leading-none mb-0.5">{org?.name}</p>
                  <p className={cn(
                    'text-[10px] font-medium',
                    plan === 'enterprise' ? 'text-orange-700' :
                    plan === 'business' ? 'text-orange-600' :
                    plan === 'growth' ? 'text-orange-500' :
                    'text-muted-foreground'
                  )}>{planLabel}</p>
                </div>
              </div>

              <div className="h-px bg-border mx-4" />

              {/* Nav items */}
              <div className="py-2 px-2 max-h-[52vh] overflow-y-auto overscroll-contain space-y-0.5">
                <PanelItem href="/dash" icon={<House size={15} weight="fill" />} label={t('common.home')} active={isActive('/dash')} onClick={close} />
                <PanelItem href="/dash/courses" icon={<BookOpen size={15} weight="fill" />} label={t('courses.courses')} active={isActive('/dash/courses')} onClick={close} />
                {isEnabled('folders') && <PanelItem href="/dash/library" icon={<FolderSimple size={15} weight="fill" />} label={t('library.library')} active={isActive('/dash/library')} onClick={close} />}
                <PanelItem href="/dash/assignments" icon={<Files size={15} weight="fill" />} label={t('common.assignments')} active={isActive('/dash/assignments')} onClick={close} />
                {access.users && <PanelItem href="/dash/users/settings/users" icon={<Users size={15} weight="fill" />} label={t('common.users')} active={isActive('/dash/users')} onClick={close} />}
                {isEnabled('communities') && <PanelItem href="/dash/connect" icon={<ChatsCircle size={15} weight="fill" />} label={t('communities.title')} active={isActive('/dash/connect')} onClick={close} />}
                {isEnabled('podcasts') && <PanelItem href="/dash/podcasts" icon={<Headphones size={15} weight="fill" />} label={t('podcasts.podcasts')} active={isActive('/dash/podcasts')} onClick={close} />}
                {isEnabled('boards') && <PanelItem href="/dash/boards" icon={<ChalkboardSimple size={15} weight="fill" />} label="Boards" active={isActive('/dash/boards')} onClick={close} />}
                {isEnabled('playgrounds') && <PanelItem href="/dash/labs" icon={<Cube size={15} weight="fill" />} label="Labs" active={isActive('/dash/labs')} onClick={close} />}
                {isEnabled('payments') && access.payments && <PanelItem href="/dash/payments/overview" icon={<CurrencyCircleDollar size={15} weight="fill" />} label={t('common.payments')} active={isActive('/dash/payments')} onClick={close} />}
                <PanelItem href="/dash/analytics" icon={<ChartBar size={15} weight="fill" />} label="Analytics" active={isActive('/dash/analytics')} onClick={close} />
                {access.org && <PanelItem href="/dash/org/settings/general" icon={<Buildings size={15} weight="fill" />} label={t('common.organization')} active={isActive('/dash/org')} onClick={close} />}
                {access.developers && <PanelItem href="/dash/developers/api" icon={<Code size={15} weight="fill" />} label={t('dashboard.developers.breadcrumb', { defaultValue: 'Developers' })} active={isActive('/dash/developers')} onClick={close} />}

                <div className="h-px bg-border mx-2 my-1.5" />

                <PanelItem href="/account/general" icon={<Gear size={15} weight="fill" />} label={t('common.settings')} active={isActive('/account')} onClick={close} />

                <Link href={getUriWithOrg(org.slug, '/help')} onClick={close}
                  className="flex items-center w-full rounded-xl px-2.5 py-2 gap-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                >
                  <Lifebuoy size={15} weight="fill" />
                  <span className="text-sm font-medium">Help Center</span>
                </Link>
                <button
                  onClick={() => { setFeedbackModalOpen(true); close() }}
                  className="flex items-center w-full rounded-xl px-2.5 py-2 gap-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                >
                  <ChatCircleDots size={15} weight="fill" />
                  <span className="text-sm font-medium">{t('common.help_menu.report_feedback')}</span>
                </button>
              </div>

              {/* User footer */}
              <div className="h-px bg-border mx-4" />
              <div className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <UserAvatar width={28} rounded="rounded-full" shadow="shadow-none" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate leading-none mb-0.5">{session?.data?.user?.username}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{session?.data?.user?.email}</p>
                  </div>
                  <button
                    onClick={logOutUI}
                    aria-label={t('user.sign_out')}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                  >
                    <SignOut size={14} weight="fill" data-dir-flip />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <FeedbackModal
        open={feedbackModalOpen}
        onOpenChange={setFeedbackModalOpen}
        theme="light"
        userName={session?.data?.user?.username}
        userEmail={session?.data?.user?.email}
      />
    </>,
    document.body
  )
}

const PillLink = ({
  href,
  icon,
  active,
  className,
}: {
  href: string
  icon: React.ReactNode
  active: boolean
  className?: string
}) => (
  <Link
    href={href}
    aria-current={active ? 'page' : undefined}
    className={cn(
      'flex items-center justify-center h-8 px-2.5 rounded-xl transition-all duration-200',
      active
        ? 'bg-primary/10 text-primary shadow-2xs font-medium'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
      className
    )}
  >
    {icon}
  </Link>
)

const PanelItem = ({
  href,
  icon,
  label,
  active,
  onClick,
}: {
  href: string
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) => (
  <Link
    href={href}
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={cn(
      'relative flex items-center w-full rounded-xl px-2.5 py-2 gap-2.5 transition-all text-sm font-medium',
      active
        ? 'text-foreground bg-primary/10'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
    )}
  >
    {active && (
      <span
        aria-hidden="true"
        className="absolute start-1 top-1/2 -translate-y-1/2 h-4 w-[2.5px] bg-primary rounded-full"
      />
    )}
    {icon}
    <span>{label}</span>
  </Link>
)

export default DashMobileMenu
