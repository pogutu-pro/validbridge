import {
  Gear,
  IdentificationCard,
  Lock,
  ShoppingBag,
} from '@phosphor-icons/react'
import type { SearchMeta } from '@/lib/dashboard-search/types'

export const searchMetas: SearchMeta[] = [
  {
    id: 'account.general',
    titleKey: 'account.general',
    descriptionKey: 'dashboard.search.entries.account_general.description',
    keywordsKey: 'dashboard.search.entries.account_general.keywords',
    icon: Gear,
    href: '/account/general',
    group: 'settings',
    aiSummary: 'Account settings: your personal preferences, language and notification choices.',
  },
  {
    id: 'account.profile',
    titleKey: 'account.profile',
    descriptionKey: 'dashboard.search.entries.account_profile.description',
    keywordsKey: 'dashboard.search.entries.account_profile.keywords',
    icon: IdentificationCard,
    href: '/account/profile',
    group: 'settings',
    aiSummary: 'Your profile: name, avatar and public details shown to other users.',
  },
  {
    id: 'account.security',
    titleKey: 'account.security',
    descriptionKey: 'dashboard.search.entries.account_security.description',
    keywordsKey: 'dashboard.search.entries.account_security.keywords',
    icon: Lock,
    href: '/account/security',
    group: 'settings',
    aiSummary: 'Security: password, two-factor authentication and active sessions.',
    aiHints: [
      'How do I enable two-factor authentication?',
      'How do I change my password?',
    ],
  },
  {
    id: 'account.purchases',
    titleKey: 'account.purchases',
    descriptionKey: 'dashboard.search.entries.account_purchases.description',
    keywordsKey: 'dashboard.search.entries.account_purchases.keywords',
    icon: ShoppingBag,
    href: '/account/purchases',
    group: 'settings',
    aiSummary: 'Your purchases: orders, invoices and receipts for courses you have bought.',
  },
]
