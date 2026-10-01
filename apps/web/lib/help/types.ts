import type { ReactNode } from 'react'

/**
 * Where the Help Center is being shown. Inside an organization, links into the
 * app point at that organization; on the standalone help site (help.{domain})
 * there is no organization and they point at the main app instead.
 */
export type HelpContext = {
  /** Org slug when shown inside an organization; null on the standalone help site. */
  orgslug: string | null
  /** Origin of the main app (e.g. `https://validbridge.co.ke`); used on the help site. */
  appOrigin: string
}

/**
 * An article's content is a function of the context so links can be built
 * with `appHref(ctx, '/path')` and `helpHref(ctx, 'category/article')`.
 */
export type HelpContentFn = (_ctx: HelpContext) => ReactNode

/** Who an article is mainly written for — shown as badges on the article. */
export type HelpAudience = 'everyone' | 'learners' | 'instructors' | 'admins'

export type HelpArticle = {
  /** Unique across the whole Help Center (also used for legacy `#id` links). */
  id: string
  title: string
  /** One or two sentences shown on cards, in search results and as the article lead. */
  summary: string
  audience: HelpAudience[]
  /** Extra search terms that do not appear in the text (synonyms, UI names). */
  keywords?: string[]
  content: HelpContentFn
}

/** Icon key mapped to a Phosphor icon by the Help Center renderer. */
export type HelpIcon =
  | 'rocket'
  | 'book'
  | 'video'
  | 'users'
  | 'exam'
  | 'card'
  | 'chart'
  | 'buildings'
  | 'plug'
  | 'shield'
  | 'sparkle'
  | 'chats'
  | 'lifebuoy'

export type HelpCategory = {
  id: string
  title: string
  icon: HelpIcon
  description: string
  articles: HelpArticle[]
}
