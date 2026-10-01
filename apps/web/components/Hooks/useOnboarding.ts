'use client'
import { useState, useCallback, useEffect } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'

export type OnboardingStep = {
  id: string
  title: string
  description: string
  // CTA label + where it goes. `hrefType: 'root'` targets the org's public site
  // (the shareable school), everything else is a /dash/* path.
  action: string
  href: string
  hrefType?: 'org' | 'root'
  // Steps with no navigable completion signal complete when their CTA is clicked.
  completeOnClick?: boolean
  // Regex (source string) on the pathname that auto-completes the step.
  completePath?: string
  completed: boolean
  requiredPlan?: string
  skipped?: boolean
}

type OnboardingState = {
  completedSteps: string[]
  skippedSteps: string[]
  minimized: boolean
  expanded: boolean
  showAllSteps: boolean
  dismissed: boolean
  welcomeSeen: boolean
}

const STORAGE_KEY = 'vb_onboarding'

// Outcome-framed onboarding: 6 milestones that ladder toward the north-star —
// your first enrolled learner — then retention. Each title is the WIN; the
// action is just the means. Every step delivers value on the free plan.
const DEFAULT_STEPS: Omit<OnboardingStep, 'completed'>[] = [
  {
    id: 'create_course',
    title: 'Your first course is live',
    description: 'Publish a course so there’s something real for learners to enroll in.',
    action: 'Create a course',
    href: '/dash/courses?new=true',
    completePath: '/dash/courses/course/[^/]+/general',
  },
  {
    id: 'add_content',
    title: 'A lesson worth showing up for',
    description: 'Add a video, page or quiz — give learners a real reason to enroll.',
    action: 'Add content',
    href: '/dash/courses',
    completePath: '/dash/courses/course/[^/]+/content',
  },
  {
    id: 'brand_school',
    title: 'A school learners trust',
    description: 'Add your logo and colors so it looks like a credible, professional school.',
    action: 'Brand it',
    href: '/dash/org/settings/general',
    completePath: '/dash/org/settings/(general|branding)',
  },
  {
    id: 'share_grow',
    title: 'Your school’s front door',
    description: 'Go live and grab your shareable link — the place you’ll send every learner.',
    action: 'Open my school',
    href: '/',
    hrefType: 'root',
    completeOnClick: true,
  },
  {
    id: 'invite_learners',
    title: 'Welcome your first learner',
    description: 'Share your join link or invite people — get that first learner through the door.',
    action: 'Invite learners',
    href: '/dash/users/settings/add',
    completePath: '/dash/users/settings/add',
  },
  {
    id: 'build_community',
    title: 'Keep learners coming back',
    description: 'Open a community space so your learners stay active — and bring their friends.',
    action: 'Open community',
    href: '/dash/connect',
    completePath: '/dash/connect',
  },
]

// Extra milestones used by role-specific checklists (see ROLE_STEPS).
const EXTRA_STEPS: Omit<OnboardingStep, 'completed'>[] = [
  {
    id: 'invite_teachers',
    title: 'Your teachers are on board',
    description: 'Invite your teachers so they can build courses and run live classes.',
    action: 'Invite teachers',
    href: '/dash/users/settings/add',
    completePath: '/dash/users/settings/add',
  },
  {
    id: 'add_quiz',
    title: 'Your first quiz or assignment',
    description: 'Check understanding with a quiz or an assignment that grades itself.',
    action: 'Create an assignment',
    href: '/dash/assignments',
    completePath: '/dash/assignments/[^/]+',
  },
  {
    id: 'schedule_live',
    title: 'Your first live class',
    description: 'Open a course and schedule a live class. Students join from the browser.',
    action: 'Schedule a live class',
    href: '/dash/courses',
    completePath: '/dash/courses/course/[^/]+/live',
  },
  {
    id: 'connect_paystack',
    title: 'Ready to get paid',
    description: 'Connect your Paystack account so learners can pay by card or M-Pesa.',
    action: 'Connect Paystack',
    href: '/dash/payments/configuration',
    completePath: '/dash/payments/configuration',
  },
  {
    id: 'publish_offer',
    title: 'Your first course for sale',
    description: 'Create an offer with a price in KES. The money goes straight to you.',
    action: 'Create an offer',
    href: '/dash/payments/offers',
    completePath: '/dash/payments/offers',
  },
  {
    id: 'create_groups',
    title: 'Teams organised',
    description: 'Create user groups for departments or cohorts.',
    action: 'Create groups',
    href: '/dash/users/settings/usergroups',
    completePath: '/dash/users/settings/usergroups',
  },
  {
    id: 'check_analytics',
    title: 'See who is learning',
    description: 'Track progress, attendance and completion across your courses.',
    action: 'Open analytics',
    href: '/dash/analytics',
    completePath: '/dash/analytics',
  },
]

const ALL_STEPS = [...DEFAULT_STEPS, ...EXTRA_STEPS]

/** First-week checklist per onboarding role (org config `onboarding.role`). */
export const ROLE_STEPS: Record<string, string[]> = {
  admin: ['brand_school', 'invite_teachers', 'invite_learners', 'create_course', 'check_analytics'],
  teacher: ['create_course', 'add_content', 'add_quiz', 'schedule_live', 'invite_learners'],
  creator: ['create_course', 'add_content', 'connect_paystack', 'publish_offer', 'share_grow'],
  company: ['create_groups', 'invite_learners', 'create_course', 'check_analytics'],
}

/** Step definitions for a role; unknown or missing roles get the default list. */
export function stepsForRole(role?: string | null): Omit<OnboardingStep, 'completed'>[] {
  const ids = role ? ROLE_STEPS[role] : undefined
  if (!ids) return DEFAULT_STEPS
  return ids.map((id) => ALL_STEPS.find((s) => s.id === id)!).filter(Boolean)
}

// Raw step definitions (incl. completion-path regexes) for the headless tracker.
export const ONBOARDING_STEP_DEFS = ALL_STEPS

function loadState(): OnboardingState {
  if (typeof window === 'undefined') {
    return { completedSteps: [], skippedSteps: [], minimized: false, expanded: false, showAllSteps: false, dismissed: false, welcomeSeen: false }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        completedSteps: parsed.completedSteps || [],
        skippedSteps: parsed.skippedSteps || [],
        minimized: parsed.minimized || false,
        expanded: parsed.expanded || false,
        showAllSteps: parsed.showAllSteps || false,
        dismissed: parsed.dismissed || false,
        welcomeSeen: parsed.welcomeSeen || false,
      }
    }
  } catch {
    /* ignore */
  }
  return { completedSteps: [], skippedSteps: [], minimized: false, expanded: false, showAllSteps: false, dismissed: false, welcomeSeen: false }
}

function saveState(state: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    window.dispatchEvent(new Event('vb_onboarding_change'))
  } catch {
    /* ignore */
  }
}

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(loadState)

  const applyLocalChange = useCallback(
    (updater: (_prev: OnboardingState) => OnboardingState) => {
      setState((prev) => {
        const next = updater(prev)
        if (next !== prev) {
          saveState(next)
        }
        return next
      })
    },
    []
  )

  // Listen for changes from other instances of this hook
  useEffect(() => {
    const handler = () => {
      setState((prev) => {
        const loaded = loadState()
        if (JSON.stringify(loaded) === JSON.stringify(prev)) return prev
        return loaded
      })
    }
    window.addEventListener('vb_onboarding_change', handler)
    return () => window.removeEventListener('vb_onboarding_change', handler)
  }, [])

  const org = useOrg() as any
  const role: string | undefined = org?.config?.config?.onboarding?.role
  const steps: OnboardingStep[] = stepsForRole(role).map((s) => ({
    ...s,
    completed: state.completedSteps.includes(s.id) || state.skippedSteps.includes(s.id),
    skipped: state.skippedSteps.includes(s.id),
  }))

  const currentStepIndex = steps.findIndex((s) => !s.completed)
  const currentStep = currentStepIndex >= 0 ? steps[currentStepIndex] : null
  const allCompleted = steps.every((s) => s.completed)
  const progress = steps.length > 0 ? steps.filter((s) => s.completed).length / steps.length : 0

  const completeStep = useCallback((stepId: string) => {
    applyLocalChange((prev) => {
      if (prev.completedSteps.includes(stepId)) return prev
      return { ...prev, completedSteps: [...prev.completedSteps, stepId] }
    })
  }, [applyLocalChange])

  const toggleMinimized = useCallback(() => {
    applyLocalChange((prev) => ({ ...prev, minimized: !prev.minimized }))
  }, [applyLocalChange])

  const toggleExpanded = useCallback(() => {
    applyLocalChange((prev) => ({ ...prev, expanded: !prev.expanded }))
  }, [applyLocalChange])

  const toggleShowAllSteps = useCallback(() => {
    applyLocalChange((prev) => ({ ...prev, showAllSteps: !prev.showAllSteps }))
  }, [applyLocalChange])

  const dismiss = useCallback(() => {
    applyLocalChange((prev) => (prev.dismissed ? prev : { ...prev, dismissed: true }))
  }, [applyLocalChange])

  const markWelcomeSeen = useCallback(() => {
    applyLocalChange((prev) => (prev.welcomeSeen ? prev : { ...prev, welcomeSeen: true }))
  }, [applyLocalChange])

  const skipStep = useCallback((stepId: string) => {
    applyLocalChange((prev) => {
      if (prev.skippedSteps.includes(stepId)) return prev
      return { ...prev, skippedSteps: [...prev.skippedSteps, stepId] }
    })
  }, [applyLocalChange])

  const reset = useCallback(() => {
    applyLocalChange(() => ({ completedSteps: [], skippedSteps: [], minimized: false, expanded: false, showAllSteps: false, dismissed: false, welcomeSeen: false }))
  }, [applyLocalChange])

  return {
    steps,
    currentStep,
    currentStepIndex,
    allCompleted,
    progress,
    minimized: state.minimized,
    expanded: state.expanded,
    showAllSteps: state.showAllSteps,
    dismissed: state.dismissed,
    welcomeSeen: state.welcomeSeen,
    completeStep,
    dismiss,
    markWelcomeSeen,
    toggleMinimized,
    toggleExpanded,
    toggleShowAllSteps,
    skipStep,
    reset,
  }
}
