import { ArrowsClockwise } from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMeta: SearchMeta = {
  id: 'dash.courses.migrate',
  titleKey: 'dashboard.search.entries.courses_migrate.title',
  descriptionKey: 'dashboard.search.entries.courses_migrate.description',
  keywordsKey: 'dashboard.search.entries.courses_migrate.keywords',
  icon: ArrowsClockwise,
  href: '/dash/courses/migrate',
  group: 'navigation',
  aiSummary: 'Course migration: import courses from another ValidBridge organization or export them for backup.',
  aiHints: [
    'How do I import a course from another organization?',
    'How do I export a course?',
    'What formats can I migrate?',
  ],
}
