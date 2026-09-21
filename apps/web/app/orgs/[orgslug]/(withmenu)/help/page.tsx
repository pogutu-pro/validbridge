import React from 'react'
import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import HelpCenter from '@components/Help/HelpCenter'

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
      'A complete, section-by-section guide to every ValidBridge feature — courses, the editor, assignments, AI, administration and more.',
  }
}

const HelpPage = async (props: any) => {
  const params = await props.params
  return <HelpCenter orgslug={params.orgslug} />
}

export default HelpPage