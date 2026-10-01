'use client'
import React, { useState, useEffect } from 'react'
import { SmilePlus, Smile } from 'lucide-react'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import {
  getReactions,
  toggleReaction,
  ReactionSummary,
} from '@services/communities/discussions'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip'
import { useVBAnalytics, AnalyticsEvent } from '@services/analytics'
import { cn } from '@/lib/utils'

// WhatsApp standard reaction emojis + extended favourites
const WHATSAPP_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥', '💡', '💯', '🚀', '👀']

interface ReactionButtonProps {
  discussionUuid: string
  compact?: boolean
  className?: string
}

export function ReactionButton({ discussionUuid, compact = false, className }: ReactionButtonProps) {
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const { track } = useVBAnalytics('learner')

  const [reactions, setReactions] = useState<ReactionSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  const fetchReactions = async () => {
    try {
      const result = await getReactions(discussionUuid, accessToken)
      setReactions(result || [])
    } catch (_error) {
      // silent
    }
  }

  useEffect(() => {
    fetchReactions()
  }, [discussionUuid])

  const handleToggleReaction = async (emoji: string) => {
    if (!isAuthenticated || !accessToken || isLoading) return

    const wasReacted = reactions.find((r) => r.emoji === emoji)?.has_reacted ?? false

    setIsLoading(true)
    try {
      await toggleReaction(discussionUuid, emoji, accessToken)
      await fetchReactions()
      track(AnalyticsEvent.DiscussionReactionToggled, {
        emoji,
        action: wasReacted ? 'removed' : 'added',
      })
    } catch (error: any) {
      const message =
        (error?.detail && typeof error.detail === 'object' && error.detail.message) ||
        error?.message ||
        'Failed to react to this discussion.'
      toast.error(message)
    } finally {
      setIsLoading(false)
      setIsPickerOpen(false)
    }
  }

  const getUserNames = (users: ReactionSummary['users']) => {
    if (!users || users.length === 0) return ''
    if (users.length <= 3) {
      return users.map((u) => u.first_name || u.username).join(', ')
    }
    const firstThree = users.slice(0, 3).map((u) => u.first_name || u.username).join(', ')
    return `${firstThree} and ${users.length - 3} more`
  }

  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      {/* Existing reactions list */}
      <TooltipProvider delayDuration={150}>
        {reactions.map((reaction) => (
          <Tooltip key={reaction.emoji}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => isAuthenticated && handleToggleReaction(reaction.emoji)}
                disabled={isLoading || !isAuthenticated}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all cursor-pointer border select-none',
                  reaction.has_reacted
                    ? 'bg-primary/10 border-primary/40 text-primary font-semibold shadow-2xs'
                    : 'bg-muted/60 hover:bg-muted border-border/70 text-foreground/80 hover:text-foreground'
                )}
                aria-label={`Reaction ${reaction.emoji}, count ${reaction.count}`}
              >
                <span className="text-sm leading-none">{reaction.emoji}</span>
                <span className="text-[11px] font-medium leading-none">{reaction.count}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              <p>{getUserNames(reaction.users)}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>

      {/* Add reaction trigger — WhatsApp style floating capsule picker */}
      {isAuthenticated && (
        <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted border border-dashed border-border/80 hover:border-border transition-all cursor-pointer',
                compact ? 'w-6 h-6' : 'w-7 h-7'
              )}
              title="Add reaction"
              aria-label="Add reaction"
            >
              <SmilePlus size={compact ? 13 : 15} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-1.5 bg-card/95 backdrop-blur-md border border-border rounded-full shadow-lg"
            align="start"
            side="top"
            sideOffset={6}
            style={{ zIndex: 9999 }}
          >
            {/* WhatsApp horizontal reaction capsule */}
            <div className="flex items-center gap-0.5 px-1">
              {WHATSAPP_EMOJIS.map((emoji) => {
                const existing = reactions.find((r) => r.emoji === emoji)
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleToggleReaction(emoji)}
                    disabled={isLoading}
                    className={cn(
                      'w-8 h-8 flex items-center justify-center text-lg rounded-full transition-transform hover:scale-125 cursor-pointer',
                      existing?.has_reacted ? 'bg-primary/15' : 'hover:bg-muted/70'
                    )}
                    aria-label={`React with ${emoji}`}
                  >
                    <span>{emoji}</span>
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

export default ReactionButton
