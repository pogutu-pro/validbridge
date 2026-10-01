'use client'
import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, AlertCircle, Lock, UserPlus, MessageSquare, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import {
  getComments,
  createComment,
  DiscussionCommentWithAuthor,
} from '@services/communities/discussions'
import { CommentCard } from './CommentCard'
import { useVBAnalytics, AnalyticsEvent } from '@services/analytics'
import { Button } from '@components/ui/button'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { cn } from '@/lib/utils'

interface CommentSectionProps {
  discussionUuid: string
  communityUuid?: string
  isLocked?: boolean
}

export function CommentSection({ discussionUuid, communityUuid, isLocked = false }: CommentSectionProps) {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const { isUserPartOfTheOrg } = useOrgMembership()
  const { canManageCommunity } = useCommunityRights(communityUuid || '')
  const { track } = useVBAnalytics('learner')
  const canComment = isAuthenticated && isUserPartOfTheOrg

  const [comments, setComments] = useState<DiscussionCommentWithAuthor[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Compute own avatar URL
  const ownAvatarUrl = (() => {
    const avatar = session?.data?.user?.avatar_image
    if (!avatar) return undefined
    if (avatar.startsWith('http://') || avatar.startsWith('https://')) return avatar
    const userUuid = session?.data?.user?.user_uuid
    if (userUuid) return getUserAvatarMediaDirectory(userUuid, avatar)
    return undefined
  })()

  useEffect(() => {
    let stale = false

    const fetchComments = async () => {
      setIsLoading(true)
      try {
        const result = await getComments(discussionUuid, 1, 100, null, accessToken)
        if (!stale) {
          setComments(result || [])
        }
      } catch {
        // silent — loading errors handled by empty state below
      } finally {
        if (!stale) {
          setIsLoading(false)
        }
      }
    }

    fetchComments()

    return () => { stale = true }
  }, [discussionUuid, accessToken])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim() || !canComment || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const comment = await createComment(
        discussionUuid,
        { content: newComment.trim() },
        accessToken
      )
      track(AnalyticsEvent.CommentPosted, {
        existing_comment_count: comments.length,
        is_locked: isLocked,
      })
      setComments((prev) => [...prev, comment])
      setNewComment('')
      setIsFocused(false)
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.comments.failed_to_post')
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e as any)
    }
  }

  const handleCommentDeleted = (commentUuid: string) => {
    setComments((prev) => prev.filter((c) => c.comment_uuid !== commentUuid))
  }

  const handleCommentUpdated = (updatedComment: DiscussionCommentWithAuthor) => {
    setComments((prev) =>
      prev.map((c) =>
        c.comment_uuid === updatedComment.comment_uuid ? updatedComment : c
      )
    )
  }

  return (
    <div>
      {/* Replies Header */}
      <div className="px-5 py-3 flex items-center gap-2">
        <MessageSquare size={15} className="text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">
          {t('communities.comments.replies', { defaultValue: 'Replies' })}
          {!isLoading && comments.length > 0 && (
            <span className="ms-1.5 text-muted-foreground font-normal text-xs">({comments.length})</span>
          )}
        </h3>
      </div>

      {/* Comment List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">{t('communities.comments.loading', { defaultValue: 'Loading replies…' })}</span>
        </div>
      ) : comments.length === 0 ? (
        <div className="py-6 px-5 text-center border-t border-border">
          <p className="text-sm text-muted-foreground">{t('communities.comments.no_replies')}</p>
        </div>
      ) : (
        <div className="border-t border-border">
          {comments.map((comment) => (
            <CommentCard
              key={comment.comment_uuid}
              comment={comment}
              canManage={canManageCommunity}
              onDeleted={handleCommentDeleted}
              onUpdated={handleCommentUpdated}
            />
          ))}
        </div>
      )}

      {/* Reply Composer */}
      <div className="px-5 py-4 border-t border-border">
        {isLocked ? (
          <div className="flex items-center gap-2.5 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
            <Lock size={14} className="text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-700">{t('communities.comments.locked')}</p>
          </div>
        ) : canComment ? (
          <div>
            {error && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                <AlertCircle size={14} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="flex items-start gap-3">
                {/* Own avatar */}
                <div className="flex-shrink-0 pt-0.5">
                  <UserAvatar
                    width={28}
                    rounded="rounded-full"
                    avatar_url={ownAvatarUrl}
                    predefined_avatar={ownAvatarUrl ? undefined : 'empty'}
                    showProfilePopup={false}
                    shadow="shadow-none"
                  />
                </div>

                {/* Input area */}
                <div className="flex-1">
                  <div
                    className={cn(
                      'rounded-lg border transition-all',
                      error
                        ? 'border-destructive ring-1 ring-destructive/30'
                        : isFocused
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-border'
                    )}
                  >
                    <textarea
                      dir="auto"
                      ref={textareaRef}
                      value={newComment}
                      onChange={(e) => {
                        setNewComment(e.target.value)
                        if (error) setError(null)
                      }}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => !newComment && setIsFocused(false)}
                      onKeyDown={handleKeyDown}
                      aria-label={t('communities.comments.write_reply')}
                      placeholder={t('communities.comments.write_reply')}
                      rows={isFocused || newComment ? 2 : 1}
                      className="w-full px-3 py-2 text-sm bg-transparent outline-none resize-none placeholder:text-muted-foreground rounded-t-lg"
                    />

                    {(isFocused || newComment) && (
                      <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/30 rounded-b-lg">
                        <span className="text-xs text-muted-foreground hidden sm:inline">
                          {t('communities.comments.submit_hint', { defaultValue: '⌘↩ to submit' })}
                        </span>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={!newComment.trim() || isSubmitting}
                          className="h-7 px-3 text-xs ms-auto"
                        >
                          {isSubmitting ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            t('communities.comments.reply')
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </div>
        ) : isAuthenticated && !isUserPartOfTheOrg ? (
          <div className="flex items-center gap-2.5 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
            <UserPlus size={14} className="text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-700">
              {t('communities.comments.join_org_to_reply')}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 px-3 py-2.5 bg-muted border border-border rounded-lg">
            <User size={14} className="text-muted-foreground flex-shrink-0" />
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{t('communities.comments.sign_in_to_reply')}</span>{' '}
              {t('communities.comments.to_reply')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default CommentSection
