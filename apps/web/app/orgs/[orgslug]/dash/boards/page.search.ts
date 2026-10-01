import { ChalkboardSimple } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.boards',
  titleKey: 'common.boards',
  descriptionKey: 'dashboard.search.entries.boards.description',
  keywordsKey: 'dashboard.search.entries.boards.keywords',
  icon: ChalkboardSimple,
  href: '/dash/boards',
  group: 'navigation',
  featureKey: 'boards',
  featureDefaultDisabled: true,
  aiSummary: 'Boards: collaborative whiteboards and canvases for lessons and activities.',
  aiHints: [
    'How do I create a board?',
    'How do I embed a board in a lesson?',
    'How do I use AI on a board?',
  ],
}
