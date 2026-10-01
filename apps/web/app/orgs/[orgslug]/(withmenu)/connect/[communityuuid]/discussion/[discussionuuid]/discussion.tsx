'use client'

import React from 'react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { Community } from '@services/communities/communities'
import { DiscussionWithAuthor } from '@services/communities/discussions'
import { CommunitySplitView } from '@components/Objects/Communities/CommunitySplitView'
import { MessageCircle } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useTrackView, AnalyticsEvent } from '@services/analytics'

interface DiscussionPageClientProps {
  discussion: DiscussionWithAuthor
  community: Community
  initialDiscussions?: DiscussionWithAuthor[]
  orgslug: string
  org_id?: number
}

const DiscussionPageClient = ({
  discussion,
  community,
  initialDiscussions = [],
  orgslug,
  org_id,
}: DiscussionPageClientProps) => {
  const session = useVBSession() as any

  useTrackView(AnalyticsEvent.DiscussionViewed, {
    label: discussion.label,
    is_locked: discussion.is_locked,
    is_author: session?.data?.user?.id === discussion.author_id,
  })

  return (
    <GeneralWrapperStyled>
      {/* Breadcrumbs */}
      <div className="pb-3">
        <Breadcrumbs
          items={[
            { label: 'Connect', href: getUriWithOrg(orgslug, '/connect'), icon: <MessageCircle size={14} /> },
            {
              label: community.name,
              href: getUriWithOrg(orgslug, `/connect/${community.community_uuid.replace('community_', '')}`),
            },
            { label: discussion.title },
          ]}
        />
      </div>

      {/* WhatsApp-style Split Screen Workspace */}
      <CommunitySplitView
        community={community}
        initialDiscussions={initialDiscussions}
        initialSelectedDiscussion={discussion}
        orgslug={orgslug}
        org_id={org_id}
      />
    </GeneralWrapperStyled>
  )
}

export default DiscussionPageClient
