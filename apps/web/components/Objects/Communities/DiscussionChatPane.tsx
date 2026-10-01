'use client'
import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  ChevronLeft,
  Pin,
  Lock,
  MoreVertical,
  Edit,
  Trash2,
  Loader2,
  AlertCircle,
  UserPlus,
  User,
  Send,
  HelpCircle,
  Lightbulb,
  Megaphone,
  Star,
  MessageSquare,
  Smile,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import {
  DiscussionWithAuthor,
  DiscussionAuthor,
  DiscussionCommentWithAuthor,
  getLabelInfo,
  pinDiscussion,
  lockDiscussion,
  deleteDiscussion,
  getComments,
  createComment,
} from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { UpvoteButton } from './UpvoteButton'
import { ReactionButton } from './ReactionButton'
import { CommentCard } from './CommentCard'
import { DiscussionContent } from './DiscussionContent'
import UserAvatar from '@components/Objects/UserAvatar'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@components/ui/popover'
import { Button } from '@components/ui/button'
import { useVBAnalytics, AnalyticsEvent } from '@services/analytics'
import { cn } from '@/lib/utils'

dayjs.extend(relativeTime)

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥', '💡', '💯', '🚀', '👀']

function getAvatarUrl(author: DiscussionAuthor | null): string | null {
  if (!author?.avatar_image) return null
  if (author.avatar_image.startsWith('http://') || author.avatar_image.startsWith('https://')) {
    return author.avatar_image
  }
  return getUserAvatarMediaDirectory(author.user_uuid, author.avatar_image)
}

function parseDiscussionContent(content: string | null): any {
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return parsed
    }
    return content
  } catch {
    return content
  }
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

interface DiscussionChatPaneProps {
  discussion: DiscussionWithAuthor
  communityUuid: string
  orgslug: string
  onBack?: () => void
  onEdit?: () => void
  onDiscussionUpdate?: (updated: DiscussionWithAuthor) => void
  onDiscussionDelete?: (discussionUuid: string) => void
  allowRichContent?: boolean
}

export function DiscussionChatPane({
  discussion,
  communityUuid,
  onBack,
  onEdit,
  onDiscussionUpdate,
  onDiscussionDelete,
  allowRichContent = false,
}: DiscussionChatPaneProps) {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id
  const isAuthenticated = session?.status === 'authenticated'
  const { isUserPartOfTheOrg } = useOrgMembership()
  const { canManageCommunity } = useCommunityRights(communityUuid)
  const { track } = useVBAnalytics('learner')

  const isAuthor = currentUserId === discussion.author_id
  const canManage = canManageCommunity
  const showActions = isAuthor || canManage
  const canComment = isAuthenticated && isUserPartOfTheOrg

  const timeAgo = dayjs(discussion.creation_date).fromNow()
  const createdDate = dayjs(discussion.creation_date).format('MMM D, YYYY')
  const labelInfo = getLabelInfo(discussion.label || 'general')

  const authorName = discussion.author
    ? `${discussion.author.first_name} ${discussion.author.last_name}`.trim() || discussion.author.username
    : t('common.unknown')

  // Comments state
  const [comments, setComments] = useState<DiscussionCommentWithAuthor[]>([])
  const [isLoadingComments, setIsLoadingComments] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [isComposerEmojiOpen, setIsComposerEmojiOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollBottomRef = useRef<HTMLDivElement>(null)

  // Current user avatar for composer
  const ownAvatarUrl = (() => {
    const avatar = session?.data?.user?.avatar_image
    if (!avatar) return undefined
    if (avatar.startsWith('http://') || avatar.startsWith('https://')) return avatar
    const userUuid = session?.data?.user?.user_uuid
    if (userUuid) return getUserAvatarMediaDirectory(userUuid, avatar)
    return undefined
  })()

  // Fetch comments when discussion changes
  useEffect(() => {
    let stale = false
    setIsLoadingComments(true)

    const fetchThread = async () => {
      try {
        const result = await getComments(discussion.discussion_uuid, 1, 100, null, accessToken)
        if (!stale) {
          setComments(result || [])
        }
      } catch {
        // silent
      } finally {
        if (!stale) {
          setIsLoadingComments(false)
        }
      }
    }

    fetchThread()

    return () => {
      stale = true
    }
  }, [discussion.discussion_uuid, accessToken])

  const handlePin = async () => {
    if (!accessToken) return
    try {
      const updated = await pinDiscussion(discussion.discussion_uuid, !discussion.is_pinned, accessToken)
      onDiscussionUpdate?.(updated)
    } catch (err: any) {
      toast.error(err?.message || t('communities.discussion_card.pin_failed'))
    }
  }

  const handleLock = async () => {
    if (!accessToken) return
    try {
      const updated = await lockDiscussion(discussion.discussion_uuid, !discussion.is_locked, accessToken)
      onDiscussionUpdate?.(updated)
    } catch (err: any) {
      toast.error(err?.message || t('communities.discussion_card.lock_failed'))
    }
  }

  const handleDelete = async () => {
    if (!accessToken) return
    try {
      await deleteDiscussion(discussion.discussion_uuid, accessToken)
      onDiscussionDelete?.(discussion.discussion_uuid)
    } catch (err: any) {
      toast.error(err?.message || t('communities.discussion_detail.delete_failed'))
    }
  }

  const handleSubmitReply = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!newComment.trim() || !canComment || isSubmitting || discussion.is_locked) return

    setIsSubmitting(true)
    setCommentError(null)
    try {
      const comment = await createComment(
        discussion.discussion_uuid,
        { content: newComment.trim() },
        accessToken
      )
      track(AnalyticsEvent.CommentPosted, {
        existing_comment_count: comments.length,
        is_locked: discussion.is_locked,
      })
      setComments((prev) => [...prev, comment])
      setNewComment('')
      setTimeout(() => {
        scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 50)
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.comments.failed_to_post')
      setCommentError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmitReply()
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background/50">
      {/* 1. Active Chat Top Bar (Clean header without reactions) */}
      <div className="h-16 px-4 md:px-5 border-b border-border flex items-center justify-between bg-card flex-shrink-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile Back Button */}
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="md:hidden h-8 w-8 -ms-1 text-muted-foreground hover:text-foreground"
              aria-label="Back to discussions"
            >
              <ChevronLeft size={20} />
            </Button>
          )}

          {/* Author Avatar */}
          <div className="flex-shrink-0">
            {discussion.emoji ? (
              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-lg">
                {discussion.emoji}
              </div>
            ) : (
              <UserAvatar
                width={36}
                rounded="rounded-full"
                avatar_url={getAvatarUrl(discussion.author) || undefined}
                predefined_avatar={discussion.author?.avatar_image ? undefined : 'empty'}
                showProfilePopup={true}
                userId={discussion.author?.id?.toString()}
                shadow="shadow-none"
              />
            )}
          </div>

          {/* Title and metadata */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {discussion.is_pinned && (
                <Pin size={12} className="text-amber-500 flex-shrink-0" />
              )}
              {discussion.is_locked && (
                <Lock size={12} className="text-muted-foreground flex-shrink-0" />
              )}
              <h2
                className="text-sm md:text-base font-bold text-foreground truncate leading-tight"
                dir="auto"
                title={discussion.title}
              >
                {discussion.title}
              </h2>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground/80">{authorName}</span>
              <span>·</span>
              <time dateTime={discussion.creation_date} title={createdDate}>{timeAgo}</time>
              <span>·</span>
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-medium"
                style={{
                  backgroundColor: `${labelInfo.color}15`,
                  color: labelInfo.color,
                }}
              >
                {getLabelIcon(labelInfo.icon, 10)}
                {t(`communities.labels.${labelInfo.id}`)}
              </span>
            </div>
          </div>
        </div>

        {/* Right action controls: More options menu */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {showActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  aria-label="Discussion options"
                >
                  <MoreVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {canManage && (
                  <>
                    <DropdownMenuItem onClick={handlePin} className="cursor-pointer">
                      <Pin size={13} className="me-2" />
                      {discussion.is_pinned
                        ? t('communities.discussion_card.unpin_discussion')
                        : t('communities.discussion_card.pin_discussion')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleLock} className="cursor-pointer">
                      <Lock size={13} className="me-2" />
                      {discussion.is_locked
                        ? t('communities.discussion_card.unlock_discussion')
                        : t('communities.discussion_card.lock_discussion')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {onEdit && isAuthor && (
                  <DropdownMenuItem onClick={onEdit} className="cursor-pointer">
                    <Edit size={13} className="me-2" />
                    {t('communities.discussion_detail.edit')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <ConfirmationModal
                    confirmationMessage={t('communities.discussion_detail.delete_confirm')}
                    confirmationButtonText={t('communities.discussion_detail.delete_button')}
                    dialogTitle={t('communities.discussion_detail.delete_title')}
                    dialogTrigger={
                      <button className="w-full text-start flex items-center px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-sm transition-colors cursor-pointer">
                        <Trash2 size={13} className="me-2" />
                        {t('communities.discussion_detail.delete')}
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
      </div>

      {/* 2. Scrollable Discussion Content & Replies Stream */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 min-h-0">
        {/* Original Discussion Post Card */}
        <div className="bg-card border border-border rounded-xl p-4 md:p-5 shadow-xs">
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border/60">
            <UserAvatar
              width={28}
              rounded="rounded-full"
              avatar_url={getAvatarUrl(discussion.author) || undefined}
              predefined_avatar={discussion.author?.avatar_image ? undefined : 'empty'}
              showProfilePopup={true}
              userId={discussion.author?.id?.toString()}
              shadow="shadow-none"
            />
            <div className="text-xs">
              <span className="font-semibold text-foreground">{authorName}</span>
              <span className="text-muted-foreground ms-1.5">started the discussion</span>
            </div>
          </div>

          {/* Post Content */}
          {discussion.content ? (
            <div className="prose prose-sm max-w-none text-foreground/90">
              <DiscussionContent
                content={parseDiscussionContent(discussion.content)}
                allowRichContent={allowRichContent}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              {t('communities.discussion_detail.no_details')}
            </p>
          )}

          {/* Post Footer: WhatsApp-style Reactions & Upvotes positioned at the bottom of the message */}
          <div className="pt-3 mt-4 border-t border-border/60 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <ReactionButton discussionUuid={discussion.discussion_uuid} />
            </div>

            <div className="flex items-center gap-2">
              <UpvoteButton
                discussionUuid={discussion.discussion_uuid}
                initialVoteCount={discussion.upvote_count}
                initialHasVoted={discussion.has_voted}
                compact
              />
            </div>
          </div>
        </div>

        {/* Replies Section Header */}
        <div className="flex items-center gap-2 pt-2">
          <div className="h-px bg-border flex-1" />
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
            <MessageSquare size={13} />
            {t('communities.comments.replies', { defaultValue: 'Replies' })}
            {!isLoadingComments && (
              <span>({comments.length})</span>
            )}
          </div>
          <div className="h-px bg-border flex-1" />
        </div>

        {/* Replies List */}
        {isLoadingComments ? (
          <div className="py-8 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">{t('communities.comments.loading', { defaultValue: 'Loading replies…' })}</span>
          </div>
        ) : comments.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground text-xs">
            {t('communities.comments.no_replies', { defaultValue: 'No replies yet. Be the first to reply!' })}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border/60">
            {comments.map((comment) => (
              <CommentCard
                key={comment.comment_uuid}
                comment={comment}
                canManage={canManageCommunity}
                onDeleted={(commentUuid) => {
                  setComments((prev) => prev.filter((c) => c.comment_uuid !== commentUuid))
                }}
                onUpdated={(updated) => {
                  setComments((prev) =>
                    prev.map((c) => (c.comment_uuid === updated.comment_uuid ? updated : c))
                  )
                }}
              />
            ))}
          </div>
        )}

        <div ref={scrollBottomRef} />
      </div>

      {/* 3. Docked WhatsApp-style Bottom Composer */}
      <div className="p-3 md:p-4 bg-card border-t border-border flex-shrink-0 z-10">
        {discussion.is_locked ? (
          <div className="flex items-center gap-2.5 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-700 text-xs">
            <Lock size={14} className="flex-shrink-0" />
            <span>{t('communities.comments.locked')}</span>
          </div>
        ) : canComment ? (
          <div>
            {commentError && (
              <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-xs">
                <AlertCircle size={13} className="flex-shrink-0" />
                <span>{commentError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitReply} className="flex items-end gap-2.5">
              {/* User avatar */}
              <div className="hidden sm:block flex-shrink-0 mb-1">
                <UserAvatar
                  width={28}
                  rounded="rounded-full"
                  avatar_url={ownAvatarUrl}
                  predefined_avatar={ownAvatarUrl ? undefined : 'empty'}
                  showProfilePopup={false}
                  shadow="shadow-none"
                />
              </div>

              {/* Textarea container with bottom toolbar containing emoji picker */}
              <div className="flex-1 bg-muted/40 border border-border rounded-xl focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all flex flex-col">
                <textarea
                  dir="auto"
                  ref={textareaRef}
                  value={newComment}
                  onChange={(e) => {
                    setNewComment(e.target.value)
                    if (commentError) setCommentError(null)
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={t('communities.comments.write_reply')}
                  rows={2}
                  className="w-full px-3 py-2 text-sm bg-transparent outline-none resize-none placeholder:text-muted-foreground"
                />

                {/* Composer footer tools with WhatsApp emoji picker */}
                <div className="flex items-center justify-between px-2.5 py-1 border-t border-border/40">
                  <div className="flex items-center gap-1">
                    <Popover open={isComposerEmojiOpen} onOpenChange={setIsComposerEmojiOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                          title="Insert emoji"
                          aria-label="Insert emoji"
                        >
                          <Smile size={16} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-auto p-1.5 bg-card/95 backdrop-blur-md border border-border rounded-full shadow-lg"
                        align="start"
                        side="top"
                        sideOffset={6}
                        style={{ zIndex: 9999 }}
                      >
                        <div className="flex items-center gap-0.5 px-1">
                          {QUICK_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => {
                                setNewComment((prev) => prev + emoji)
                                setIsComposerEmojiOpen(false)
                                textareaRef.current?.focus()
                              }}
                              className="w-8 h-8 flex items-center justify-center text-lg rounded-full transition-transform hover:scale-125 cursor-pointer hover:bg-muted/70"
                              aria-label={`Insert emoji ${emoji}`}
                            >
                              <span>{emoji}</span>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <span className="text-[10px] text-muted-foreground hidden sm:inline">
                    {t('communities.comments.submit_hint', { defaultValue: 'Press ⌘ + Enter to send' })}
                  </span>
                </div>
              </div>

              {/* Send Button */}
              <Button
                type="submit"
                size="sm"
                disabled={!newComment.trim() || isSubmitting}
                className="h-10 px-3.5 rounded-xl flex-shrink-0"
              >
                {isSubmitting ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <>
                    <Send size={14} className="sm:me-1.5" />
                    <span className="hidden sm:inline">{t('communities.comments.reply')}</span>
                  </>
                )}
              </Button>
            </form>
          </div>
        ) : isAuthenticated && !isUserPartOfTheOrg ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-700 text-xs">
            <UserPlus size={14} className="flex-shrink-0" />
            <span>{t('communities.comments.join_org_to_reply')}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 bg-muted border border-border rounded-lg text-muted-foreground text-xs">
            <User size={14} className="flex-shrink-0" />
            <span>
              <span className="font-semibold text-foreground">{t('communities.comments.sign_in_to_reply')}</span>{' '}
              {t('communities.comments.to_reply')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default DiscussionChatPane
