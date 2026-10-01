import type { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import LiveLessonsClient from './live'

export const dynamic = 'force-dynamic'

export async function generateMetadata(props: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await props.params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  return { title: `Live lessons | ${org.name}`, robots: { index: false, follow: false } }
}

export default async function LiveLessonsPage(props: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await props.params
  return <LiveLessonsClient orgslug={orgslug} />
}
