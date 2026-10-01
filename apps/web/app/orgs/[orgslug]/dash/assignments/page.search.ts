import { Files } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.assignments',
  titleKey: 'common.all_assignments',
  descriptionKey: 'dashboard.search.entries.assignments.description',
  keywordsKey: 'dashboard.search.entries.assignments.keywords',
  icon: Files,
  href: '/dash/assignments',
  group: 'navigation',
  aiSummary: 'Assignments across the organization: create, review and grade student submissions.',
  aiHints: [
    'How do I create an assignment?',
    'How do I grade submissions?',
    'What assignment types are available?',
    'How do I see who has submitted?',
  ],
}
