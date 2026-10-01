import React from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { findArticle } from '@lib/help'
import { HelpArticleView } from '@components/Help/HelpPages'
import { getSiteHelpContext } from '../../context'

type Props = { params: Promise<{ category: string; article: string }> }

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { category, article } = await props.params
  const match = findArticle(category, article)
  if (!match) return {}
  return { title: match.article.title, description: match.article.summary }
}

export default async function HelpSiteArticlePage(props: Props) {
  const { category, article } = await props.params
  if (!findArticle(category, article)) notFound()
  const ctx = await getSiteHelpContext()
  return <HelpArticleView ctx={ctx} categoryId={category} articleId={article} />
}
