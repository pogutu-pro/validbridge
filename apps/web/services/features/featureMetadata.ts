/**
 * Single source of truth for client-side per-feature metadata.
 *
 * Drives the FeatureGate component (locked/disabled views) and any UI that
 * needs the canonical icon + label + upsell plan for a feature. The gate's
 * actual `required_plan` still comes from the backend's resolved_features —
 * this file only owns presentation + the *upsell* plan we suggest in the UI
 * (which may differ from the gate's minimum requirement, e.g. Boards gates at
 * Personal but we upsell Free users to Standard).
 */

import {
  BookOpen,
  ChalkboardSimple,
  ChartBar,
  ChartLine,
  ChatsCircle,
  Certificate,
  Cube,
  CreditCard,
  FolderSimple,
  Globe,
  Key,
  Lightning,
  ListChecks,
  LockKey,
  Microphone,
  Path,
  Robot,
  ShieldCheck,
  UsersThree,
} from '@phosphor-icons/react'
import type { IconProps } from '@phosphor-icons/react'
import type { ComponentType } from 'react'

import { PlanLevel } from '@services/plans/plans'

export type FeatureKey =
  | 'boards'
  | 'playgrounds'
  | 'communities'
  | 'podcasts'
  | 'ai'
  | 'analytics'
  | 'course_analytics'
  | 'payments'
  | 'usergroups'
  | 'custom_domains'
  | 'roles'
  | 'api_access'
  | 'webhooks'
  | 'certifications'
  | 'audit_logs'
  | 'sso'
  | 'scorm'
  | 'seo'
  // Features that are never plan-gated but can be admin-toggled off. Listed
  // here so FeatureGate can render the disabled card with the right icon.
  | 'courses'
  | 'folders'
  | 'trail'

export interface FeatureMeta {
  /** i18n key for the short title shown in the locked card (e.g. "Growth Feature"). */
  titleKey: string
  /** i18n key for the explanation paragraph. */
  descriptionKey: string
  /** Phosphor icon component. */
  Icon: ComponentType<IconProps>
  /**
   * Plan tier displayed in the upsell badge. Independent of the gate's actual
   * minimum requirement — used for marketing alignment. Entry-tier values
   * (starter / public-education) mean "available on every plan" and never
   * show an upgrade card (see lib/features/gateReason.ts).
   */
  upsellPlan: PlanLevel
}

export const FEATURE_METADATA: Record<FeatureKey, FeatureMeta> = {
  boards: {
    titleKey: 'common.plans.feature_restricted.boards.title',
    descriptionKey: 'common.plans.feature_restricted.boards.description',
    Icon: ChalkboardSimple,
    upsellPlan: 'starter',
  },
  playgrounds: {
    titleKey: 'common.plans.feature_restricted.playgrounds.title',
    descriptionKey: 'common.plans.feature_restricted.playgrounds.description',
    Icon: Cube,
    upsellPlan: 'starter',
  },
  communities: {
    titleKey: 'common.plans.feature_restricted.communities.title',
    descriptionKey: 'common.plans.feature_restricted.communities.description',
    Icon: ChatsCircle,
    upsellPlan: 'starter',
  },
  podcasts: {
    titleKey: 'common.plans.feature_restricted.podcasts.title',
    descriptionKey: 'common.plans.feature_restricted.podcasts.description',
    Icon: Microphone,
    upsellPlan: 'starter',
  },
  ai: {
    titleKey: 'common.plans.feature_restricted.ai.title',
    descriptionKey: 'common.plans.feature_restricted.ai.description',
    Icon: Robot,
    upsellPlan: 'starter',
  },
  analytics: {
    titleKey: 'common.plans.feature_restricted.analytics.title',
    descriptionKey: 'common.plans.feature_restricted.analytics.description',
    Icon: ChartBar,
    upsellPlan: 'starter',
  },
  course_analytics: {
    titleKey: 'common.plans.feature_restricted.course_analytics.title',
    descriptionKey: 'common.plans.feature_restricted.course_analytics.description',
    Icon: ChartLine,
    upsellPlan: 'starter',
  },
  payments: {
    titleKey: 'common.plans.feature_restricted.payments.title',
    descriptionKey: 'common.plans.feature_restricted.payments.description',
    Icon: CreditCard,
    upsellPlan: 'starter',
  },
  usergroups: {
    titleKey: 'common.plans.feature_restricted.usergroups.title',
    descriptionKey: 'common.plans.feature_restricted.usergroups.description',
    Icon: UsersThree,
    upsellPlan: 'starter',
  },
  custom_domains: {
    titleKey: 'common.plans.feature_restricted.custom_domains.title',
    descriptionKey: 'common.plans.feature_restricted.custom_domains.description',
    Icon: Globe,
    upsellPlan: 'growth',
  },
  roles: {
    titleKey: 'common.plans.feature_restricted.roles.title',
    descriptionKey: 'common.plans.feature_restricted.roles.description',
    Icon: ShieldCheck,
    upsellPlan: 'starter',
  },
  api_access: {
    titleKey: 'common.plans.feature_restricted.api_access.title',
    descriptionKey: 'common.plans.feature_restricted.api_access.description',
    Icon: Key,
    upsellPlan: 'growth',
  },
  webhooks: {
    titleKey: 'common.plans.feature_restricted.webhooks.title',
    descriptionKey: 'common.plans.feature_restricted.webhooks.description',
    Icon: Lightning,
    upsellPlan: 'growth',
  },
  certifications: {
    titleKey: 'common.plans.feature_restricted.certifications.title',
    descriptionKey: 'common.plans.feature_restricted.certifications.description',
    Icon: Certificate,
    upsellPlan: 'starter',
  },
  audit_logs: {
    titleKey: 'common.plans.feature_restricted.audit_logs.title',
    descriptionKey: 'common.plans.feature_restricted.audit_logs.description',
    Icon: ListChecks,
    upsellPlan: 'starter',
  },
  sso: {
    titleKey: 'common.plans.feature_restricted.sso.title',
    descriptionKey: 'common.plans.feature_restricted.sso.description',
    Icon: LockKey,
    upsellPlan: 'enterprise',
  },
  scorm: {
    titleKey: 'common.plans.feature_restricted.scorm.title',
    descriptionKey: 'common.plans.feature_restricted.scorm.description',
    Icon: Cube,
    upsellPlan: 'enterprise',
  },
  seo: {
    titleKey: 'common.plans.feature_restricted.seo.title',
    descriptionKey: 'common.plans.feature_restricted.seo.description',
    Icon: Globe,
    upsellPlan: 'starter',
  },
  // Non-plan-gated; upsellPlan kept at the entry tier so the upgrade card never fires.
  // Only the admin-disabled state is reachable for these features.
  courses: {
    titleKey: 'common.features.disabled.names.courses',
    descriptionKey: 'common.features.disabled.public.description',
    Icon: BookOpen,
    upsellPlan: 'starter',
  },
  folders: {
    titleKey: 'common.features.disabled.names.folders',
    descriptionKey: 'common.features.disabled.public.description',
    Icon: FolderSimple,
    upsellPlan: 'starter',
  },
  trail: {
    titleKey: 'common.features.disabled.names.trail',
    descriptionKey: 'common.features.disabled.public.description',
    Icon: Path,
    upsellPlan: 'starter',
  },
}

export function getFeatureMeta(feature: FeatureKey): FeatureMeta {
  return FEATURE_METADATA[feature]
}
