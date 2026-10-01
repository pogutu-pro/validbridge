'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { MessageCircle, Pin, Lock, ChevronRight } from 'lucide-react'
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

export function DiscussionSidebar({ discussion, community, orgslug }: DiscussionSidebarProps) {
  const { t } = useTranslation()
  const communityId = community.community_uuid.replace('community_', '')
  const timeAgo = dayjs(discussion.creation_date).fromNow()
  const createdDate = dayjs(discussion.creation_date).format('MMM D, YYYY')
  const labelInfo = getLabelInfo(discussion.label || 'general')

  const authorName = discussion.author
    ? `${discussion.author.first_name} ${discussion.author.last_name}`.trim() || discussion.author.username
    : t('common.unknown')

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Author Section */}
      <div className="p-4 border-b border-border">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {t('communities.sidebar.posted_by')}
        </div>
        <div className="flex items-center gap-3">
          <UserAvatar
            width={40}
            rounded="rounded-full"
            avatar_url={getAvatarUrl(discussion.author) || undefined}
            predefined_avatar={discussion.author?.avatar_image ? undefined : 'empty'}
            showProfilePopup={true}
            userId={discussion.author?.id?.toString()}
            shadow="shadow-none"
          />
          <div className="min-w-0">
            <div className="font-semibold text-sm text-foreground truncate">{authorName}</div>
            <div className="text-xs text-muted-foreground">
              <time dateTime={discussion.creation_date} title={createdDate}>{timeAgo}</time>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="px-4 py-3 border-b border-border space-y-3">
        {/* Upvotes */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('communities.sidebar.upvotes')}</span>
          <UpvoteButton
            discussionUuid={discussion.discussion_uuid}
            initialVoteCount={discussion.upvote_count}
            initialHasVoted={discussion.has_voted}
            compact
          />
        </div>

        {/* Label */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('communities.sidebar.category')}</span>
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
            style={{
              backgroundColor: `${labelInfo.color}15`,
              color: labelInfo.color,
            }}
          >
            {t(`communities.labels.${labelInfo.id}`)}
          </span>
        </div>

        {/* Created date */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('communities.sidebar.created')}</span>
          <span className="text-xs text-foreground">{createdDate}</span>
        </div>

        {/* Status Badges */}
        {(discussion.is_pinned || discussion.is_locked) && (
          <div className="flex items-center gap-2 pt-1">
            {discussion.is_pinned && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 rounded-full">
                <Pin size={9} />
                {t('communities.sidebar.pinned')}
              </span>
            )}
            {discussion.is_locked && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground rounded-full">
                <Lock size={9} />
                {t('communities.sidebar.locked')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Reactions Section */}
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
          {t('communities.sidebar.reactions')}
        </div>
        <ReactionButton discussionUuid={discussion.discussion_uuid} />
      </div>

      {/* Community Link */}
      <div className="px-4 py-3">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('communities.sidebar.community')}
        </div>
        <Link
          href={getUriWithOrg(orgslug, `/connect/${communityId}`)}
          className="group flex items-center justify-between py-1.5 px-2 -mx-2 rounded-lg hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <MessageCircle size={14} className="text-muted-foreground group-hover:text-primary flex-shrink-0 transition-colors" />
            <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
              {community.name}
            </span>
          </div>
          <ChevronRight size={13} className="text-muted-foreground group-hover:text-primary flex-shrink-0 transition-colors" />
        </Link>
      </div>
    </div>
  )
}

export default DiscussionSidebar
