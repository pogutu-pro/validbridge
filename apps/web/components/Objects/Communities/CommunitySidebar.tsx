'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import {
  MessageCircle,
  Plus,
  Globe,
  Lock,
  Settings,
  Calendar,
  BookOpen,
  ChevronRight,
} from 'lucide-react'
import { Community } from '@services/communities/communities'
import { getCommunityThumbnailMediaDirectory, getCourseThumbnailMediaDirectory } from '@services/media/media'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getCourseById } from '@services/courses/courses'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import dayjs from 'dayjs'
import { SafeImage } from '@components/Objects/SafeImage'
import { Button } from '@components/ui/button'

interface CommunitySidebarProps {
  community: Community
  discussionCount: number
  orgslug: string
  onCreateDiscussion?: () => void
}

export function CommunitySidebar({
  community,
  discussionCount,
  orgslug,
  onCreateDiscussion,
}: CommunitySidebarProps) {
  const { t } = useTranslation()
  const { canManageCommunity, canCreateDiscussion } = useCommunityRights(community.community_uuid)
  const org = useOrg() as any
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token

  // Fetch linked course if community has a course_id
  const { data: linkedCourse } = useQuery({
    queryKey: queryKeys.community.byCourse(String(community.course_id ?? '')),
    queryFn: () => getCourseById(String(community.course_id), null, accessToken),
    enabled: !!(community.course_id && accessToken),
    staleTime: 60_000,
  })

  const createdDate = dayjs(community.creation_date).format('MMM D, YYYY')

  const thumbnailUrl = community.thumbnail_image && org?.org_uuid
    ? getCommunityThumbnailMediaDirectory(
        org.org_uuid,
        community.community_uuid,
        community.thumbnail_image
      )
    : null

  const courseThumbnailUrl = linkedCourse?.thumbnail_image && org?.org_uuid
    ? getCourseThumbnailMediaDirectory(
        org.org_uuid,
        linkedCourse.course_uuid,
        linkedCourse.thumbnail_image
      )
    : null

  return (
    <div className="space-y-3">
      {/* Community Info Panel */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {/* Header with community name */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-3">
            {thumbnailUrl ? (
              <SafeImage
                src={thumbnailUrl}
                alt={community.name}
                className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-sm text-foreground truncate">{community.name}</h2>
              <div className="flex items-center gap-1 mt-0.5">
                {community.public ? (
                  <>
                    <Globe size={11} className="text-green-500 flex-shrink-0" />
                    <span className="text-xs text-muted-foreground">{t('communities.public')}</span>
                  </>
                ) : (
                  <>
                    <Lock size={11} className="text-muted-foreground flex-shrink-0" />
                    <span className="text-xs text-muted-foreground">{t('communities.private')}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        {community.description && (
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {community.description}
            </p>
          </div>
        )}

        {/* Stats */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MessageCircle size={13} />
              <span>
                {discussionCount} {discussionCount === 1 ? t('communities.discussion') : t('communities.discussions')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar size={13} />
            <span>{t('communities.created')} {createdDate}</span>
          </div>
        </div>

        {/* Linked Course */}
        {linkedCourse && (
          <div className="px-4 py-3 border-t border-border">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t('communities.linked_course')}
            </div>
            <Link
              href={getUriWithOrg(orgslug, `/course/${linkedCourse.course_uuid.replace('course_', '')}`)}
              className="group block"
            >
              <div className="flex items-center gap-2.5 p-2 -mx-2 rounded-lg hover:bg-accent transition-colors">
                {courseThumbnailUrl ? (
                  <SafeImage
                    src={courseThumbnailUrl}
                    alt={linkedCourse.name}
                    className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                    <BookOpen size={16} className="text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                    {linkedCourse.name}
                  </h4>
                  {linkedCourse.description && (
                    <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                      {linkedCourse.description}
                    </p>
                  )}
                </div>
                <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
              </div>
            </Link>
          </div>
        )}

        {/* Actions */}
        <div className="p-4 border-t border-border space-y-2">
          {canCreateDiscussion && onCreateDiscussion && (
            <Button
              onClick={onCreateDiscussion}
              className="w-full"
              size="sm"
            >
              <Plus className="w-4 h-4" />
              {t('communities.new_discussion')}
            </Button>
          )}

          {canManageCommunity && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              asChild
            >
              <Link href={getUriWithOrg(orgslug, '/dash/connect')}>
                <Settings className="w-4 h-4" />
                {t('communities.manage')}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default CommunitySidebar
