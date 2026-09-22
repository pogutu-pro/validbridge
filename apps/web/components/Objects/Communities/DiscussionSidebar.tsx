'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  MessageCircle,
  Pin,
  Lock,
} from 'lucide-react'
import { Community } from '@services/communities/communities'
import { DiscussionWithAuthor, DiscussionAuthor, getLabelInfo } from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { UpvoteButton } from './UpvoteButton'
import { ReactionButton } from './ReactionButton'
import UserAvatar from '@components/Objects/UserAvatar'

dayjs.extend(relativeTime)

interface DiscussionSidebarProps {
  discussion: DiscussionWithAuthor
  community: Community
  orgslug: string
}

function getAvatarUrl(author: DiscussionAuthor | null): string | null {
  if (!author?.avatar_image) return null
  if (author.avatar_image.startsWith('http://') || author.avatar_image.startsWith('https://')) {
    return author.avatar_image
  }
  return getUserAvatarMediaDirectory(author.user_uuid, author.avatar_image)
}

export function DiscussionSidebar({
  discussion,
  community,
  orgslug,
}: DiscussionSidebarProps) {
  const { t } = useTranslation()
  const communityId = community.community_uuid.replace('community_', '')
  const timeAgo = dayjs(discussion.creation_date).fromNow()
  const createdDate = dayjs(discussion.creation_date).format('MMM D, YYYY')
  const labelInfo = getLabelInfo(discussion.label || 'general')

  const authorName = discussion.author
    ? `${discussion.author.first_name} ${discussion.author.last_name}`.trim() || discussion.author.username
    : t('common.unknown')

  return (
    <div className="space-y-4">
      {/* Author Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
            {t('communities.sidebar.posted_by')}
          </div>
          <div className="flex items-center gap-3">
            <UserAvatar
              width={44}
              rounded="rounded-full"
              avatar_url={getAvatarUrl(discussion.author) || undefined}
              predefined_avatar={discussion.author?.avatar_image ? undefined : 'empty'}
              showProfilePopup={true}
              userId={discussion.author?.id?.toString()}
              shadow="shadow-none"
            />
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 truncate text-sm">{authorName}</div>
              <div className="text-xs text-slate-500 font-medium">{timeAgo}</div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="px-4 py-3 space-y-3">
          {/* Upvotes */}
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-medium text-slate-600">{t('communities.sidebar.upvotes')}</span>
            <UpvoteButton
              discussionUuid={discussion.discussion_uuid}
              initialVoteCount={discussion.upvote_count}
              initialHasVoted={discussion.has_voted}
              compact
            />
          </div>

          {/* Label */}
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-medium text-slate-600">{t('communities.sidebar.category')}</span>
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold"
              style={{
                backgroundColor: `${labelInfo.color}15`,
                color: labelInfo.color,
                border: `1px solid ${labelInfo.color}30`,
              }}
            >
              {t(`communities.labels.${labelInfo.id}`)}
            </span>
          </div>

          {/* Date */}
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-medium text-slate-600">{t('communities.sidebar.created')}</span>
            <span className="text-xs sm:text-sm font-semibold text-slate-900">{createdDate}</span>
          </div>

          {/* Status badges */}
          {(discussion.is_pinned || discussion.is_locked) && (
            <div className="flex items-center gap-2 pt-2.5 border-t border-slate-100">
              {discussion.is_pinned && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/70 rounded-full">
                  <Pin size={11} />
                  {t('communities.sidebar.pinned')}
                </span>
              )}
              {discussion.is_locked && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200/70 rounded-full">
                  <Lock size={11} />
                  {t('communities.sidebar.locked')}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reactions Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">
          {t('communities.sidebar.reactions')}
        </div>
        <ReactionButton discussionUuid={discussion.discussion_uuid} />
      </div>

      {/* Community Link */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
          {t('communities.sidebar.community')}
        </div>
        <Link
          href={getUriWithOrg(orgslug, `/connect/${communityId}`)}
          className="group flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-[#FF5A1F] transition-colors"
        >
          <MessageCircle size={15} className="text-slate-400 group-hover:text-[#FF5A1F] transition-colors" />
          {community.name}
        </Link>
      </div>
    </div>
  )
}

export default DiscussionSidebar
