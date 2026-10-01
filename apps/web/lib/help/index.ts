import type { HelpArticle, HelpCategory } from './types'
import { gettingStarted } from './getting-started'
import { courses } from './courses'
import { livebridge } from './livebridge'
import { students } from './students'
import { assessments } from './assessments'
import { payments } from './payments'
import { analytics } from './analytics'
import { organization } from './organization'
import { integrations } from './integrations'
import { account } from './account'
import { ai } from './ai'
import { community } from './community'
import { troubleshooting } from './troubleshooting'

/** Every Help Center category, in the order shown on the home page. */
export const HELP_CATEGORIES: HelpCategory[] = [
  gettingStarted,
  courses,
  livebridge,
  students,
  assessments,
  payments,
  analytics,
  organization,
  integrations,
  account,
  ai,
  community,
  troubleshooting,
]

/** Articles featured on the Help Center home, as `category/article` paths. */
export const POPULAR_ARTICLES = [
  'livebridge/schedule-live-lesson',
  'livebridge/join-live-lesson',
  'courses/create-course',
  'payments/connect-paystack',
  'assessments/assignments-teaching',
  'account/two-factor',
]

export type ArticleMatch = { category: HelpCategory; article: HelpArticle; index: number }

export function findCategory(categoryId: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.id === categoryId)
}

export function findArticle(categoryId: string, articleId: string): ArticleMatch | undefined {
  const category = findCategory(categoryId)
  if (!category) return undefined
  const index = category.articles.findIndex((a) => a.id === articleId)
  if (index < 0) return undefined
  return { category, article: category.articles[index], index }
}

/** Resolve a `category/article` path. */
export function resolveArticlePath(path: string): ArticleMatch | undefined {
  const [categoryId, articleId] = path.split('/')
  return categoryId && articleId ? findArticle(categoryId, articleId) : undefined
}

/** Old single-page anchors whose article id changed when the Help Center was split up. */
const LEGACY_ANCHORS: Record<string, string> = {
  'boards-learner': 'community/boards',
  'boards-teaching': 'community/boards',
  'podcasts-learner': 'community/podcasts',
  'podcasts-teaching': 'community/podcasts',
  'playgrounds-learner': 'community/playgrounds',
  'payments-admin': 'payments/payments-overview',
  payments: 'payments/payments-faq',
  'paid-courses': 'payments/paying-for-a-course',
  realtime: 'troubleshooting/content',
  'still-stuck': 'troubleshooting/getting-help',
}

/**
 * Map a legacy `/help#anchor` (from the old single-page Help Center) to its
 * article path, so bookmarked and in-app deep links keep working.
 */
export function resolveLegacyAnchor(anchor: string): string | undefined {
  if (LEGACY_ANCHORS[anchor]) return LEGACY_ANCHORS[anchor]
  for (const category of HELP_CATEGORIES) {
    if (category.articles.some((a) => a.id === anchor)) return `${category.id}/${anchor}`
  }
  return undefined
}

export type { HelpArticle, HelpCategory, HelpAudience, HelpIcon, HelpContext } from './types'
