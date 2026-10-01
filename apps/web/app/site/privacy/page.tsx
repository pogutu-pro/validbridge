import React from 'react'
import type { Metadata } from 'next'
import { PRIVACY, formatLegalDate } from '@lib/site/legal'
import { siteOrigins } from '@lib/site/origin'
import LegalDocument from '@components/Site/LegalDocument'

export async function generateMetadata(): Promise<Metadata> {
  const { appOrigin } = await siteOrigins()
  return {
    title: PRIVACY.title,
    description: PRIVACY.description,
    alternates: {
      canonical: '/privacy',
      // Plain Markdown copy for crawlers and LLMs.
      types: { 'text/markdown': '/privacy.md' },
    },
    openGraph: {
      type: 'article',
      url: `${appOrigin}/privacy`,
      title: `${PRIVACY.title} | ValidBridge`,
      description: PRIVACY.description,
      modifiedTime: PRIVACY.updated,
    },
    other: { 'last-modified': formatLegalDate(PRIVACY.updated) },
  }
}

export default async function PrivacyPage() {
  const { appOrigin } = await siteOrigins()
  return <LegalDocument doc={PRIVACY} origin={appOrigin} />
}
