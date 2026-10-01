'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  MessageSquare,
  Pin,
  Lock,
  ArrowUp,
  Check,
  HelpCircle,
  Lightbulb,
  Megaphone,
  Star,
} from 'lucide-react'
import {
  DiscussionWithAuthor,
  DiscussionAuthor,
  getLabelInfo,
} from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import UserAvatar from '@components/Objects/UserAvatar'
import { cn } from '@/lib/utils'

dayjs.extend(relativeTime)

function getAvatarUrl(author: DiscussionAuthor | null): string | null {
  if (!author?.avatar_image) return null
  if (author.avatar_image.startsWith('http://') || author.avatar_image.startsWith('https://')) {
    return author.avatar_image
  }
  return getUserAvatarMediaDirectory(author.user_uuid, author.avatar_image)
}

function getLabelIcon(iconName: string, size: number = 11) {
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

function getContentSnippet(content: string | null): string {
  if (!content) return ''
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      const extractText = (node: any): string => {
        if (!node) return ''
        if (node.type === 'text') return node.text || ''
        if (node.content && Array.isArray(node.content)) {
          return node.content.map(extractText).join(' ')
        }
        return ''
      }
      return extractText(parsed).trim()
    }
  } catch {
    // not JSON
  }
  return content.trim()
}

interface DiscussionChatItemProps {
  discussion: DiscussionWithAuthor
  isSelected: boolean
  onClick: () => void
  commentCount?: number
  isSelectMode?: boolean
  isMultiSelected?: boolean
  onToggleMultiSelect?: () => void
}

export function DiscussionChatItem({
  discussion,
  isSelected,
  onClick,
  commentCount = 0,
  isSelectMode = false,
  isMultiSelected = false,
  onToggleMultiSelect,
}: DiscussionChatItemProps) {
  const { t } = useTranslation()
  const labelInfo = getLabelInfo(discussion.label || 'general')
  const timeAgo = dayjs(discussion.creation_date).fromNow(true)
  const snippet = getContentSnippet(discussion.content)
  const authorName = discussion.author
    ? `${discussion.author.first_name} ${discussion.author.last_name}`.trim() || discussion.author.username
    : t('common.unknown')

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectMode) {
      e.preventDefault()
      onToggleMultiSelect?.()
      return
    }
    onClick()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full text-start p-3 transition-colors border-b border-border/60 flex items-start gap-3 relative focus:outline-none focus-visible:bg-accent/40',
        isSelected
          ? 'bg-accent/70 border-s-4 border-s-primary'
          : 'hover:bg-accent/30 bg-card',
        discussion.is_pinned && !isSelected && 'bg-amber-50/20'
      )}
    >
      {/* Checkbox in select mode */}
      {isSelectMode && (
        <div className="flex-shrink-0 pt-1">
          <div
            className={cn(
              'w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
              isMultiSelected
                ? 'bg-primary border-primary text-primary-foreground'
                : 'border-border bg-background'
            )}
          >
            {isMultiSelected && <Check size={10} />}
          </div>
        </div>
      )}

      {/* Avatar or Emoji */}
      <div className="flex-shrink-0 relative pt-0.5">
        {discussion.emoji ? (
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg flex-shrink-0">
            {discussion.emoji}
          </div>
        ) : (
          <UserAvatar
            width={40}
            rounded="rounded-full"
            avatar_url={getAvatarUrl(discussion.author) || undefined}
            predefined_avatar={discussion.author?.avatar_image ? undefined : 'empty'}
            showProfilePopup={false}
            userId={discussion.author?.id?.toString()}
            shadow="shadow-none"
          />
        )}
      </div>

      {/* Content preview */}
      <div className="flex-1 min-w-0">
        {/* Row 1: Title & Timestamp */}
        <div className="flex items-center justify-between gap-1.5 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {discussion.is_pinned && (
              <Pin size={11} className="text-amber-500 flex-shrink-0" />
            )}
            {discussion.is_locked && (
              <Lock size={11} className="text-muted-foreground flex-shrink-0" />
            )}
            <h4
              className={cn(
                'text-sm truncate leading-snug',
                isSelected ? 'font-bold text-foreground' : 'font-semibold text-foreground/90'
              )}
              dir="auto"
            >
              {discussion.title}
            </h4>
          </div>
          <span className="text-[11px] text-muted-foreground flex-shrink-0">
            {timeAgo}
          </span>
        </div>

        {/* Row 2: Author & Snippet Preview */}
        <p className="text-xs text-muted-foreground truncate leading-relaxed mb-1.5" dir="auto">
          <span className="text-foreground/80 font-medium">{authorName}: </span>
          {snippet || t('communities.discussion_detail.no_details')}
        </p>

        {/* Row 3: Label Tag & Counters */}
        <div className="flex items-center justify-between gap-2">
          {/* Label tag */}
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{
              backgroundColor: `${labelInfo.color}15`,
              color: labelInfo.color,
            }}
          >
            {getLabelIcon(labelInfo.icon, 10)}
            {t(`communities.labels.${discussion.label || 'general'}`)}
          </span>

          {/* Counts */}
          <div className="flex items-center gap-2 text-muted-foreground text-[11px]">
            {discussion.upvote_count > 0 && (
              <span className="inline-flex items-center gap-0.5 font-medium">
                <ArrowUp size={11} />
                {discussion.upvote_count}
              </span>
            )}
            <span className="inline-flex items-center gap-0.5">
              <MessageSquare size={11} />
              {commentCount}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

export default DiscussionChatItem
