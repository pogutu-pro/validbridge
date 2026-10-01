import { ChatsCircle } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.communities',
  titleKey: 'communities.title',
  descriptionKey: 'dashboard.search.entries.communities.description',
  keywordsKey: 'dashboard.search.entries.communities.keywords',
  icon: ChatsCircle,
  href: '/dash/connect',
  group: 'navigation',
  featureKey: 'communities',
  aiSummary: 'Communities: discussion boards, podcasts and playgrounds where learners interact.',
  aiHints: [
    'How do I create a community?',
    'How do I moderate discussions?',
    'How do I add a podcast or board?',
  ],
}
