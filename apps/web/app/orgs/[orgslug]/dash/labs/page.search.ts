import { Cube } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.playgrounds',
  titleKey: 'common.playgrounds',
  descriptionKey: 'dashboard.search.entries.playgrounds.description',
  keywordsKey: 'dashboard.search.entries.playgrounds.keywords',
  icon: Cube,
  href: '/dash/labs',
  group: 'navigation',
  featureKey: 'playgrounds',
  featureDefaultDisabled: true,
}
