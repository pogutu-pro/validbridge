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
    <div className="space-y-4">
      {/* Community Info Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        {/* Header with community name */}
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            {thumbnailUrl ? (
              <SafeImage
                src={thumbnailUrl}
                alt={community.name}
                className="w-11 h-11 rounded-xl object-cover flex-shrink-0 border border-slate-200/60 shadow-2xs"
              />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-slate-100/80 border border-slate-200/60 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-5 h-5 text-slate-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-slate-900 truncate text-base tracking-tight">{community.name}</h2>
              <div className="flex items-center gap-1.5 text-xs font-medium mt-0.5">
                {community.public ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                    <Globe size={11} className="text-emerald-500" />
                    <span>{t('communities.public')}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200/60">
                    <Lock size={11} className="text-slate-400" />
                    <span>{t('communities.private')}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        {community.description && (
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
              {community.description}
            </p>
          </div>
        )}

        {/* Stats */}
        <div className="px-4 py-3 space-y-2.5">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm text-slate-600 font-medium">
            <MessageCircle size={15} className="text-slate-400" />
            <span>{discussionCount} {discussionCount === 1 ? t('communities.discussion') : t('communities.discussions')}</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs sm:text-sm text-slate-600 font-medium">
            <Calendar size={15} className="text-slate-400" />
            <span>{t('communities.created')} {createdDate}</span>
          </div>
        </div>

        {/* Linked Course */}
        {linkedCourse && (
          <div className="px-4 py-3 border-t border-slate-100">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('communities.linked_course')}
            </div>
            <Link
              href={getUriWithOrg(orgslug, `/course/${linkedCourse.course_uuid.replace('course_', '')}`)}
              className="group block"
            >
              <div className="flex items-center gap-3 p-2 -mx-1 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-200/60 transition-all">
                {courseThumbnailUrl ? (
                  <SafeImage
                    src={courseThumbnailUrl}
                    alt={linkedCourse.name}
                    className="w-11 h-11 rounded-xl object-cover flex-shrink-0 border border-slate-200/60"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <BookOpen size={18} className="text-slate-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-slate-900 group-hover:text-[#FF5A1F] transition-colors truncate">
                    {linkedCourse.name}
                  </h4>
                  {linkedCourse.description && (
                    <p className="text-xs text-slate-500 line-clamp-1 mt-0.5 font-normal">
                      {linkedCourse.description}
                    </p>
                  )}
                </div>
                <ChevronRight size={16} className="text-slate-400 group-hover:text-[#FF5A1F] transition-colors flex-shrink-0" />
              </div>
            </Link>
          </div>
        )}

        {/* Actions */}
        <div className="p-4 border-t border-slate-100 space-y-2">
          {canCreateDiscussion && onCreateDiscussion && (
            <button
              onClick={onCreateDiscussion}
              className="w-full py-2.5 px-4 rounded-xl font-semibold transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer bg-slate-900 text-white hover:bg-slate-800 text-sm shadow-xs active:scale-[0.99]"
            >
              <Plus className="w-4 h-4" />
              <span>{t('communities.new_discussion')}</span>
            </button>
          )}

          {canManageCommunity && (
            <Link
              href={getUriWithOrg(orgslug, '/dash/connect')}
              className="w-full bg-white text-slate-700 border border-slate-200/80 py-2.5 px-4 rounded-xl font-medium hover:bg-slate-50 transition-all duration-150 flex items-center justify-center gap-2 text-sm shadow-2xs"
            >
              <Settings className="w-4 h-4 text-slate-500" />
              {t('communities.manage')}
            </Link>
          )}
        </div>
      </div>

      {/* Quick Tips Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
        <h3 className="font-bold text-slate-900 mb-1.5 text-xs uppercase tracking-wider text-slate-500">{t('communities.community_guidelines')}</h3>
        <p className="text-xs text-slate-600 leading-relaxed font-normal">
          {t('communities.community_guidelines_text')}
        </p>
      </div>
    </div>
  )
}

export default CommunitySidebar
