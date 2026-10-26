import type { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import FrontdeskClient from './frontdesk'

export const dynamic = 'force-dynamic'

export async function generateMetadata(props: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await props.params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  return { title: `Front desk | ${org.name}`, robots: { index: false, follow: false } }
}

export default function FrontdeskPage() {
  return <FrontdeskClient />
}
