'use client'
import React, { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowSquareOut, Sparkle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useAICopilot } from '@components/Contexts/AI/AICopilotContext'
import { getUriWithOrg } from '@services/config/config'
import { dashboardPages } from '@/lib/dashboard-search/registry'
import { AppTopbar, TopbarSearchButton } from '@components/AppShell/AppTopbar'
import { useCommandPalette } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
import { HeaderProfileBox } from '@components/Security/HeaderProfileBox'
import { HelpMenu } from '@components/Objects/Menus/HelpMenu'
import OrgSquareLogo from '@components/Objects/Org/OrgSquareLogo'

// Ordered most-specific first so nested routes resolve to the right section.
const SECTION_TITLES: { match: string; labelKey: string; fallback: string }[] = [
  { match: '/dash/courses/course', labelKey: 'common.course_editor', fallback: 'Course editor' },
  { match: '/dash/courses/migrate', labelKey: 'dashboard.courses.migrate', fallback: 'Migrate courses' },
  { match: '/dash/courses', labelKey: 'courses.courses', fallback: 'Courses' },
  { match: '/dash/assignments', labelKey: 'common.assignments', fallback: 'Assignments' },
  { match: '/dash/library', labelKey: 'library.library', fallback: 'Library' },
  { match: '/dash/connect', labelKey: 'communities.title', fallback: 'Connect' },
  { match: '/dash/podcasts', labelKey: 'podcasts.podcasts', fallback: 'Podcasts' },
  { match: '/dash/boards', labelKey: 'boards.boards', fallback: 'Boards' },
  { match: '/dash/labs', labelKey: 'common.playgrounds', fallback: 'Labs' },
  { match: '/dash/users/analytics', labelKey: 'common.analytics', fallback: 'Analytics' },
  { match: '/dash/users', labelKey: 'common.users', fallback: 'Users' },
  { match: '/dash/payments', labelKey: 'common.payments', fallback: 'Payments' },
  { match: '/dash/org', labelKey: 'common.organization', fallback: 'Organization' },
  { match: '/dash/developers', labelKey: 'dashboard.developers.breadcrumb', fallback: 'Developers' },
  { match: '/dash/analytics', labelKey: 'common.analytics', fallback: 'Analytics' },
  { match: '/dash/onboarding', labelKey: 'dashboard.onboarding.title', fallback: 'Getting started' },
  { match: '/dash', labelKey: 'common.dashboard', fallback: 'Dashboard' },
]

export default function DashTopbar() {
  const { t } = useTranslation()
  const pathname = usePathname() || ''
  const org = useOrg() as any
  const { setOpen } = useCommandPalette()
  const { setPageContext, setPageHints, openCopilot, isOpen } = useAICopilot()

  const section =
    SECTION_TITLES.find((s) => pathname === s.match || pathname.startsWith(s.match + '/') || pathname === s.match) ||
    SECTION_TITLES[SECTION_TITLES.length - 1]

  // Resolve the most specific page metadata for the current route. Longest
  // matching href wins, so /dash/org/settings/branding resolves to the branding
  // entry rather than the org section.
  const pageMeta = dashboardPages
    .filter((m) => pathname === m.href || pathname.startsWith(m.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]

  // Publish where the manager is so the assistant can answer "what does this
  // page do" without being told. Purely a prompt hint — the backend re-derives
  // the organization and role from the auth token and never trusts this.
  const title = t(section.labelKey, { defaultValue: section.fallback })
  useEffect(() => {
    setPageContext({
      pathname,
      title,
      description: pageMeta ? t(pageMeta.descriptionKey!, { defaultValue: '' }) || undefined : undefined,
      aiSummary: pageMeta?.aiSummary,
    })
    setPageHints(pageMeta?.aiHints ?? [])
  }, [pathname, title, pageMeta, setPageContext, setPageHints])

  return (
    <AppTopbar
      left={
        <>
          <Link
            href="/dash"
            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card"
            aria-label={org?.name || 'Dashboard'}
          >
            {org ? (
              <OrgSquareLogo
                org={org}
                alt=""
                wideInsetClassName="p-1"
                fallback={
                  <span className="text-xs font-bold text-muted-foreground">
                    {(org?.name || '?').charAt(0).toUpperCase()}
                  </span>
                }
              />
            ) : null}
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {t(section.labelKey, { defaultValue: section.fallback })}
            </p>
            {org?.name ? (
              <p className="truncate text-xs text-muted-foreground">{org.name}</p>
            ) : null}
          </div>
        </>
      }
      center={
        <TopbarSearchButton
          onClick={() => setOpen(true)}
          placeholder={t('dashboard.search.trigger', { defaultValue: 'Search courses, users, pages…' })}
        />
      }
      right={
        <>
          <button
            type="button"
            onClick={() => openCopilot()}
            aria-label={t('dashboard.copilot.open', { defaultValue: 'Open AI Copilot' })}
            title={t('dashboard.copilot.open', { defaultValue: 'Open AI Copilot' })}
            aria-expanded={isOpen}
            className={`flex size-9 items-center justify-center rounded-lg transition-colors ${
              isOpen
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Sparkle weight="fill" data-dir-flip />
          </button>
          <Link
            href={getUriWithOrg(org?.slug, '/')}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('common.view_site', { defaultValue: 'View site' })}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex [&_svg]:size-[18px]"
          >
            <ArrowSquareOut />
          </Link>
          <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <div className="hidden sm:block">
            <HelpMenu
              orgslug={org?.slug}
              triggerClassName="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            />
          </div>
          <div className="hidden sm:block">
            <HeaderProfileBox />
          </div>
        </>
      }
    />
  )
}
