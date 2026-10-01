'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import {
  MessageCircle,
  Globe,
  Lock,
  Settings,
  Calendar,
  BookOpen,
  ChevronRight,
  Info,
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
import { SafeImage } from '@components/Objects/SafeImage'
import { Button } from '@components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog'
import { Badge } from '@components/ui/badge'

interface CommunityInfoDialogProps {
  isOpen: boolean
  onClose: () => void
  community: Community
  discussionCount: number
  orgslug: string
}

export function CommunityInfoDialog({
  isOpen,
  onClose,
  community,
  discussionCount,
  orgslug,
}: CommunityInfoDialogProps) {
  const { t } = useTranslation()
  const { canManageCommunity } = useCommunityRights(community.community_uuid)
  const org = useOrg() as any
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const { data: linkedCourse } = useQuery({
    queryKey: queryKeys.community.byCourse(String(community.course_id ?? '')),
    queryFn: () => getCourseById(String(community.course_id), null, accessToken),
    enabled: !!(community.course_id && accessToken && isOpen),
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2 border-b border-border">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Info size={16} className="text-primary" />
            {t('communities.sidebar.community', { defaultValue: 'Community Info' })}
          </DialogTitle>
        </DialogHeader>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Community header */}
          <div className="flex items-center gap-3.5">
            {thumbnailUrl ? (
              <SafeImage
                src={thumbnailUrl}
                alt={community.name}
                className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-border"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 border border-border">
                <MessageCircle className="w-7 h-7 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-base text-foreground leading-snug">{community.name}</h3>
              <div className="flex items-center gap-1.5 mt-1">
                <Badge variant="secondary" className="gap-1 text-[10px] font-medium px-2 py-0">
                  {community.public ? (
                    <>
                      <Globe size={10} className="text-emerald-500" />
                      {t('courses.public')}
                    </>
                  ) : (
                    <>
                      <Lock size={10} className="text-muted-foreground" />
                      {t('courses.private')}
                    </>
                  )}
                </Badge>
              </div>
            </div>
          </div>

          {/* Description */}
          {community.description && (
            <div className="p-3 bg-muted/40 rounded-lg border border-border/60">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {community.description}
              </p>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg border border-border bg-card">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                {t('communities.discussions')}
              </div>
              <div className="text-base font-bold text-foreground mt-0.5">
                {discussionCount}
              </div>
            </div>
            <div className="p-2.5 rounded-lg border border-border bg-card">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                {t('communities.created')}
              </div>
              <div className="text-xs font-medium text-foreground mt-1 flex items-center gap-1">
                <Calendar size={12} className="text-muted-foreground" />
                {createdDate}
              </div>
            </div>
          </div>

          {/* Linked Course */}
          {linkedCourse && (
            <div className="border border-border rounded-lg p-3">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t('communities.linked_course')}
              </div>
              <Link
                href={getUriWithOrg(orgslug, `/course/${linkedCourse.course_uuid.replace('course_', '')}`)}
                onClick={onClose}
                className="group flex items-center gap-2.5 p-2 -mx-1 rounded-md hover:bg-accent transition-colors"
              >
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
              </Link>
            </div>
          )}

          {/* Admin Management */}
          {canManageCommunity && (
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-center"
                asChild
              >
                <Link href={getUriWithOrg(orgslug, `/dash/connect/${community.community_uuid.replace('community_', '')}/general`)}>
                  <Settings size={14} className="me-1.5" />
                  {t('communities.manage', { defaultValue: 'Manage Community' })}
                </Link>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CommunityInfoDialog
