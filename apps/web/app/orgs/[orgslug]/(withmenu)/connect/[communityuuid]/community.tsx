'use client'

import React from 'react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { MessageCircle } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import { Community } from '@services/communities/communities'
import { DiscussionWithAuthor } from '@services/communities/discussions'
import { CommunitySplitView } from '@components/Objects/Communities/CommunitySplitView'
import { useTrackView, AnalyticsEvent } from '@services/analytics'

interface CommunityClientProps {
  community: Community
  initialDiscussions: DiscussionWithAuthor[]
  orgslug: string
  org_id: number
}

const CommunityClient = ({
  community,
  initialDiscussions,
  orgslug,
  org_id,
}: CommunityClientProps) => {
  useTrackView(AnalyticsEvent.CommunityViewed, {
    is_public: community.public,
    initial_discussion_count: initialDiscussions.length,
  })

  return (
    <GeneralWrapperStyled>
      {/* Breadcrumbs */}
      <div className="pb-3">
        <Breadcrumbs
          items={[
            { label: 'Connect', href: getUriWithOrg(orgslug, '/connect'), icon: <MessageCircle size={14} /> },
            { label: community.name },
          ]}
        />
      </div>

      {/* WhatsApp-style Split Screen Workspace */}
      <CommunitySplitView
        community={community}
        initialDiscussions={initialDiscussions}
        orgslug={orgslug}
        org_id={org_id}
      />
    </GeneralWrapperStyled>
  )
}

export default CommunityClient
