import React from 'react'
import type { Metadata } from 'next'
import { TERMS, formatLegalDate } from '@lib/site/legal'
import { siteOrigins } from '@lib/site/origin'
import LegalDocument from '@components/Site/LegalDocument'

export async function generateMetadata(): Promise<Metadata> {
  const { appOrigin } = await siteOrigins()
  return {
    title: TERMS.title,
    description: TERMS.description,
    alternates: {
      canonical: '/terms',
      // Plain Markdown copy for crawlers and LLMs.
      types: { 'text/markdown': '/terms.md' },
    },
    openGraph: {
      type: 'article',
      url: `${appOrigin}/terms`,
      title: `${TERMS.title} | ValidBridge`,
      description: TERMS.description,
      modifiedTime: TERMS.updated,
    },
    other: { 'last-modified': formatLegalDate(TERMS.updated) },
  }
}

export default async function TermsPage() {
  const { appOrigin } = await siteOrigins()
  return <LegalDocument doc={TERMS} origin={appOrigin} />
}
