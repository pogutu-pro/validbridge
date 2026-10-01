'use client'
import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from 'usehooks-ts'
import {
  MessageSquare,
  Plus,
  Search,
  X,
  Info,
  Globe,
  Lock,
  Loader2,
  Trash2,
  CheckSquare,
  Square,
} from 'lucide-react'
import { Community } from '@services/communities/communities'
import {
  DiscussionWithAuthor,
  DiscussionSortBy,
  getCommentCount,
  deleteDiscussion,
} from '@services/communities/discussions'
import { useDiscussions, useMutateDiscussions } from '@components/Hooks/useDiscussions'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useOrgMembership, useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getCommunityThumbnailMediaDirectory } from '@services/media/media'
import { searchMatchesAny } from '@/lib/search/normalize'
import { isRichContentAllowed } from './richContent'
import { DiscussionChatItem } from './DiscussionChatItem'
import { DiscussionChatPane } from './DiscussionChatPane'
import { CommunityLabelChips } from './CommunityLabelChips'
import { SortDropdown } from './SortDropdown'
import { CommunityInfoDialog } from './CommunityInfoDialog'
import { CreateDiscussionModal } from '@components/Objects/Modals/Communities/CreateDiscussionModal'
import { EditDiscussionModal } from '@components/Objects/Modals/Communities/EditDiscussionModal'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { SafeImage } from '@components/Objects/SafeImage'
import { Button } from '@components/ui/button'
import { EmptyState } from '@components/ui/empty-state'
import { useVBAnalytics, AnalyticsEvent } from '@services/analytics'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface CommunitySplitViewProps {
  community: Community
  initialDiscussions: DiscussionWithAuthor[]
  initialSelectedDiscussion?: DiscussionWithAuthor | null
  orgslug: string
  org_id?: number
}

const removeCommunityPrefix = (uuid: string) => uuid.replace('community_', '')
const removeDiscussionPrefix = (uuid: string) => uuid.replace('discussion_', '')

export function CommunitySplitView({
  community,
  initialDiscussions = [],
  initialSelectedDiscussion = null,
  orgslug,
}: CommunitySplitViewProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const org = useOrg() as any
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const isMobile = useMediaQuery('(max-width: 767px)')
  const { isUserPartOfTheOrg } = useOrgMembership()
  const { canCreateDiscussion: hasCreatePermission, canManageCommunity } = useCommunityRights(community.community_uuid)
  const canCreateDiscussion = hasCreatePermission && isUserPartOfTheOrg
  const mutateDiscussions = useMutateDiscussions()
  const { track } = useVBAnalytics('learner')

  const communityId = removeCommunityPrefix(community.community_uuid)
  const allowRichContent = isRichContentAllowed(community)

  // Filters & Search
  const [sortBy, setSortBy] = useState<DiscussionSortBy>('recent')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isInfoOpen, setIsInfoOpen] = useState(false)

  // Selection mode for admins
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)

  // Active Discussion
  const [selectedDiscussion, setSelectedDiscussion] = useState<DiscussionWithAuthor | null>(
    initialSelectedDiscussion
  )

  // SWR for live discussion updates
  const { discussions: swrDiscussions, isLoading, mutate } = useDiscussions({
    communityUuid: community.community_uuid,
    sortBy,
    page: 1,
    limit: 50,
    label: selectedLabel,
  })

  const discussions = swrDiscussions.length > 0 ? swrDiscussions : initialDiscussions

  // Keep selected discussion in sync when discussions update
  useEffect(() => {
    if (selectedDiscussion) {
      const match = discussions.find((d) => d.discussion_uuid === selectedDiscussion.discussion_uuid)
      if (match) {
        setSelectedDiscussion(match)
      }
    }
  }, [discussions])

  // Fetch comment counts
  useEffect(() => {
    if (!discussions.length) return
    const uncounted = discussions.filter((d) => !(d.discussion_uuid in commentCounts))
    if (!uncounted.length) return

    const fetchCounts = async () => {
      try {
        const counts = await Promise.all(
          uncounted.map(async (d) => {
            try {
              const count = await getCommentCount(d.discussion_uuid, null, accessToken)
              return { uuid: d.discussion_uuid, count }
            } catch {
              return { uuid: d.discussion_uuid, count: 0 }
            }
          })
        )
        setCommentCounts((prev) => {
          const updated = { ...prev }
          counts.forEach(({ uuid, count }) => {
            updated[uuid] = count
          })
          return updated
        })
      } catch {
        // silent
      }
    }

    fetchCounts()
  }, [discussions, accessToken])

  // Filter discussions
  const filteredDiscussions = useMemo(() => {
    if (!searchQuery.trim()) return discussions
    return discussions.filter((d) =>
      searchMatchesAny(
        [d.title, d.author?.username, d.author?.first_name, d.author?.last_name],
        searchQuery
      )
    )
  }, [discussions, searchQuery])

  // Handle discussion selection
  const handleSelectDiscussion = (discussion: DiscussionWithAuthor) => {
    setSelectedDiscussion(discussion)
    const discussionId = removeDiscussionPrefix(discussion.discussion_uuid)
    const discussionUrl = getUriWithOrg(orgslug, `/connect/${communityId}/discussion/${discussionId}`)

    if (isMobile) {
      router.push(discussionUrl)
    } else {
      // On desktop, push state without full reload so URL matches
      window.history.pushState({}, '', discussionUrl)
    }
  }

  // Handle mobile back to discussions list
  const handleBackToList = () => {
    setSelectedDiscussion(null)
    const communityUrl = getUriWithOrg(orgslug, `/connect/${communityId}`)
    router.push(communityUrl)
  }

  // Admin selection handlers
  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode)
    setSelectedIds(new Set())
  }

  const toggleSelection = (uuid: string) => {
    const next = new Set(selectedIds)
    if (next.has(uuid)) {
      next.delete(uuid)
    } else {
      next.add(uuid)
    }
    setSelectedIds(next)
  }

  const selectAll = () => {
    if (selectedIds.size === filteredDiscussions.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredDiscussions.map((d) => d.discussion_uuid)))
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size || !accessToken) return
    setIsDeleting(true)
    try {
      await Promise.all(Array.from(selectedIds).map((uuid) => deleteDiscussion(uuid, accessToken)))
      mutateDiscussions(community.community_uuid)
      if (selectedDiscussion && selectedIds.has(selectedDiscussion.discussion_uuid)) {
        setSelectedDiscussion(null)
      }
      setSelectedIds(new Set())
      setIsSelectMode(false)
      toast.success(t('communities.discussion_list.delete_success', { defaultValue: 'Discussions deleted' }))
    } catch (err: any) {
      toast.error(err?.message || t('communities.discussion_list.delete_failed'))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDiscussionUpdate = (updated: DiscussionWithAuthor) => {
    setSelectedDiscussion(updated)
    mutate((current) => current?.map((d) => (d.discussion_uuid === updated.discussion_uuid ? updated : d)))
  }

  const handleDiscussionDelete = (discussionUuid: string) => {
    if (selectedDiscussion?.discussion_uuid === discussionUuid) {
      setSelectedDiscussion(null)
      if (isMobile) {
        handleBackToList()
      }
    }
    mutate((current) => current?.filter((d) => d.discussion_uuid !== discussionUuid))
    mutateDiscussions(community.community_uuid)
  }

  const thumbnailUrl = community.thumbnail_image && org?.org_uuid
    ? getCommunityThumbnailMediaDirectory(org.org_uuid, community.community_uuid, community.thumbnail_image)
    : null

  const allSelected = filteredDiscussions.length > 0 && selectedIds.size === filteredDiscussions.length

  return (
    <>
      <div className="h-[calc(100vh-135px)] min-h-[620px] max-h-[920px] bg-card border border-border rounded-2xl shadow-sm flex overflow-hidden">
        {/* ========================================================= */}
        {/* LEFT PANE: WhatsApp-style Discussions List                */}
        {/* ========================================================= */}
        <div
          className={cn(
            'flex flex-col border-e border-border bg-card h-full min-h-0',
            // On mobile: show full width if no active discussion; hide if active discussion
            selectedDiscussion ? 'hidden md:flex md:w-[360px] lg:w-[390px] xl:w-[410px] flex-shrink-0' : 'w-full md:w-[360px] lg:w-[390px] xl:w-[410px] flex-shrink-0'
          )}
        >
          {/* Top Bar: Community Info & Actions */}
          <div className="h-16 px-4 border-b border-border flex items-center justify-between bg-card flex-shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {thumbnailUrl ? (
                <SafeImage
                  src={thumbnailUrl}
                  alt={community.name}
                  className="w-9 h-9 rounded-lg object-cover flex-shrink-0 border border-border/80"
                />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 text-muted-foreground border border-border/80">
                  <MessageSquare size={16} />
                </div>
              )}
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-foreground truncate leading-tight">
                  {community.name}
                </h3>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                  {community.public ? (
                    <span className="flex items-center gap-0.5 text-emerald-600 font-medium">
                      <Globe size={10} />
                      {t('courses.public')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5 text-muted-foreground">
                      <Lock size={10} />
                      {t('courses.private')}
                    </span>
                  )}
                  <span>·</span>
                  <span>{discussions.length} {t('communities.discussions')}</span>
                </div>
              </div>
            </div>

            {/* Header Action Buttons */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsInfoOpen(true)}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="Community details"
                title={t('communities.sidebar.community', { defaultValue: 'Community details' })}
              >
                <Info size={16} />
              </Button>

              {canCreateDiscussion && (
                <Button
                  size="sm"
                  onClick={() => setIsCreateModalOpen(true)}
                  className="h-8 px-2.5 text-xs rounded-lg gap-1"
                >
                  <Plus size={14} />
                  <span className="hidden sm:inline">{t('communities.discussion_list.new_discussion')}</span>
                </Button>
              )}
            </div>
          </div>

          {/* Search bar & Sort bar */}
          <div className="p-3 border-b border-border space-y-2 bg-muted/20 flex-shrink-0">
            {/* Search Input */}
            <div className="relative">
              <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                dir="auto"
                type="text"
                placeholder={t('communities.discussion_list.search_placeholder', { defaultValue: 'Search discussions...' })}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full ps-8 pe-8 py-1.5 text-xs bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted-foreground"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Full-width horizontal category filter chips */}
            <div className="w-full overflow-hidden pt-0.5">
              <CommunityLabelChips value={selectedLabel} onChange={setSelectedLabel} />
            </div>

            {/* Sub-row: Result count & Sort / Admin actions */}
            <div className="flex items-center justify-between text-xs pt-1 px-0.5">
              <span className="text-[11px] text-muted-foreground font-medium">
                {filteredDiscussions.length} {filteredDiscussions.length === 1 ? t('communities.discussion') : t('communities.discussions')}
              </span>

              <div className="flex items-center gap-2">
                <SortDropdown value={sortBy} onChange={setSortBy} />

                {canManageCommunity && filteredDiscussions.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectMode}
                    className="text-[11px] text-muted-foreground hover:text-foreground font-medium cursor-pointer"
                  >
                    {isSelectMode ? t('communities.discussion_list.cancel') : t('communities.discussion_list.select')}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Admin Multi-select Bar */}
          {isSelectMode && selectedIds.size > 0 && (
            <div className="px-3 py-2 bg-accent border-b border-border flex items-center justify-between flex-shrink-0">
              <button
                type="button"
                onClick={selectAll}
                className="flex items-center gap-1.5 text-xs text-accent-foreground hover:text-foreground font-medium"
              >
                {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                <span>{allSelected ? t('communities.discussion_list.deselect_all') : t('communities.discussion_list.select_all')}</span>
              </button>

              <ConfirmationModal
                confirmationMessage={t('communities.discussion_list.delete_discussions_confirm', { count: selectedIds.size, type: selectedIds.size === 1 ? t('communities.discussion') : t('communities.discussions') })}
                confirmationButtonText={t('communities.discussion_list.delete')}
                dialogTitle={selectedIds.size === 1 ? t('communities.discussion_list.delete_discussions_title', { count: selectedIds.size }) : t('communities.discussion_list.delete_discussions_title_plural', { count: selectedIds.size })}
                dialogTrigger={
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isDeleting}
                    className="h-6 px-2 text-[11px]"
                  >
                    {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} className="me-1" />}
                    {t('communities.discussion_list.delete')} ({selectedIds.size})
                  </Button>
                }
                functionToExecute={handleBulkDelete}
                status="warning"
              />
            </div>
          )}

          {/* Discussions List Stream */}
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-border/40">
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
                  icon={<MessageSquare />}
                  title={t('communities.discussion_list.no_discussions')}
                  description={t('communities.discussion_list.no_discussions_description')}
                  action={
                    canCreateDiscussion ? (
                      <Button size="sm" onClick={() => setIsCreateModalOpen(true)}>
                        <Plus size={14} className="me-1" />
                        {t('communities.discussion_list.start_discussion')}
                      </Button>
                    ) : undefined
                  }
                  compact
                />
              )
            ) : (
              filteredDiscussions.map((discussion) => (
                <DiscussionChatItem
                  key={discussion.discussion_uuid}
                  discussion={discussion}
                  isSelected={selectedDiscussion?.discussion_uuid === discussion.discussion_uuid}
                  onClick={() => handleSelectDiscussion(discussion)}
                  commentCount={commentCounts[discussion.discussion_uuid] || 0}
                  isSelectMode={isSelectMode}
                  isMultiSelected={selectedIds.has(discussion.discussion_uuid)}
                  onToggleMultiSelect={() => toggleSelection(discussion.discussion_uuid)}
                />
              ))
            )}
          </div>
        </div>

        {/* ========================================================= */}
        {/* RIGHT PANE: WhatsApp-style Active Discussion & Thread     */}
        {/* ========================================================= */}
        <div
          className={cn(
            'flex-1 flex flex-col min-w-0 bg-background/40 h-full min-h-0 relative',
            // On mobile: show full width if active discussion; hide if no active discussion
            selectedDiscussion ? 'flex' : 'hidden md:flex'
          )}
        >
          {selectedDiscussion ? (
            <DiscussionChatPane
              discussion={selectedDiscussion}
              communityUuid={community.community_uuid}
              orgslug={orgslug}
              onBack={handleBackToList}
              onEdit={() => setIsEditModalOpen(true)}
              onDiscussionUpdate={handleDiscussionUpdate}
              onDiscussionDelete={handleDiscussionDelete}
              allowRichContent={allowRichContent}
            />
          ) : (
            // WhatsApp-style Empty Placeholder
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-card/60">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-4 shadow-xs">
                <MessageSquare size={32} />
              </div>
              <h3 className="text-lg font-bold text-foreground">
                {t('communities.chat.select_title', { defaultValue: 'Select a discussion' })}
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mt-1.5 leading-relaxed">
                {t('communities.chat.select_description', {
                  defaultValue: 'Choose a discussion from the list to join the conversation, or start a new topic for the community.',
                })}
              </p>
              {canCreateDiscussion && (
                <Button
                  onClick={() => setIsCreateModalOpen(true)}
                  size="sm"
                  className="mt-5 rounded-xl gap-1.5"
                >
                  <Plus size={15} />
                  {t('communities.new_discussion')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <CreateDiscussionModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        allowRichContent={allowRichContent}
        communityUuid={community.community_uuid}
        orgSlug={orgslug}
      />

      {selectedDiscussion && (
        <EditDiscussionModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          discussion={selectedDiscussion}
          onUpdated={handleDiscussionUpdate}
          allowRichContent={allowRichContent}
        />
      )}

      <CommunityInfoDialog
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        community={community}
        discussionCount={discussions.length}
        orgslug={orgslug}
      />
    </>
  )
}

export default CommunitySplitView
