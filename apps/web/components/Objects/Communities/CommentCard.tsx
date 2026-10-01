'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { MoreHorizontal, Pencil, Trash2, Loader2, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import {
  DiscussionCommentWithAuthor,
  DiscussionAuthor,
  updateComment,
  deleteComment,
} from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import { Button } from '@components/ui/button'
import UserAvatar from '@components/Objects/UserAvatar'
import { CommentUpvoteButton } from './CommentUpvoteButton'
import { cn } from '@/lib/utils'

dayjs.extend(relativeTime)

function getAvatarUrl(author: DiscussionAuthor | null): string | null {
  if (!author?.avatar_image) return null
  if (author.avatar_image.startsWith('http://') || author.avatar_image.startsWith('https://')) {
    return author.avatar_image
  }
  return getUserAvatarMediaDirectory(author.user_uuid, author.avatar_image)
}

interface CommentCardProps {
  comment: DiscussionCommentWithAuthor
  canManage?: boolean
  onDeleted: (commentUuid: string) => void
  onUpdated: (comment: DiscussionCommentWithAuthor) => void
}

export function CommentCard({ comment, canManage = false, onDeleted, onUpdated }: CommentCardProps) {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(comment.content)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAuthor = currentUserId === comment.author_id
  const canDelete = isAuthor || canManage
  const showMenu = isAuthor || canManage
  const timeAgo = dayjs(comment.creation_date).fromNow()
  const createdDate = dayjs(comment.creation_date).format('MMM D, YYYY')
  const authorName = comment.author
    ? `${comment.author.first_name} ${comment.author.last_name}`.trim() || comment.author.username
    : t('common.unknown')

  const handleEdit = async () => {
    if (!editContent.trim() || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const updated = await updateComment(
        comment.comment_uuid,
        { content: editContent.trim() },
        accessToken
      )
      onUpdated(updated)
      setIsEditing(false)
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.comments.failed_to_update')
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      await deleteComment(comment.comment_uuid, accessToken)
      onDeleted(comment.comment_uuid)
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.comments.failed_to_delete')
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const cancelEdit = () => {
    setEditContent(comment.content)
    setIsEditing(false)
    setError(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleEdit()
    }
    if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  return (
    <div
      className="group flex items-start gap-3 py-3 px-5 transition-colors border-b border-border last:border-b-0 hover:bg-accent/25"
    >
      {/* Avatar */}
      <div className="flex-shrink-0 pt-0.5">
        <UserAvatar
          width={28}
          rounded="rounded-full"
          avatar_url={getAvatarUrl(comment.author) || undefined}
          predefined_avatar={comment.author?.avatar_image ? undefined : 'empty'}
          showProfilePopup={true}
          userId={comment.author?.id?.toString()}
          shadow="shadow-none"
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="space-y-2">
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                <AlertCircle size={14} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <textarea
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={handleKeyDown}
              rows={2}
              autoFocus
              className={cn(
                'w-full px-3 py-2 text-sm border rounded-lg outline-none transition-all resize-none bg-background focus:ring-2 focus:ring-primary/20',
                error ? 'border-destructive' : 'border-border focus:border-primary'
              )}
            />
            <div className="flex items-center gap-2">
              <Button
                onClick={handleEdit}
                disabled={!editContent.trim() || isSubmitting}
                size="sm"
                className="h-7 px-3 text-xs"
              >
                {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : t('communities.comments.save')}
              </Button>
              <Button
                onClick={cancelEdit}
                disabled={isSubmitting}
                variant="ghost"
                size="sm"
                className="h-7 px-3 text-xs"
              >
                {t('communities.comments.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Author + time */}
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="font-semibold text-sm text-foreground">{authorName}</span>
              <time
                dateTime={comment.creation_date}
                title={createdDate}
                className="text-xs text-muted-foreground"
              >
                {timeAgo}
              </time>
            </div>

            {/* Comment text */}
            <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed" dir="auto">
              {comment.content}
            </p>

            {/* Inline upvote */}
            <div className="mt-1.5">
              <CommentUpvoteButton
                commentUuid={comment.comment_uuid}
                initialVoteCount={comment.upvote_count || 0}
                initialHasVoted={comment.has_voted || false}
              />
            </div>
          </>
        )}
      </div>

      {/* Actions menu — revealed on hover */}
      {showMenu && !isEditing && (
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label={t('communities.comments.actions')}
              >
                <MoreHorizontal size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {isAuthor && (
                <DropdownMenuItem onClick={() => setIsEditing(true)} className="cursor-pointer">
                  <Pencil className="me-2 h-4 w-4" />
                  {t('communities.comments.edit')}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
                >
                  <Trash2 className="me-2 h-4 w-4" />
                  {t('communities.comments.delete')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}

export default CommentCard
