import React from 'react'
import {
  House,
  BookOpen,
  Files,
  Users,
  CurrencyCircleDollar,
  Buildings,
  Gear,
  ChatsCircle,
  Headphones,
  ChartBar,
  ChalkboardSimple,
  Cube,
  FolderSimple,
  PencilSimple,
  UsersThree,
  Shield,
  UserPlus,
  ClipboardText,
  Palette,
  Rocket,
  Robot,
  LinkSimple,
  Key,
  Lock,
  Wrench,
  ChartLine,
  MagnifyingGlass,
  Code,
  Lightning,
  SquaresFour,
  Broadcast,
} from '@phosphor-icons/react'
import {
  Info,
  GalleryVerticalEnd,
  Globe,
  UserPen,
  Award,
  Search,
  KeyRound,
  ScanEye,
  ShieldCheck,
  ShieldAlert,
  SquareUserRound,
  Settings,
  Layers,
  Gem,
  AlertTriangle,
  Menu as MenuIcon,
} from 'lucide-react'
import { PlanLevel } from '@services/plans/plans'

export interface SecondaryNavItem {
  key: string
  label: string
  labelKey?: string
  href: string
  icon: React.ReactNode
  active?: boolean
  requiresPlan?: PlanLevel
  requiresAdmin?: boolean
}

export interface PrimaryNavSection {
  key: string
  label: string
  labelKey: string
  icon: React.ReactNode
  href: string
  matchPrefix: string
  group: 'home' | 'learning' | 'content' | 'people' | 'monetization' | 'administration' | 'insights'
  featureKey?: string
  hasChildren: boolean
  getChildren?: (pathname: string, orgSlug: string, canManageOrg?: boolean) => SecondaryNavItem[]
}

type ResourceRights = Partial<Record<string, Partial<Record<string, boolean>>>> | null | undefined

/**
 * Which admin areas the current user may see in the dashboard navigation.
 * Mirrors the rights the pages themselves enforce, so nobody is shown a
 * section that would only bounce them.
 */
export function dashNavAccess(isSuperadmin: boolean, canManageOrg: boolean, rights: ResourceRights) {
  const admin = isSuperadmin || canManageOrg
  return {
    users:
      admin ||
      rights?.users?.action_read === true ||
      rights?.users?.action_update === true ||
      rights?.users?.action_create === true,
    org: admin || rights?.organizations?.action_read === true,
    developers: admin,
    payments: admin,
  }
}

export type DashNavAccess = ReturnType<typeof dashNavAccess>

/** Sections not listed in DashNavAccess are visible to every dashboard user. */
export const canSeeSection = (key: string, access: DashNavAccess) =>
  (access as Record<string, boolean>)[key] ?? true

export function getPrimarySections(
  t: (key: string, options?: any) => string,
  pathname: string,
  orgSlug: string,
  enabledFeatures: {
    library: boolean
    communities: boolean
    podcasts: boolean
    boards: boolean
    playgrounds: boolean
    payments: boolean
  },
  canManageOrg: boolean = true
): PrimaryNavSection[] {
  const sections: PrimaryNavSection[] = [
    {
      key: 'home',
      label: t('common.home', { defaultValue: 'Home' }),
      labelKey: 'common.home',
      icon: React.createElement(House, { size: 22, weight: 'fill' }),
      href: '/dash',
      matchPrefix: '/dash',
      group: 'home',
      hasChildren: false,
    },
    {
      key: 'courses',
      label: t('courses.courses', { defaultValue: 'Courses' }),
      labelKey: 'courses.courses',
      icon: React.createElement(BookOpen, { size: 22, weight: 'fill' }),
      href: '/dash/courses',
      matchPrefix: '/dash/courses',
      group: 'learning',
      hasChildren: true,
      getChildren: (path, slug) => {
        // Course detail view: /dash/courses/course/[courseuuid]/[subpage]
        const courseMatch = path.match(/\/dash\/courses\/course\/([^/]+)/)
        if (courseMatch) {
          const courseUuid = courseMatch[1]
          return [
            {
              key: 'general',
              label: t('dashboard.courses.settings.tabs.general', { defaultValue: 'General' }),
              href: `/dash/courses/course/${courseUuid}/general`,
              icon: React.createElement(Info, { size: 16 }),
            },
            {
              key: 'content',
              label: t('dashboard.courses.settings.tabs.content', { defaultValue: 'Content Structure' }),
              href: `/dash/courses/course/${courseUuid}/content`,
              icon: React.createElement(GalleryVerticalEnd, { size: 16 }),
            },
            {
              key: 'access',
              label: t('dashboard.courses.settings.tabs.access', { defaultValue: 'Access & Pricing' }),
              href: `/dash/courses/course/${courseUuid}/access`,
              icon: React.createElement(Globe, { size: 16 }),
            },
            {
              key: 'contributors',
              label: t('dashboard.courses.settings.tabs.contributors', { defaultValue: 'Contributors' }),
              href: `/dash/courses/course/${courseUuid}/contributors`,
              icon: React.createElement(UserPen, { size: 16 }),
            },
            {
              key: 'seo',
              label: t('dashboard.courses.settings.tabs.seo', { defaultValue: 'SEO' }),
              href: `/dash/courses/course/${courseUuid}/seo`,
              icon: React.createElement(Search, { size: 16 }),
              requiresPlan: 'starter',
            },
            {
              key: 'certification',
              label: t('dashboard.courses.settings.tabs.certification', { defaultValue: 'Certificates' }),
              href: `/dash/courses/course/${courseUuid}/certification`,
              icon: React.createElement(Award, { size: 16 }),
              requiresPlan: 'starter',
            },
            {
              key: 'live',
              label: 'LiveBridge',
              href: `/dash/courses/course/${courseUuid}/live`,
              icon: React.createElement(Broadcast, { size: 16 }),
            },
            {
              key: 'analytics',
              label: t('dashboard.courses.settings.tabs.analytics', { defaultValue: 'Analytics' }),
              href: `/dash/courses/course/${courseUuid}/analytics`,
              icon: React.createElement(ChartBar, { size: 16 }),
              requiresPlan: 'starter',
            },
          ]
        }
        // General Courses menu
        return [
          {
            key: 'all_courses',
            label: t('common.all_courses', { defaultValue: 'All Courses' }),
            href: '/dash/courses',
            icon: React.createElement(BookOpen, { size: 16 }),
          },
          {
            key: 'migrate',
            label: t('courses.migration', { defaultValue: 'Course Migration' }),
            href: '/dash/courses/migrate',
            icon: React.createElement(Files, { size: 16 }),
          },
        ]
      },
    },
    {
      key: 'assignments',
      label: t('common.assignments', { defaultValue: 'Assignments' }),
      labelKey: 'common.assignments',
      icon: React.createElement(Files, { size: 22, weight: 'fill' }),
      href: '/dash/assignments',
      matchPrefix: '/dash/assignments',
      group: 'learning',
      hasChildren: true,
      getChildren: (path) => {
        const assignMatch = path.match(/\/dash\/assignments\/([^/]+)/)
        if (assignMatch && assignMatch[1] !== 'page') {
          const assignUuid = assignMatch[1]
          return [
            {
              key: 'overview',
              label: t('common.overview', { defaultValue: 'Submissions' }),
              href: `/dash/assignments/${assignUuid}`,
              icon: React.createElement(Files, { size: 16 }),
            },
            {
              key: 'editor',
              label: t('common.editor', { defaultValue: 'Task Editor' }),
              href: `/dash/assignments/${assignUuid}?subpage=editor`,
              icon: React.createElement(PencilSimple, { size: 16 }),
            },
            {
              key: 'analytics',
              label: t('common.analytics', { defaultValue: 'Analytics' }),
              href: `/dash/assignments/${assignUuid}?subpage=analytics`,
              icon: React.createElement(ChartBar, { size: 16 }),
            },
          ]
        }
        return [
          {
            key: 'all_assignments',
            label: t('common.all_assignments', { defaultValue: 'All Assignments' }),
            href: '/dash/assignments',
            icon: React.createElement(Files, { size: 16 }),
          },
        ]
      },
    },
  ]

  if (enabledFeatures.library) {
    sections.push({
      key: 'library',
      label: t('library.library', { defaultValue: 'Library' }),
      labelKey: 'library.library',
      icon: React.createElement(FolderSimple, { size: 22, weight: 'fill' }),
      href: '/dash/library',
      matchPrefix: '/dash/library',
      group: 'content',
      hasChildren: false,
    })
  }

  if (enabledFeatures.communities) {
    sections.push({
      key: 'connect',
      label: t('communities.title', { defaultValue: 'Communities' }),
      labelKey: 'communities.title',
      icon: React.createElement(ChatsCircle, { size: 22, weight: 'fill' }),
      href: '/dash/connect',
      matchPrefix: '/dash/connect',
      group: 'content',
      hasChildren: false,
    })
  }

  if (enabledFeatures.podcasts) {
    sections.push({
      key: 'podcasts',
      label: t('podcasts.podcasts', { defaultValue: 'Podcasts' }),
      labelKey: 'podcasts.podcasts',
      icon: React.createElement(Headphones, { size: 22, weight: 'fill' }),
      href: '/dash/podcasts',
      matchPrefix: '/dash/podcasts',
      group: 'content',
      hasChildren: false,
    })
  }

  if (enabledFeatures.boards) {
    sections.push({
      key: 'boards',
      label: t('boards.boards', { defaultValue: 'Boards' }),
      labelKey: 'boards.boards',
      icon: React.createElement(ChalkboardSimple, { size: 22, weight: 'fill' }),
      href: '/dash/boards',
      matchPrefix: '/dash/boards',
      group: 'content',
      hasChildren: false,
    })
  }

  if (enabledFeatures.playgrounds) {
    sections.push({
      key: 'labs',
      label: t('common.playgrounds', { defaultValue: 'Playgrounds' }),
      labelKey: 'common.playgrounds',
      icon: React.createElement(Cube, { size: 22, weight: 'fill' }),
      href: '/dash/labs',
      matchPrefix: '/dash/labs',
      group: 'content',
      hasChildren: false,
    })
  }

  sections.push({
    key: 'users',
    label: t('common.users', { defaultValue: 'Users' }),
    labelKey: 'common.users',
    icon: React.createElement(Users, { size: 22, weight: 'fill' }),
    href: '/dash/users/settings/users',
    matchPrefix: '/dash/users',
    group: 'people',
    hasChildren: true,
    getChildren: () => [
      {
        key: 'users',
        label: t('dashboard.users.settings.tabs.users', { defaultValue: 'Users' }),
        href: '/dash/users/settings/users',
        icon: React.createElement(Users, { size: 16 }),
      },
      {
        key: 'usergroups',
        label: t('dashboard.users.settings.tabs.usergroups', { defaultValue: 'User Groups' }),
        href: '/dash/users/settings/usergroups',
        icon: React.createElement(SquareUserRound, { size: 16 }),
        requiresPlan: 'starter',
      },
      {
        key: 'roles',
        label: t('dashboard.users.settings.tabs.roles', { defaultValue: 'Roles' }),
        href: '/dash/users/settings/roles',
        icon: React.createElement(Shield, { size: 16 }),
        requiresPlan: 'starter',
      },
      {
        key: 'signups',
        label: t('dashboard.users.settings.tabs.signups', { defaultValue: 'Signups' }),
        href: '/dash/users/settings/signups',
        icon: React.createElement(ScanEye, { size: 16 }),
      },
      {
        key: 'add',
        label: t('dashboard.users.settings.tabs.add', { defaultValue: 'Add Member' }),
        href: '/dash/users/settings/add',
        icon: React.createElement(UserPlus, { size: 16 }),
      },
      {
        key: 'sign-in',
        label: t('dashboard.users.settings.tabs.sign_in', { defaultValue: 'Sign-in Methods' }),
        href: '/dash/users/settings/sign-in',
        icon: React.createElement(KeyRound, { size: 16 }),
      },
      {
        key: 'two-factor',
        label: t('dashboard.users.settings.tabs.two_factor', { defaultValue: 'Two-Factor Policy' }),
        href: '/dash/users/settings/two-factor',
        icon: React.createElement(ShieldCheck, { size: 16 }),
      },
      {
        key: 'audit-logs',
        label: t('dashboard.users.settings.tabs.audit_logs', { defaultValue: 'Audit Logs' }),
        href: '/dash/users/settings/audit-logs',
        icon: React.createElement(ShieldAlert, { size: 16 }),
        requiresPlan: 'starter',
      },
    ],
  })

  if (enabledFeatures.payments) {
    sections.push({
      key: 'payments',
      label: t('common.payments', { defaultValue: 'Payments' }),
      labelKey: 'common.payments',
      icon: React.createElement(CurrencyCircleDollar, { size: 22, weight: 'fill' }),
      href: '/dash/payments/overview',
      matchPrefix: '/dash/payments',
      group: 'monetization',
      hasChildren: true,
      getChildren: () => [
        {
          key: 'overview',
          label: t('common.overview', { defaultValue: 'Overview' }),
          href: '/dash/payments/overview',
          icon: React.createElement(Users, { size: 16 }),
        },
        {
          key: 'offers',
          label: t('common.offers', { defaultValue: 'Offers' }),
          href: '/dash/payments/offers',
          icon: React.createElement(Gem, { size: 16 }),
        },
        {
          key: 'groups',
          label: t('common.payment_groups', { defaultValue: 'Payment Groups' }),
          href: '/dash/payments/groups',
          icon: React.createElement(Layers, { size: 16 }),
        },
        {
          key: 'configuration',
          label: t('common.configuration', { defaultValue: 'Configuration' }),
          href: '/dash/payments/configuration',
          icon: React.createElement(Settings, { size: 16 }),
        },
      ],
    })
  }

  sections.push({
    key: 'org',
    label: t('common.organization', { defaultValue: 'Organization' }),
    labelKey: 'common.organization',
    icon: React.createElement(Buildings, { size: 22, weight: 'fill' }),
    href: '/dash/org/settings/general',
    matchPrefix: '/dash/org',
    group: 'administration',
    hasChildren: true,
    getChildren: (_, __, isAdmin) => {
      const items: SecondaryNavItem[] = [
        {
          key: 'general',
          label: t('dashboard.organization.settings.tabs.general', { defaultValue: 'General' }),
          href: '/dash/org/settings/general',
          icon: React.createElement(Gear, { size: 16 }),
        },
        {
          key: 'branding',
          label: t('dashboard.organization.settings.tabs.branding', { defaultValue: 'Branding' }),
          href: '/dash/org/settings/branding',
          icon: React.createElement(Palette, { size: 16 }),
        },
        {
          key: 'menu',
          label: t('dashboard.organization.settings.tabs.menu', { defaultValue: 'Public Menu' }),
          href: '/dash/org/settings/menu',
          icon: React.createElement(MenuIcon, { size: 16 }),
        },
        {
          key: 'landing',
          label: t('dashboard.organization.settings.tabs.landing', { defaultValue: 'Landing Page' }),
          href: '/dash/org/settings/landing',
          icon: React.createElement(Rocket, { size: 16 }),
        },
        {
          key: 'ai',
          label: t('dashboard.organization.settings.tabs.ai', { defaultValue: 'AI Features' }),
          href: '/dash/org/settings/ai',
          icon: React.createElement(Robot, { size: 16 }),
          requiresPlan: 'starter',
        },
      ]
      if (isAdmin) {
        items.push({
          key: 'usage',
          label: t('dashboard.organization.settings.tabs.usage', { defaultValue: 'Usage' }),
          href: '/dash/org/settings/usage',
          icon: React.createElement(ChartBar, { size: 16 }),
        })
      }
      items.push(
        {
          key: 'other',
          label: t('dashboard.organization.settings.tabs.other', { defaultValue: 'Other' }),
          href: '/dash/org/settings/other',
          icon: React.createElement(Wrench, { size: 16 }),
        },
        {
          key: 'danger',
          label: t('dashboard.organization.settings.tabs.danger', { defaultValue: 'Danger Zone' }),
          href: '/dash/org/settings/danger',
          icon: React.createElement(AlertTriangle, { size: 16 }),
        }
      )
      return items
    },
  })

  sections.push({
    key: 'developers',
    label: t('dashboard.developers.breadcrumb', { defaultValue: 'Developers' }),
    labelKey: 'dashboard.developers.breadcrumb',
    icon: React.createElement(Code, { size: 22, weight: 'fill' }),
    href: '/dash/developers/api',
    matchPrefix: '/dash/developers',
    group: 'administration',
    hasChildren: true,
    getChildren: () => [
      {
        key: 'api',
        label: t('dashboard.organization.settings.tabs.api', { defaultValue: 'API Access' }),
        href: '/dash/developers/api',
        icon: React.createElement(Key, { size: 16 }),
        requiresPlan: 'growth',
      },
      {
        key: 'automations',
        label: t('dashboard.organization.settings.tabs.automations', { defaultValue: 'Automations' }),
        href: '/dash/developers/automations',
        icon: React.createElement(Lightning, { size: 16 }),
        requiresPlan: 'growth',
      },
      {
        key: 'domains',
        label: t('dashboard.organization.settings.tabs.domains', { defaultValue: 'Custom Domains' }),
        href: '/dash/developers/domains',
        icon: React.createElement(LinkSimple, { size: 16 }),
        requiresPlan: 'growth',
      },
      {
        key: 'seo',
        label: 'SEO',
        href: '/dash/developers/seo',
        icon: React.createElement(MagnifyingGlass, { size: 16 }),
      },
      {
        key: 'sso',
        label: t('dashboard.organization.settings.tabs.sso', { defaultValue: 'SSO' }),
        href: '/dash/developers/sso',
        icon: React.createElement(Lock, { size: 16 }),
        requiresPlan: 'enterprise',
      },
    ],
  })

  sections.push({
    key: 'analytics',
    label: t('common.analytics', { defaultValue: 'Analytics' }),
    labelKey: 'common.analytics',
    icon: React.createElement(ChartBar, { size: 22, weight: 'fill' }),
    href: '/dash/analytics',
    matchPrefix: '/dash/analytics',
    group: 'insights',
    hasChildren: true,
    getChildren: () => [
      {
        key: 'overview',
        label: t('analytics.tabs.overview', { defaultValue: 'Overview' }),
        href: '/dash/analytics',
        icon: React.createElement(ChartLine, { size: 16 }),
      },
      {
        key: 'advanced',
        label: t('analytics.tabs.advanced', { defaultValue: 'Advanced Analytics' }),
        href: '/dash/analytics?tab=advanced',
        icon: React.createElement(SquaresFour, { size: 16 }),
        requiresPlan: 'starter',
      },
    ],
  })

  return sections
}
