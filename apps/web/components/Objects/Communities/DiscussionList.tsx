'use client'
import React, { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle, Plus, Loader2, Search, X, Trash2, CheckSquare, Square } from 'lucide-react'
import { DiscussionCard } from './DiscussionCard'
import { SortDropdown } from './SortDropdown'
import { CommunityLabelChips } from './CommunityLabelChips'
import {
  deleteDiscussion,
  getCommentCount,
  DiscussionSortBy,
  DiscussionWithAuthor,
} from '@services/communities/discussions'
import toast from 'react-hot-toast'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { useDiscussions, useMutateDiscussions } from '@components/Hooks/useDiscussions'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { searchMatchesAny } from '@/lib/search/normalize'
import { useVBAnalytics, AnalyticsEvent } from '@services/analytics'
import { Button } from '@components/ui/button'
import { EmptyState } from '@components/ui/empty-state'

interface DiscussionListProps {
  communityUuid: string
  orgslug: string
  onCreateClick?: () => void
  initialDiscussions?: DiscussionWithAuthor[]
}

export function DiscussionList({
  communityUuid,
  orgslug,
  onCreateClick,
  initialDiscussions = [],
}: DiscussionListProps) {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const { isUserPartOfTheOrg } = useOrgMembership()
  const { canCreateDiscussion: hasCreatePermission, canManageCommunity } = useCommunityRights(communityUuid)
  const canCreateDiscussion = hasCreatePermission && isUserPartOfTheOrg
  const accessToken = session?.data?.tokens?.access_token
  const mutateDiscussions = useMutateDiscussions()
  const { track } = useVBAnalytics('learner')

  const [sortBy, setSortBy] = useState<DiscussionSortBy>('recent')
  const [searchQuery, setSearchQuery] = useState('')
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)

  // Selection state
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)

  // Use SWR for fetching discussions
  const { discussions: swrDiscussions, isLoading, mutate } = useDiscussions({
    communityUuid,
    sortBy,
    page: 1,
    limit: 50, // Fetch more initially since we're not paginating for now
    label: selectedLabel,
  })

  // Use SWR data, fall back to initial data if SWR hasn't loaded yet
  const discussions = swrDiscussions.length > 0 ? swrDiscussions : initialDiscussions

  const fetchCommentCounts = async (discussionList: DiscussionWithAuthor[]) => {
    if (!discussionList.length) return
    try {
      const counts = await Promise.all(
        discussionList.map(async (d) => {
          try {
            const count = await getCommentCount(d.discussion_uuid, null, accessToken)
            return { uuid: d.discussion_uuid, count }
          } catch {
            return { uuid: d.discussion_uuid, count: 0 }
          }
        })
      )
      setCommentCounts(prev => {
        const newCounts = { ...prev }
        counts.forEach(({ uuid, count }) => {
          newCounts[uuid] = count
        })
        return newCounts
      })
    } catch (_error) {
      // silent — counts fall back to 0
    }
  }

  // Fetch comment counts when discussions change
  useEffect(() => {
    if (discussions.length > 0) {
      // Only fetch counts for discussions we don't have counts for
      const newDiscussions = discussions.filter(d => !(d.discussion_uuid in commentCounts))
      if (newDiscussions.length > 0) {
        fetchCommentCounts(newDiscussions)
      }
    }
  }, [discussions])

  const handleCreateClick = (source: 'header' | 'empty_state') => {
    track(AnalyticsEvent.CreateDiscussionModalOpened, {
      source,
      feed_is_empty: filteredDiscussions.length === 0,
    })
    onCreateClick?.()
  }

  const handleSortChange = (newSort: DiscussionSortBy) => {
    setSortBy(newSort)
  }

  const handleLabelChange = (label: string | null) => {
    setSelectedLabel(label)
  }

  // Filter discussions based on search query
  const filteredDiscussions = useMemo(() => {
    if (!searchQuery.trim()) return discussions
    return discussions.filter(d =>
      searchMatchesAny(
        [d.title, d.author?.username, d.author?.first_name, d.author?.last_name],
        searchQuery,
      )
    )
  }, [discussions, searchQuery])

  // Selection handlers
  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode)
    setSelectedIds(new Set())
  }

  const toggleSelection = (discussionUuid: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(discussionUuid)) {
      newSelected.delete(discussionUuid)
    } else {
      newSelected.add(discussionUuid)
    }
    setSelectedIds(newSelected)
  }

  const selectAll = () => {
    if (selectedIds.size === filteredDiscussions.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredDiscussions.map(d => d.discussion_uuid)))
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || !accessToken) return

    setIsDeleting(true)
    try {
      // Delete discussions one by one
      const deletePromises = Array.from(selectedIds).map(uuid =>
        deleteDiscussion(uuid, accessToken)
      )
      await Promise.all(deletePromises)

      // Revalidate SWR cache
      mutateDiscussions(communityUuid)
      setSelectedIds(new Set())
      setIsSelectMode(false)
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.discussion_list.delete_failed')
      toast.error(message)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDiscussionUpdate = (updated: DiscussionWithAuthor) => {
    mutate(
      (current) => current?.map(d =>
        d.discussion_uuid === updated.discussion_uuid ? updated : d
      ),
    )
  }

  const handleDiscussionDelete = (discussionUuid: string) => {
    mutate(
      (current) => current?.filter(d => d.discussion_uuid !== discussionUuid),
    )
  }

  const allSelected = filteredDiscussions.length > 0 && selectedIds.size === filteredDiscussions.length

  return (
    <div>
      {/* Toolbar */}
      <div className="p-3 border-b border-border space-y-2.5">
        {/* Search Bar */}
        <div className="relative">
          <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            dir="auto"
            type="text"
            placeholder={t('communities.discussion_list.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full ps-8 pe-8 py-1.5 text-sm bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Label Chips + Sort + Actions row */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Label chips (scrollable on narrow viewports) */}
          <div className="flex-1 min-w-0 overflow-x-auto pb-0.5">
            <CommunityLabelChips value={selectedLabel} onChange={handleLabelChange} />
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <SortDropdown value={sortBy} onChange={handleSortChange} />

            {/* Result count */}
            <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">
              {filteredDiscussions.length} {filteredDiscussions.length === 1 ? t('communities.discussion') : t('communities.discussions')}
            </span>

            {/* Select Mode Toggle for Admins */}
            {canManageCommunity && filteredDiscussions.length > 0 && (
              <Button
                variant={isSelectMode ? 'secondary' : 'ghost'}
                size="sm"
                onClick={toggleSelectMode}
                className="h-7 px-2 text-xs"
              >
                <CheckSquare size={13} />
                {isSelectMode ? t('communities.discussion_list.cancel') : t('communities.discussion_list.select')}
              </Button>
            )}

            {/* Desktop create button */}
            {canCreateDiscussion && onCreateClick && !isSelectMode && (
              <Button
                onClick={() => handleCreateClick('header')}
                size="sm"
                className="hidden md:flex h-7 px-2.5 text-xs"
              >
                <Plus size={13} />
                {t('communities.discussion_list.new_discussion')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Selection Action Bar */}
      {isSelectMode && selectedIds.size > 0 && (
        <div className="px-4 py-2.5 bg-accent border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={selectAll}
              className="flex items-center gap-1.5 text-xs text-accent-foreground hover:text-foreground"
            >
              {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
              {allSelected ? t('communities.discussion_list.deselect_all') : t('communities.discussion_list.select_all')}
            </button>
            <span className="text-xs text-accent-foreground font-medium">
              {selectedIds.size} {t('communities.discussion_list.selected')}
            </span>
          </div>

          <ConfirmationModal
            confirmationMessage={t('communities.discussion_list.delete_discussions_confirm', { count: selectedIds.size, type: selectedIds.size === 1 ? t('communities.discussion') : t('communities.discussions') })}
            confirmationButtonText={t('communities.discussion_list.delete')}
            dialogTitle={selectedIds.size === 1 ? t('communities.discussion_list.delete_discussions_title', { count: selectedIds.size }) : t('communities.discussion_list.delete_discussions_title_plural', { count: selectedIds.size })}
            dialogTrigger={
              <Button
                variant="destructive"
                size="sm"
                disabled={isDeleting}
                className="h-7 px-2.5 text-xs"
              >
                {isDeleting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
                {t('communities.discussion_list.delete')}
              </Button>
            }
            functionToExecute={handleBulkDelete}
            status="warning"
          />
        </div>
      )}

      {/* Discussion List */}
      <div>
        {isLoading && discussions.length === 0 ? (
          <EmptyState
            icon={<Loader2 className="animate-spin" />}
            title={t('communities.discussion_list.loading', { defaultValue: 'Loading discussions…' })}
            compact
          />
        ) : filteredDiscussions.length === 0 ? (
          searchQuery ? (
            <EmptyState
              icon={<Search />}
              title={t('communities.discussion_list.no_results')}
              description={t('communities.discussion_list.no_results_description')}
              action={
                <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
                  {t('communities.discussion_list.clear_search')}
                </Button>
              }
              compact
            />
          ) : (
            <EmptyState
              icon={<MessageCircle />}
              title={t('communities.discussion_list.no_discussions')}
              description={t('communities.discussion_list.no_discussions_description')}
              action={
                canCreateDiscussion && onCreateClick ? (
                  <Button size="sm" onClick={() => handleCreateClick('empty_state')}>
                    <Plus size={14} />
                    {t('communities.discussion_list.start_discussion')}
                  </Button>
                ) : undefined
              }
              compact
            />
          )
        ) : (
          filteredDiscussions.map((discussion) => (
            <DiscussionCard
              key={discussion.discussion_uuid}
              discussion={discussion}
              orgslug={orgslug}
              communityUuid={communityUuid}
              commentCount={commentCounts[discussion.discussion_uuid] || 0}
              isSelectMode={isSelectMode}
              isSelected={selectedIds.has(discussion.discussion_uuid)}
              onToggleSelect={() => toggleSelection(discussion.discussion_uuid)}
              canManage={canManageCommunity}
              onDiscussionUpdate={handleDiscussionUpdate}
              onDiscussionDelete={handleDiscussionDelete}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default DiscussionList
