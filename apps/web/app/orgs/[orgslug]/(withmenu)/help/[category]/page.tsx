import React from 'react'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { findCategory } from '@lib/help'
import { HelpCategoryView } from '@components/Help/HelpPages'
import { orgHelpContext } from '@lib/help/links'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ orgslug: string; category: string }>
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { category: categoryId } = await props.params
  const category = findCategory(categoryId)
  if (!category) return { title: 'Help Center' }
  return {
    title: `${category.title} | Help Center`,
    description: category.description,
  }
}

const HelpCategoryPage = async (props: Props) => {
  const { orgslug, category } = await props.params
  if (!findCategory(category)) notFound()
  return <HelpCategoryView ctx={orgHelpContext(orgslug)} categoryId={category} />
}

export default HelpCategoryPage
