import React from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { findCategory } from '@lib/help'
import { HelpCategoryView } from '@components/Help/HelpPages'
import { getSiteHelpContext } from '../context'

type Props = { params: Promise<{ category: string }> }

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { category: categoryId } = await props.params
  const category = findCategory(categoryId)
  if (!category) return {}
  return { title: category.title, description: category.description }
}

export default async function HelpSiteCategoryPage(props: Props) {
  const { category } = await props.params
  if (!findCategory(category)) notFound()
  const ctx = await getSiteHelpContext()
  return <HelpCategoryView ctx={ctx} categoryId={category} />
}
