'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)
import {
  MessageSquare,
  Check,
  Pin,
  Lock,
  MoreVertical,
  Trash2,
  HelpCircle,
  Lightbulb,
  Megaphone,
  Star,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { getUriWithOrg } from '@services/config/config'
import {
  DiscussionWithAuthor,
  DiscussionAuthor,
  getLabelInfo,
  pinDiscussion,
  lockDiscussion,
  deleteDiscussion,
} from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { UpvoteButton } from './UpvoteButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import UserAvatar from '@components/Objects/UserAvatar'
import { Button } from '@components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Get the proper avatar URL for a user
 */
function getAvatarUrl(author: DiscussionAuthor | null): string | null {
  if (!author?.avatar_image) return null

  // If it's already a full URL (external auth like Google), use directly
  if (author.avatar_image.startsWith('http://') || author.avatar_image.startsWith('https://')) {
    return author.avatar_image
  }

  // Otherwise construct the media URL
  return getUserAvatarMediaDirectory(author.user_uuid, author.avatar_image)
}

// Get the icon component for a label
function getLabelIcon(iconName: string, size: number = 12) {
  switch (iconName) {
    case 'HelpCircle':
      return <HelpCircle size={size} />
    case 'Lightbulb':
      return <Lightbulb size={size} />
    case 'Megaphone':
      return <Megaphone size={size} />
    case 'Star':
      return <Star size={size} />
    default:
      return <MessageSquare size={size} />
  }
}

interface DiscussionCardProps {
  discussion: DiscussionWithAuthor
  orgslug: string
  communityUuid: string
  onClick?: () => void
  commentCount?: number
  isSelectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
  canManage?: boolean
  onDiscussionUpdate?: (updated: DiscussionWithAuthor) => void
  onDiscussionDelete?: (discussionUuid: string) => void
}

const removeDiscussionPrefix = (discussionId: string) => {
  return discussionId.replace('discussion_', '')
}

export function DiscussionCard({
  discussion,
  orgslug,
  communityUuid,
  onClick,
  commentCount = 0,
  isSelectMode = false,
  isSelected = false,
  onToggleSelect,
  canManage = false,
  onDiscussionUpdate,
  onDiscussionDelete,
}: DiscussionCardProps) {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id

  const discussionId = removeDiscussionPrefix(discussion.discussion_uuid)
  const communityId = communityUuid.replace('community_', '')

  const timeAgo = dayjs(discussion.creation_date).fromNow()

  const authorName = discussion.author
    ? `${discussion.author.first_name} ${discussion.author.last_name}`.trim() || discussion.author.username
    : t('common.unknown')

  const discussionLink = getUriWithOrg(orgslug, `/connect/${communityId}/discussion/${discussionId}`)

  const labelInfo = getLabelInfo(discussion.label || 'general')
  const isOwner = discussion.author_id === currentUserId
  const showActions = canManage || isOwner

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectMode && onToggleSelect) {
      e.preventDefault()
      onToggleSelect()
    }
  }

  const getErrorMessage = (err: any, fallback: string) =>
    (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
    (typeof err?.detail === 'string' && err.detail) ||
    err?.message ||
    fallback

  const handlePin = async () => {
    if (!accessToken) return
    try {
      const updated = await pinDiscussion(discussion.discussion_uuid, !discussion.is_pinned, accessToken)
      onDiscussionUpdate?.(updated)
    } catch (err: any) {
      toast.error(getErrorMessage(err, t('communities.discussion_card.pin_failed')))
    }
  }

  const handleLock = async () => {
    if (!accessToken) return
    try {
      const updated = await lockDiscussion(discussion.discussion_uuid, !discussion.is_locked, accessToken)
      onDiscussionUpdate?.(updated)
    } catch (err: any) {
      toast.error(getErrorMessage(err, t('communities.discussion_card.lock_failed')))
    }
  }

  const handleDelete = async () => {
    if (!accessToken) return
    try {
      await deleteDiscussion(discussion.discussion_uuid, accessToken)
      onDiscussionDelete?.(discussion.discussion_uuid)
    } catch (err: any) {
      toast.error(getErrorMessage(err, t('communities.discussion_card.delete_failed')))
    }
  }

  return (
    <div
      onClick={isSelectMode ? handleClick : undefined}
      className={cn(
        'flex items-center gap-3 py-3 px-4 transition-colors border-b border-border last:border-b-0',
        isSelectMode && 'cursor-pointer',
        isSelected
          ? 'bg-accent/60'
          : discussion.is_pinned
          ? 'bg-amber-50/40'
          : 'hover:bg-accent/30'
      )}
    >
      {/* Checkbox for Select Mode */}
      {isSelectMode && (
        <div className="flex-shrink-0">
          <div
            className={cn(
              'w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
              isSelected
                ? 'bg-primary border-primary'
                : 'border-border bg-background'
            )}
          >
            {isSelected && <Check size={10} className="text-primary-foreground" />}
          </div>
        </div>
      )}

      {/* Upvote Section */}
      {!isSelectMode && (
        <div className="flex-shrink-0 w-10">
          <UpvoteButton
            discussionUuid={discussion.discussion_uuid}
            initialVoteCount={discussion.upvote_count}
            initialHasVoted={discussion.has_voted}
            compact
          />
        </div>
      )}

      {/* Label icon */}
      {!isSelectMode && (
        <div
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
          style={{ backgroundColor: discussion.emoji ? 'hsl(var(--muted))' : `${labelInfo.color}18` }}
        >
          {discussion.emoji ? (
            <span className="text-sm leading-none">{discussion.emoji}</span>
          ) : (
            <span style={{ color: labelInfo.color }}>
              {getLabelIcon(labelInfo.icon, 13)}
            </span>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        {/* Title row */}
        <div className="flex items-center gap-1.5 min-w-0">
          {discussion.is_pinned && (
            <Pin size={11} className="text-amber-500 flex-shrink-0" />
          )}
          {discussion.is_locked && (
            <Lock size={11} className="text-muted-foreground flex-shrink-0" />
          )}
          {isSelectMode ? (
            <span className="text-sm font-semibold text-foreground line-clamp-1" dir="auto">
              {discussion.title}
            </span>
          ) : (
            <Link href={discussionLink} onClick={onClick} className="block group flex-1 min-w-0">
              <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1" dir="auto">
                {discussion.title}
              </span>
            </Link>
          )}
        </div>

        {/* Meta row */}
        <div className="mt-0.5 flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          {/* Label badge */}
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
            style={{
              backgroundColor: `${labelInfo.color}15`,
              color: labelInfo.color,
            }}
          >
            {t(`communities.labels.${discussion.label || 'general'}`)}
          </span>

          <span className="text-border">·</span>

          {isSelectMode ? (
            <span>{authorName}</span>
          ) : (
            <Link href={discussionLink} className="hover:text-foreground hover:underline transition-colors">
              {authorName}
            </Link>
          )}

          <span className="text-border">·</span>
          <span>{timeAgo}</span>
        </div>
      </div>

      {/* Right Side - Author Avatar & Comment Count */}
      {!isSelectMode && (
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {/* Author Avatar */}
          <div className="hidden sm:block">
            <UserAvatar
              width={24}
              rounded="rounded-full"
              avatar_url={getAvatarUrl(discussion.author) || undefined}
              predefined_avatar={discussion.author?.avatar_image ? undefined : 'empty'}
              showProfilePopup={true}
              userId={discussion.author?.id?.toString()}
              shadow="shadow-none"
              border="border-2"
              borderColor="border-background"
            />
          </div>

          {/* Comment Count */}
          <div className="flex items-center gap-1 text-muted-foreground min-w-[36px] justify-end">
            <MessageSquare size={13} />
            <span className="text-xs">{commentCount}</span>
          </div>

          {/* Actions Menu */}
          {showActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {canManage && (
                  <>
                    <DropdownMenuItem onClick={handlePin} className="cursor-pointer">
                      <Pin size={13} className="me-2" />
                      {discussion.is_pinned ? t('communities.discussion_card.unpin_discussion') : t('communities.discussion_card.pin_discussion')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleLock} className="cursor-pointer">
                      <Lock size={13} className="me-2" />
                      {discussion.is_locked ? t('communities.discussion_card.unlock_discussion') : t('communities.discussion_card.lock_discussion')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <ConfirmationModal
                  confirmationMessage={t('communities.discussion_card.delete_confirm')}
                  confirmationButtonText={t('communities.comments.delete')}
                  dialogTitle={t('communities.discussion_card.delete_title')}
                  dialogTrigger={
                    <button className="w-full text-start flex items-center px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-sm transition-colors cursor-pointer">
                      <Trash2 size={13} className="me-2" />
                      {t('communities.discussion_card.delete_discussion')}
                    </button>
                  }
                  functionToExecute={handleDelete}
                  status="warning"
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Show upvote count in select mode */}
      {isSelectMode && (
        <div className="flex items-center gap-1 text-muted-foreground flex-shrink-0">
          <span className="text-xs">{discussion.upvote_count} {t('communities.discussion_card.votes')}</span>
        </div>
      )}
    </div>
  )
}

export default DiscussionCard
