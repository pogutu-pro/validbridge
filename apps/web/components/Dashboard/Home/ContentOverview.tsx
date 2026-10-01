'use client'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import {
  BookOpen,
  Users,
  ChatCircle,
  Microphone,
  Chalkboard,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { apiFetch } from '@services/utils/ts/requests'
import { getAPIUrl } from '@services/config/config'
import { getCommunities } from '@services/communities/communities'
import { getBoards } from '@services/boards/boards'
import { getOrgCourses } from '@services/courses/courses'
import { getOrgPodcasts } from '@services/podcasts/podcasts'
import { StatCard } from '@components/ui/stat-card'

export default function ContentOverview() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useVBSession() as any
  const token = session?.data?.tokens?.access_token
  const orgslug = org?.slug
  const orgId = org?.id
  const rf = org?.config?.config?.resolved_features
  const features = org?.config?.config?.features
  const isEnabled = (feature: string, defaultDisabled = false) => {
    if (rf?.[feature]) return rf[feature].enabled
    const v1 = features?.[feature]
    return defaultDisabled ? v1?.enabled === true : v1?.enabled !== false
  }

  const { data: coursesData, isLoading: coursesLoading } = useQuery({
    queryKey: [...queryKeys.courses.list(orgslug), 'overview'],
    queryFn: () => getOrgCourses(orgslug, null, token, true),
    enabled: !!token && !!orgslug,
    staleTime: 60_000,
  })

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: [...queryKeys.org.users(orgId), 'overview'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/users?page=1&limit=1`, token),
    enabled: !!token && !!orgId,
    staleTime: 60_000,
  })

  const communitiesEnabled = isEnabled('communities')
  const { data: communitiesData } = useQuery({
    queryKey: queryKeys.community.list(orgId),
    queryFn: () => getCommunities(orgId, 1, 500, null, token),
    enabled: !!communitiesEnabled && !!token && !!orgId,
    staleTime: 60_000,
  })

  const podcastsEnabled = isEnabled('podcasts', true)
  const { data: podcastsData } = useQuery({
    queryKey: [...queryKeys.podcasts.list(orgslug), 'overview'],
    queryFn: () => getOrgPodcasts(orgslug, null, token, true),
    enabled: !!podcastsEnabled && !!token && !!orgslug,
    staleTime: 60_000,
  })

  const boardsEnabled = isEnabled('boards', true)
  const { data: boardsData } = useQuery({
    queryKey: [...queryKeys.boards.list(orgslug), 'overview'],
    queryFn: () => getBoards(orgId, token),
    enabled: !!boardsEnabled && !!token && !!orgId,
    staleTime: 60_000,
  })

  const courses: any[] = coursesData ?? []
  const totalMembers = membersData?.total ?? 0
  const communities: any[] = communitiesData ?? []
  const podcasts: any[] = podcastsData ?? []
  const boards: any[] = boardsData ?? []

  const publishedCourses = courses.filter((c: any) => c.published).length
  const draftCourses = courses.length - publishedCourses

  const cards = [
    {
      key: 'courses',
      label: t('dashboard.home.courses'),
      value: courses.length,
      hint: `${publishedCourses} ${t('dashboard.home.published')} · ${draftCourses} ${t('dashboard.home.draft')}`,
      icon: <BookOpen weight="duotone" />,
      tone: 'primary' as const,
      href: '/dash/courses',
      show: true,
    },
    {
      key: 'members',
      label: t('dashboard.home.members'),
      value: totalMembers,
      hint: t('dashboard.home.total_users'),
      icon: <Users weight="duotone" />,
      tone: 'blue' as const,
      href: '/dash/users/settings/users',
      show: true,
    },
    {
      key: 'communities',
      label: t('dashboard.home.communities'),
      value: communities.length,
      hint: `${communities.filter((c: any) => c.public).length} ${t('dashboard.home.public')}`,
      icon: <ChatCircle weight="duotone" />,
      tone: 'violet' as const,
      href: '/dash/connect',
      show: communitiesEnabled,
    },
    {
      key: 'podcasts',
      label: t('dashboard.home.podcasts'),
      value: podcasts.length,
      hint: `${podcasts.reduce((sum: number, p: any) => sum + (p.episode_count || 0), 0)} ${t('dashboard.home.episodes')}`,
      icon: <Microphone weight="duotone" />,
      tone: 'amber' as const,
      href: '/dash/podcasts',
      show: podcastsEnabled,
    },
    {
      key: 'boards',
      label: t('dashboard.home.boards'),
      value: boards.length,
      hint: `${boards.reduce((sum: number, b: any) => sum + (b.member_count || 0), 0)} ${t('dashboard.home.participants')}`,
      icon: <Chalkboard weight="duotone" />,
      tone: 'green' as const,
      href: '/dash/boards',
      show: boardsEnabled,
    },
  ]

  const visibleCards = cards.filter((c) => c.show)
  const isLoading = coursesLoading || membersLoading

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-muted" />
              <div className="h-2.5 w-16 rounded bg-muted" />
            </div>
            <div className="mb-1.5 h-6 w-10 rounded bg-muted" />
            <div className="h-2 w-24 rounded bg-muted/60" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {visibleCards.map((card) => (
        <StatCard
          key={card.key}
          icon={card.icon}
          label={card.label}
          value={card.value}
          hint={card.hint}
          tone={card.tone}
          href={card.href}
        />
      ))}
    </div>
  )
}
