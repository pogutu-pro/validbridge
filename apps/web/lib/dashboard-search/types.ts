import type { ComponentType } from 'react'

export type SearchMetaGroup =
  | 'home'
  | 'navigation'
  | 'content'
  | 'users'
  | 'settings'
  | 'analytics'
  | 'payments'

// Loose so we can use Phosphor, Lucide, or any custom React icon component
// without coupling to a specific icon family's prop types.
export type SearchMetaIcon = ComponentType<any>

export interface SearchMeta {
  id: string
  titleKey: string
  descriptionKey?: string
  keywordsKey?: string
  icon: SearchMetaIcon
  href: string
  group: SearchMetaGroup
  featureKey?: string
  featureDefaultDisabled?: boolean
  requiresOrgAdmin?: boolean
  /**
   * Short product questions the copilot offers as opening suggestions on this
   * page. Managerial-dashboard only — the assistant is not mounted on learner
   * surfaces, so these never reach a student.
   */
  aiHints?: string[]
  /**
   * One-line framing of what this page is for, resolved into the assistant's
   * system prompt so it can answer "what does this page do" without being told.
   */
  aiSummary?: string
}
