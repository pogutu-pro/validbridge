import React from 'react'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { findArticle } from '@lib/help'
import { HelpArticleView } from '@components/Help/HelpPages'
import { orgHelpContext } from '@lib/help/links'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ orgslug: string; category: string; article: string }>
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { category, article } = await props.params
  const match = findArticle(category, article)
  if (!match) return { title: 'Help Center' }
  return {
    title: `${match.article.title} | Help Center`,
    description: match.article.summary,
  }
}

const HelpArticlePage = async (props: Props) => {
  const { orgslug, category, article } = await props.params
  if (!findArticle(category, article)) notFound()
  return <HelpArticleView ctx={orgHelpContext(orgslug)} categoryId={category} articleId={article} />
}

export default HelpArticlePage
