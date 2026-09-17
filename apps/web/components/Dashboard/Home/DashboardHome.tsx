'use client'
import React from 'react'
import Link from 'next/link'
import {
  PlusCircle,
  ChartBar,
  GearSix,
  Users,
  Sparkle,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTranslation } from 'react-i18next'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { OrgUsageResponse, orgUsageFetcher } from '@services/orgs/usage'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { usePlan } from '@components/Hooks/usePlan'
import QuickStats from './QuickStats'
import RecentCourses from './RecentCourses'
import RecentMembers from './RecentMembers'
import ContentOverview from './ContentOverview'
import UsageOverview from './UsageOverview'

const PLAN_STYLES: Record<string, string> = {
  free: 'bg-muted text-muted-foreground',
  oss: 'bg-emerald-500/10 text-emerald-600',
  standard: 'bg-blue-500/10 text-blue-600',
  pro: 'bg-primary/10 text-primary',
  enterprise: 'bg-amber-500/10 text-amber-600',
}

function ActionLink({
  href,
  icon,
  label,
  primary = false,
}: {
  href: string
  icon: React.ReactNode
  label: string
  primary?: boolean
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? 'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 [&_svg]:size-4'
          : 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary [&_svg]:size-4'
      }
    >
      {icon}
      {label}
    </Link>
  )
}

export default function DashboardHome() {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const org = useOrg() as any

  const token = session?.data?.tokens?.access_token
  const orgId = org?.id
  const username = session?.data?.user?.username || ''

  // Shares its queryKey with UsageOverview so the request is deduped.
  useQuery<OrgUsageResponse>({
    queryKey: queryKeys.org.usage(orgId),
    queryFn: () => orgUsageFetcher(`${getAPIUrl()}orgs/${orgId}/usage`, token),
    enabled: !!token && !!orgId,
    staleTime: 60_000,
  })

  const plan = usePlan()
  const planStyle = PLAN_STYLES[plan] || PLAN_STYLES.free

  return (
    <div className="h-full w-full bg-background">
      <div className="mx-auto w-full max-w-[1600px] px-4 pb-12 pt-6 sm:px-8">
        <div className="space-y-6">
          {/* Greeting hero */}
          <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-5 py-5 sm:px-7 sm:py-6">
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${planStyle}`}>
                    {plan === 'oss' ? 'OSS' : `${plan} ${t('dashboard.home.plan')}`}
                  </span>
                  {org?.name && (
                    <span className="text-xs text-muted-foreground">{org.name}</span>
                  )}
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {t('dashboard.home.welcome_back')}
                  {username ? `, ${username}` : ''}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('dashboard.home.subtitle', {
                    defaultValue: 'Here is what is happening across your learning space today.',
                  })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ActionLink
                  href="/dash/courses?new=true"
                  icon={<PlusCircle weight="bold" />}
                  label={t('dashboard.home.create_course')}
                  primary
                />
                <ActionLink
                  href="/dash/analytics"
                  icon={<ChartBar weight="bold" />}
                  label={t('dashboard.home.analytics')}
                />
                <ActionLink
                  href="/dash/users/settings/users"
                  icon={<Users weight="bold" />}
                  label={t('dashboard.home.members')}
                />
                <ActionLink
                  href="/dash/org/settings/general"
                  icon={<GearSix weight="bold" />}
                  label={t('dashboard.home.settings')}
                />
              </div>
            </div>
          </section>

          <AdminAuthorization authorizationMode="component">
            <div className="space-y-6">
              {/* Key metrics */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkle size={16} weight="fill" className="text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">
                    {t('dashboard.home.overview', { defaultValue: 'Overview' })}
                  </h2>
                </div>
                <ContentOverview />
              </section>

              {/* Main grid: courses + members on the left, plan/usage on the right */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">
                  <RecentCourses />
                  <RecentMembers />
                </div>
                <div className="space-y-6">
                  <UsageOverview />
                  <QuickStats />
                </div>
              </div>
            </div>
          </AdminAuthorization>
        </div>
      </div>
    </div>
  )
}
