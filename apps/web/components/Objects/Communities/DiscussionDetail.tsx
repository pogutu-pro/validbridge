'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)
import { Edit, Trash2, MoreVertical, Pin, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import UserAvatar from '@components/Objects/UserAvatar'
import { useRouter } from 'next/navigation'
import { getUriWithOrg } from '@services/config/config'
import { DiscussionWithAuthor, DiscussionAuthor, deleteDiscussion, getLabelInfo } from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { CommentSection } from './CommentSection'
import { DiscussionContent } from './DiscussionContent'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import { Button } from '@components/ui/button'

interface DiscussionDetailProps {
  discussion: DiscussionWithAuthor
  communityUuid: string
  orgslug: string
  onEdit?: () => void
  allowRichContent?: boolean
}

/**
 * Parse discussion content - handles both JSON (tiptap) and plain text (legacy)
 */
function parseDiscussionContent(content: string | null): any {
  if (!content) return null

  // Try to parse as JSON (tiptap content)
  try {
    const parsed = JSON.parse(content)
    // Verify it looks like tiptap content
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return parsed
    }
    // Not tiptap format, return as string
    return content
  } catch {
    // Not JSON, return as plain text
    return content
  }
}

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

export function DiscussionDetail({
  discussion,
  communityUuid,
  orgslug,
  onEdit,
  allowRichContent = false,
}: DiscussionDetailProps) {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const router = useRouter()
  const communityId = communityUuid.replace('community_', '')
  const accessToken = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id

  const timeAgo = dayjs(discussion.creation_date).fromNow()
  const createdDate = dayjs(discussion.creation_date).format('MMM D, YYYY')
  const isAuthor = currentUserId === discussion.author_id
  const labelInfo = getLabelInfo(discussion.label || 'general')

  const authorName = discussion.author
    ? `${discussion.author.first_name} ${discussion.author.last_name}`.trim() || discussion.author.username
    : t('common.unknown')

  const handleDelete = async () => {
    try {
      await deleteDiscussion(discussion.discussion_uuid, accessToken)
      router.push(getUriWithOrg(orgslug, `/connect/${communityId}`))
      router.refresh()
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.discussion_detail.delete_failed')
      toast.error(message)
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-5 pb-4 border-b border-border">
        {/* Title Row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Status badges above title */}
            {(discussion.is_pinned || discussion.is_locked) && (
              <div className="flex items-center gap-2 mb-2">
                {discussion.is_pinned && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 rounded-full">
                    <Pin size={10} />
                    {t('communities.sidebar.pinned')}
                  </span>
                )}
                {discussion.is_locked && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground rounded-full">
                    <Lock size={10} />
                    {t('communities.sidebar.locked')}
                  </span>
                )}
              </div>
            )}

            <h1 className="text-xl font-bold text-foreground break-words flex items-start gap-2.5 leading-snug">
              {discussion.emoji && (
                <span className="text-2xl flex-shrink-0 leading-tight">{discussion.emoji}</span>
              )}
              <span dir="auto">{discussion.title}</span>
            </h1>

            {/* Label + category */}
            <div className="mt-2 flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
                style={{
                  backgroundColor: `${labelInfo.color}18`,
                  color: labelInfo.color,
                }}
              >
                {t(`communities.labels.${labelInfo.id}`)}
              </span>
            </div>
          </div>

          {isAuthor && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex-shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
                  aria-label="Discussion options"
                >
                  <MoreVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {onEdit && (
                  <DropdownMenuItem onClick={onEdit}>
                    <Edit className="me-2 h-4 w-4" />
                    {t('communities.discussion_detail.edit')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <ConfirmationModal
                    confirmationMessage={t('communities.discussion_detail.delete_confirm')}
                    confirmationButtonText={t('communities.discussion_detail.delete_button')}
                    dialogTitle={t('communities.discussion_detail.delete_title')}
                    dialogTrigger={
                      <button className="w-full text-start flex items-center px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-md transition-colors">
                        <Trash2 className="me-2 h-4 w-4" /> {t('communities.discussion_detail.delete')}
                      </button>
                    }
                    functionToExecute={handleDelete}
                    status="warning"
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Author info — visible on all screen sizes */}
        <div className="mt-4 flex items-center gap-2.5">
          <UserAvatar
            width={32}
            rounded="rounded-full"
            avatar_url={getAvatarUrl(discussion.author) || undefined}
            predefined_avatar={discussion.author?.avatar_image ? undefined : 'empty'}
            showProfilePopup={true}
            userId={discussion.author?.id?.toString()}
            shadow="shadow-none"
          />
          <div>
            <div className="text-sm font-semibold text-foreground">{authorName}</div>
            <div className="text-xs text-muted-foreground">
              <time dateTime={discussion.creation_date} title={createdDate}>{timeAgo}</time>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        {discussion.content ? (
          <div className="prose prose-gray max-w-none text-sm">
            <DiscussionContent
              content={parseDiscussionContent(discussion.content)}
              allowRichContent={allowRichContent}
            />
          </div>
        ) : (
          <p className="text-muted-foreground italic text-sm">{t('communities.discussion_detail.no_details')}</p>
        )}
      </div>

      {/* Comments Section */}
      <div className="border-t border-border">
        <CommentSection
          discussionUuid={discussion.discussion_uuid}
          communityUuid={communityUuid}
          isLocked={discussion.is_locked}
        />
      </div>
    </div>
  )
}

export default DiscussionDetail
