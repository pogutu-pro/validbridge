import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { getServerCanonicalUrl } from '@/lib/seo/utils.server'
import { JsonLd } from '@components/SEO/JsonLd'
import { getPublicOffer, getOffersByResource } from '@services/payments/offers'
import { asArray } from '@services/utils/ts/requests'
import { getServerSession } from '@/lib/auth/server'
import OfferDetailClient from './offer-detail'

type PageParams = Promise<{ orgslug: string; offerid: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug, offerid } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  const seoConfig = getOrgSeoConfig(org)
  let offerName = 'Offer'
  try {
    const result = await getPublicOffer(org.id, offerid)
    offerName = result?.data?.name || 'Offer'
  } catch {}
  const title = buildPageTitle(offerName, org?.name || 'Organization', seoConfig)
  return {
    title,
    robots: { index: true, follow: true },
    alternates: { canonical: await getServerCanonicalUrl(orgslug, `/marketplace/offers/${offerid}`) },
  }
}

export default async function OfferPage({ params }: { params: PageParams }) {
  const { orgslug, offerid } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token ?? null

  let offer: any = null
  try {
    const result = await getPublicOffer(org.id, offerid)
    offer = result?.data ?? result
  } catch {}

  // Other offers that sell exactly the same content (e.g. a one-time price next
  // to a subscription), so the buyer can pick how to pay on this one page.
  const siblings = await findSiblingOffers(org.id, offer)

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: await getServerCanonicalUrl(orgslug, '/') },
    { name: 'Marketplace', url: await getServerCanonicalUrl(orgslug, '/marketplace') },
    { name: offer?.name || 'Offer', url: await getServerCanonicalUrl(orgslug, `/marketplace/offers/${offerid}`) },
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <OfferDetailClient
        orgslug={orgslug}
        orgId={org.id}
        offer={offer}
        siblings={siblings}
        offerUuid={offerid}
        access_token={access_token}
      />
    </>
  )
}

const resourceKey = (offer: any): string =>
  (offer?.included_resources ?? [])
    .map((r: any) => r.resource_uuid)
    .sort()
    .join('|')

async function findSiblingOffers(orgId: number, offer: any): Promise<any[]> {
  const key = resourceKey(offer)
  const firstResource = offer?.included_resources?.[0]?.resource_uuid
  if (!key || !firstResource) return []
  try {
    const rows = asArray(await getOffersByResource(orgId, firstResource))
    return rows.filter(
      (o: any) => o?.offer_uuid && o.offer_uuid !== offer.offer_uuid && resourceKey(o) === key,
    )
  } catch {
    return []
  }
}
