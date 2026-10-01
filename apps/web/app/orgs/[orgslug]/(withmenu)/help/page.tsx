import React from 'react'
import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import HelpCenter from '@components/Help/HelpCenter'
import { orgHelpContext } from '@lib/help/links'

export const dynamic = 'force-dynamic'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })
  return {
    title: 'Help Center | ' + org.name,
    description:
      'Guides and answers for ValidBridge — courses, LiveBridge live classes, assessments, payments, analytics and more. ValidBridge is a product of Stratnovo Systems.',
  }
}

const HelpPage = async (props: { params: Promise<{ orgslug: string }> }) => {
  const params = await props.params
  return <HelpCenter ctx={orgHelpContext(params.orgslug)} />
}

export default HelpPage
