'use client'
import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTranslation } from 'react-i18next'
import { formatDate } from '@/lib/format'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { Users, ShieldCheck, Clock, EnvelopeSimple } from '@phosphor-icons/react'
import { Card, CardSectionHeader } from '@components/ui/card'
import { EmptyState } from '@components/ui/empty-state'

export default function RecentMembers() {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useVBSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id

  const { data: membersData, isLoading } = useQuery({
    queryKey: [...queryKeys.org.users(orgId), 1, 'recent', 8],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/users?page=1&limit=8&sort_order=desc`, token),
    enabled: !!token && !!orgId,
    staleTime: 60_000,
  })

  const members: any[] = membersData?.items ?? []
  const totalMembers = membersData?.total ?? 0

  return (
    <Card>
      <CardSectionHeader
        icon={<Users weight="duotone" />}
        title={t('dashboard.home.recent_members')}
        description={totalMembers > 0 ? `${totalMembers} ${t('dashboard.home.total')}` : undefined}
        action={
          <Link
            href="/dash/users/settings/users"
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            {t('dashboard.home.view_all')} &rarr;
          </Link>
        }
      />

      {isLoading ? (
        <div className="space-y-3 px-5 pb-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex animate-pulse items-center gap-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />
              <div className="flex-1">
                <div className="mb-1.5 h-3 w-32 rounded bg-muted" />
                <div className="h-2 w-44 rounded bg-muted/60" />
              </div>
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          compact
          icon={<Users weight="duotone" />}
          title={t('dashboard.home.no_members_yet')}
        />
      ) : (
        <div className="divide-y divide-border/60">
          {members.map((member: any) => {
            const user = member.user
            const role = member.role
            const joinedAt = member.joined_at
              ? formatDate(member.joined_at, i18n.language, {
                  dateStyle: undefined,
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : null
            const displayName =
              user.first_name || user.last_name
                ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                : user.username
            const initials = `${(user.first_name?.[0] || user.username?.[0] || '').toUpperCase()}${(user.last_name?.[0] || '').toUpperCase()}`

            return (
              <div key={user.user_uuid} className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <span className="text-[11px] font-semibold text-primary">{initials}</span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                    {!user.email_verified && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600">
                        {t('dashboard.home.unverified')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3">
                    <span className="flex min-w-0 items-center gap-1 truncate text-[10px] text-muted-foreground">
                      <EnvelopeSimple size={10} />
                      {user.email}
                    </span>
                    {joinedAt && (
                      <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock size={10} />
                        {joinedAt}
                      </span>
                    )}
                  </div>
                </div>

                {role && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <ShieldCheck size={10} />
                    {role.name}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
