'use client'

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import CommunityCard from '@components/Objects/Communities/CommunityCard'
import { CreateCommunityModal } from '@components/Objects/Modals/Communities/CreateCommunityModal'
import { EditCommunityModal } from '@components/Objects/Modals/Communities/EditCommunityModal'
import ContentPlaceHolderIfUserIsNotAdmin from '@components/Objects/ContentPlaceHolder'
import { Users, Plus } from 'lucide-react'
import { Community } from '@services/communities/communities'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { useTrackView, AnalyticsEvent } from '@services/analytics'
import { Button } from '@components/ui/button'
import { EmptyState } from '@components/ui/empty-state'

interface CommunitiesClientProps {
  communities: Community[]
  orgslug: string
  org_id: number
}

const CommunitiesClient = ({ communities, orgslug, org_id }: CommunitiesClientProps) => {
  const { t } = useTranslation()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingCommunity, setEditingCommunity] = useState<Community | null>(null)

  useTrackView(AnalyticsEvent.CommunitiesListViewed, {
    communities_count: communities.length,
  })

  return (
    <FeatureGate feature="communities" orgslug={orgslug} context="public">
      <GeneralWrapperStyled>
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <TypeOfContentTitle title={t('communities.title')} type="col" />
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('communities.subtitle', { defaultValue: 'Browse and join community discussions' })}
            </p>
          </div>
          <AuthenticatedClientElement
            ressourceType="communities"
            action="create"
            checkMethod="roles"
            orgId={org_id}
          >
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              size="sm"
            >
              <Plus size={15} />
              {t('communities.new_community')}
            </Button>
          </AuthenticatedClientElement>
        </div>

        {communities.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={t('communities.no_communities')}
            description={
              <ContentPlaceHolderIfUserIsNotAdmin
                text={t('communities.no_communities_description')}
              />
            }
            action={
              <AuthenticatedClientElement
                checkMethod="roles"
                ressourceType="communities"
                action="create"
                orgId={org_id}
              >
                <Button onClick={() => setIsCreateModalOpen(true)} size="sm">
                  <Plus size={15} />
                  {t('communities.new_community')}
                </Button>
              </AuthenticatedClientElement>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {communities.map((community: Community) => (
              <div key={community.community_uuid}>
                <CommunityCard
                  community={community}
                  orgslug={orgslug}
                  org_id={org_id}
                  variant="public"
                />
              </div>
            ))}
          </div>
        )}

        <CreateCommunityModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          orgId={org_id}
          orgSlug={orgslug}
        />

        {editingCommunity && (
          <EditCommunityModal
            isOpen={!!editingCommunity}
            onClose={() => setEditingCommunity(null)}
            community={editingCommunity}
            orgSlug={orgslug}
          />
        )}
      </GeneralWrapperStyled>
    </FeatureGate>
  )
}

export default CommunitiesClient
