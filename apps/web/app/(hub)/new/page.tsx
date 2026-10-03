'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { billingUrl, clearPlanIntent, readPlanIntent, type PlanIntent } from '@services/billing/planIntent'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { dirMultiplier, directionForLanguage } from '@/lib/direction'
import { useFormik } from 'formik'
import * as Form from '@radix-ui/react-form'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Info,
  CircleNotch as Loader,
  SignOut as LogOut,
} from '@phosphor-icons/react'

import { useVBSession } from '@components/Contexts/VBSessionContext'
import { signOut } from '@components/Contexts/AuthContext'
import UserAvatar from '@components/Objects/UserAvatar'
import DemoEntryCard from '@components/Objects/Demo/DemoEntryCard'
import { createNewOrganization, submitPublicEdApplication } from '@services/organizations/orgs'
import { StepRole, StepInstitution, StudentJoin } from './_components/RoleSteps'
import {
  EMPTY_PUBLIC_ED,
  ONBOARDING_ROLES,
  canApplyPublicEd,
  publicEdReady,
  type InstitutionType,
  type OnboardingRole,
  type PublicEdForm,
} from './_components/onboarding'
import { useVBAnalytics } from '@services/analytics/useVBAnalytics'
import { AnalyticsEvent } from '@services/analytics/events'
import { getUriWithOrg } from '@services/config/config'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'


// ── Constants ───────────────────────────────────────────────────────────────

// No plan-selection or payment step: every new organization is created on the
// platform's default plan. Plans and payments move to the billing page.
type Step = 'use-type' | 'usage' | 'create-org' | 'success'

const RESERVED_SLUGS = ['validbridge', 'graphicmade', 'sweave', 'cname']
const RESTRICTED_WORDS = ['sex', 'test']

const STEP_NUMBER: Record<Step, number> = {
  'use-type': 1,
  usage: 2,
  'create-org': 3,
  success: 3,
}
const TOTAL_STEPS = 3

// ── Animation ─────────────────────────────────────────────────────────────────

// `dir` is the step direction (+1 forward, -1 back), not text direction. The
// custom prop passed at the call site already folds in the text direction, so
// "forward" always slides toward the inline end.
const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 24, filter: 'blur(3px)' }),
  center: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit: (dir: number) => ({ opacity: 0, x: dir * -24, filter: 'blur(3px)' }),
}
const trans = { duration: 0.26, ease: [0.4, 0, 0.2, 1] as any }

// Map a backend error to a human-readable message, never leaking the raw
// FastAPI validation payload (e.g. `[{"type":"missing","loc":["body","email"]}]`)
// into the UI. `errorHandling` JSON.stringifies non-string `detail`, so guard
// against both stringified-JSON messages and structured `detail` arrays/objects.
function friendlyCreateError(e: any, fallback: string): string {
  const detail = e?.detail
  // FastAPI 422: detail is an array of {loc, msg, type}
  if (Array.isArray(detail)) {
    const first = detail[0]
    const field = Array.isArray(first?.loc) ? first.loc[first.loc.length - 1] : undefined
    if (field && first?.msg) return `${String(field)}: ${first.msg}`
    return fallback
  }
  if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string') return detail.message
    return fallback
  }
  const msg = typeof e?.message === 'string' ? e.message.trim() : ''
  // A JSON-stringified payload leaked through as the message — don't show it raw.
  if (!msg || msg.startsWith('[') || msg.startsWith('{')) return fallback
  return msg
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20)
}

// ── Small UI atoms ────────────────────────────────────────────────────────────

function StepPills({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <motion.div
          key={i}
          className="h-1.5 rounded-full"
          initial={false}
          animate={{
            width: i + 1 === current ? 24 : 7,
            backgroundColor: i + 1 <= current ? '#111827' : '#e5e7eb',
          }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        />
      ))}
      <span className="ms-1 text-xs text-gray-400 tabular-nums">
        {current}/{TOTAL_STEPS}
      </span>
    </div>
  )
}

const FormLabelAndMessage = ({ label, message }: { label: string; message?: string }) => (
  <div className="flex items-center justify-between mb-2">
    <Form.Label className="text-[13px] font-semibold text-black/50">{label}</Form.Label>
    {message && (
      <div className="flex items-center gap-1 text-red-500/80 text-[11px] font-medium">
        <Info size={9} />
        <span>{message}</span>
      </div>
    )}
  </div>
)


function TestHint({ t }: { t: any }) {
  return (
    <div className="mt-2.5 flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-3">
      <Info size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="text-[12px] leading-relaxed text-amber-800">
        <span className="font-semibold">{t('hub_new.createOrg.testHint.title', { defaultValue: 'Looking to test?' })}</span>{' '}
        <span className="text-amber-700">
          {t('hub_new.createOrg.testHint.body', { defaultValue: 'Try a' })}{' '}
          <span className="font-semibold">
            {t('hub_new.createOrg.testHint.link', { defaultValue: 'different name' })}
          </span>{' '}
          {t('hub_new.createOrg.testHint.suffix', { defaultValue: 'for your organization.' })}
        </span>
      </div>
    </div>
  )
}

function CreateOrgForm({
  submitting,
  error,
  onSubmit,
  initialName = '',
  t,
}: {
  submitting: boolean
  error: string
  initialName?: string
  onSubmit: (_values: { name: string; description: string; slug: string }) => void
  t: any
}) {
  const slugEdited = useRef(false)

  const validate = (values: any) => {
    const errors: any = {}
    if (!values.name) errors.name = t('hub_new.createOrg.validation.required', { defaultValue: 'Required' })
    else if (/test/i.test(values.name)) errors.name = 'test_hint'
    if (!values.slug) errors.slug = t('hub_new.createOrg.validation.required', { defaultValue: 'Required' })
    else if (values.slug !== values.slug.toLowerCase())
      errors.slug = t('hub_new.createOrg.validation.lowercase', { defaultValue: 'Lowercase only' })
    else if (values.slug.match(/[^a-z0-9-]/))
      errors.slug = t('hub_new.createOrg.validation.noSpecialChars', { defaultValue: 'Letters, numbers, dashes only' })
    else if (values.slug.includes('test')) errors.slug = 'test_hint'
    else if (RESERVED_SLUGS.includes(values.slug))
      errors.slug = t('hub_new.createOrg.validation.reserved', { defaultValue: 'This slug is reserved' })
    else if (RESTRICTED_WORDS.some((w) => values.slug.includes(w)))
      errors.slug = t('hub_new.createOrg.validation.reserved', { defaultValue: 'This slug is reserved' })
    else if (values.slug.length > 20)
      errors.slug = t('hub_new.createOrg.validation.maxLength', { defaultValue: 'Max 20 characters' })
    return errors
  }

  const formik = useFormik({
    initialValues: { name: initialName, description: '', slug: slugify(initialName) },
    validate,
    onSubmit: (values) => onSubmit({ name: values.name, description: values.description, slug: values.slug }),
  })

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    formik.handleChange(e)
    if (!slugEdited.current) {
      formik.setFieldValue('slug', slugify(e.target.value))
    }
  }

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    slugEdited.current = true
    formik.handleChange(e)
  }

  const inputCls =
    'w-full bg-white nice-shadow text-[14px] text-black/80 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/[0.06] transition-all placeholder:text-black/20'
  const hasErrors = Object.keys(formik.errors).length > 0

  return (
    <div>
      <div className="bg-white nice-shadow rounded-2xl p-7">
        {error && (
          <div className="flex items-center gap-2.5 bg-red-50 rounded-xl px-4 py-3 mb-5 text-red-600 border border-red-100">
            <Info size={14} className="flex-shrink-0" />
            <span className="text-[13px] font-medium">{error}</span>
          </div>
        )}
        <Form.Root onSubmit={formik.handleSubmit} className="space-y-5">
          <Form.Field name="name">
            <FormLabelAndMessage
              label={t('hub_new.createOrg.fields.name', { defaultValue: 'Organization name' })}
              message={formik.errors.name === 'test_hint' ? undefined : (formik.errors.name as string)}
            />
            <Form.Control asChild>
              <input
                className={inputCls}
                onChange={handleNameChange}
                value={formik.values.name}
                type="text"
                placeholder={t('hub_new.createOrg.placeholders.name', { defaultValue: 'Acme Academy' })}
                required
              />
            </Form.Control>
            {formik.errors.name === 'test_hint' && <TestHint t={t} />}
          </Form.Field>

          <Form.Field name="description">
            <FormLabelAndMessage
              label={t('hub_new.createOrg.fields.description', { defaultValue: 'Description (optional)' })}
            />
            <Form.Control asChild>
              <input
                className={inputCls}
                onChange={formik.handleChange}
                value={formik.values.description}
                type="text"
                placeholder={t('hub_new.createOrg.placeholders.description', {
                  defaultValue: 'What is your organization about?',
                })}
              />
            </Form.Control>
          </Form.Field>

          <Form.Field name="slug">
            <FormLabelAndMessage
              label={t('hub_new.createOrg.fields.slug', { defaultValue: 'Address' })}
              message={formik.errors.slug === 'test_hint' ? undefined : (formik.errors.slug as string)}
            />
            <div className="flex items-center rounded-xl overflow-hidden nice-shadow focus-within:ring-2 focus-within:ring-black/[0.06] transition-all">
              <Form.Control asChild>
                <input
                  className="flex-1 bg-white text-[14px] text-black/80 px-4 py-3 focus:outline-none placeholder:text-black/20"
                  onChange={handleSlugChange}
                  value={formik.values.slug}
                  placeholder="your-org"
                  type="text"
                  required
                />
              </Form.Control>
              <span className="px-4 py-3 bg-gray-50 text-black/25 border-s border-gray-100 shrink-0 text-[13px] font-medium select-none">
                .validbridge.co.ke
              </span>
            </div>
            {formik.errors.slug === 'test_hint' && <TestHint t={t} />}
          </Form.Field>

          <Form.Submit asChild>
            <motion.button
              disabled={hasErrors || submitting}
              whileTap={hasErrors || submitting ? {} : { scale: 0.98 }}
              className={`w-full flex items-center justify-center gap-2 text-[14px] font-semibold py-3 rounded-xl transition-colors mt-1 ${
                hasErrors || submitting
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-900 hover:bg-gray-800 text-white cursor-pointer'
              }`}
            >
              {submitting ? (
                <>
                  <Loader size={15} className="animate-spin" />
                  {t('hub_new.createOrg.submitting', { defaultValue: 'Creating…' })}
                </>
              ) : (
                <>
                  {t('hub_new.createOrg.submit', { defaultValue: 'Create organization' })}
                  <ArrowRight size={15} data-dir-flip />
                </>
              )}
            </motion.button>
          </Form.Submit>
        </Form.Root>
      </div>
    </div>
  )
}

// ── Success (cross-domain handoff into the new org app) ────────────────────────

function CreateOrgSuccess({ slug, t }: { slug: string; t: any }) {
  const [going, setGoing] = useState(false)
  // A plan chosen on the pricing page ("Choose Growth") is offered here.
  const [intent, setIntent] = useState<PlanIntent | null>(null)
  useEffect(() => {
    setIntent(readPlanIntent())
  }, [])

  const handleGoToOrg = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (going) return
    setGoing(true)
    // Single-domain (.io) consolidation: the apex and the org subdomain share
    // the .{top_domain}-scoped session cookie, so the session already covers the
    // subdomain — no cross-domain code-mint/token-exchange handoff is needed.
    // Refresh once to mint a fresh access token, then land on the new org's
    // onboarding (the first page for a brand-new org).
    try {
      await fetch('/api/auth/refresh', { credentials: 'include' })
    } catch {
      /* non-fatal — the existing session cookie still carries over */
    }
    window.location.href = getUriWithOrg(slug, '/dash/onboarding')
  }

  return (
    <div className="flex flex-col items-center py-10 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4"
      >
        <Check size={32} className="text-emerald-600" />
      </motion.div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">
        {t('hub_new.success.title', { defaultValue: 'Your organization is ready' })}
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        {t('hub_new.success.description', { defaultValue: 'Jump in and start building your courses.' })}
      </p>
      {intent && (
        <div className="mb-5 w-full max-w-sm rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-start">
          <p className="text-sm font-semibold text-orange-900">
            {t('hub_new.success.planIntent', {
              defaultValue: 'You chose {{plan}}. Your school starts on the free Starter plan until you pay.',
              plan: intent.plan === 'business' ? 'Business' : 'Growth',
            })}
          </p>
          <Link
            href={billingUrl(slug, intent)}
            onClick={() => clearPlanIntent()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-orange-700"
          >
            {t('hub_new.success.planIntentCta', {
              defaultValue: 'Continue to {{plan}} checkout',
              plan: intent.plan === 'business' ? 'Business' : 'Growth',
            })}
            <ArrowRight size={13} data-dir-flip />
          </Link>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={handleGoToOrg}
          disabled={going}
          className="inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {going ? (
            <>
              <Loader size={15} className="animate-spin" />
              {t('hub_new.success.goToOrg', { defaultValue: 'Go to organization' })}
            </>
          ) : (
            <>
              {t('hub_new.success.goToOrg', { defaultValue: 'Go to organization' })}
              <ArrowRight size={15} data-dir-flip />
            </>
          )}
        </button>
        <Link
          href="/home"
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-xl hover:bg-gray-100 transition-colors"
        >
          {t('hub_new.success.cta', { defaultValue: 'Back to organizations' })}
        </Link>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CreateNewOrgPage() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const session = useVBSession() as any
  const access_token = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'
  const { track } = useVBAnalytics('hub')

  useEffect(() => {
    track(AnalyticsEvent.OnboardingStarted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [step, setStep] = useState<Step>('use-type')
  const [dir, setDir] = useState<1 | -1>(1)
  // Fold text direction into the slide axis so a "next" step always moves
  // toward the inline end, mirroring in Arabic.
  const slideAxis = dirMultiplier(directionForLanguage(i18n.language))
  const [role, setRole] = useState<OnboardingRole | null>(null)
  const [institutionType, setInstitutionType] = useState<InstitutionType | null>(null)
  const [publicEd, setPublicEd] = useState<PublicEdForm>(EMPTY_PUBLIC_ED)
  const [createdSlug, setCreatedSlug] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // The welcome email's "What brings you here?" links open setup at the step
  // after the role question (/new?role=teacher). Read once on mount, like the
  // plan intent below; useSearchParams would need a Suspense boundary here.
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get('role')
    if (preset && (ONBOARDING_ROLES as readonly string[]).includes(preset)) {
      // The URL is only readable after hydration; one-time sync from it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRole(preset as OnboardingRole)
      setStep('usage')
    }
  }, [])

  // Redirect unauthenticated users (same effect as app/home/home.tsx).
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isLoading, isAuthenticated, router])

  const wantsPublicEd = canApplyPublicEd(institutionType) && publicEd.apply
  const canAdvanceUsage =
    role !== null && role !== 'student' && institutionType !== null && (!wantsPublicEd || publicEdReady(publicEd))

  const handleCreate = async (values: { name: string; description: string; slug: string }) => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    track(AnalyticsEvent.OrgCreateSubmitted, { use_type: role, institution_type: institutionType })
    const toastId = toast.loading(t('hub_new.toast.creating', { defaultValue: 'Creating organization…' }))
    try {
      const newOrg = await createNewOrganization(
        {
          name: values.name,
          description: values.description,
          slug: values.slug,
          email: session?.data?.user?.email ?? '',
          logo_image: '',
          onboarding: role && role !== 'student' ? { role, institution_type: institutionType } : undefined,
        },
        access_token
      )
      const newSlug = newOrg?.slug ?? values.slug
      track(AnalyticsEvent.OrgCreated, { use_type: role, institution_type: institutionType, slug: newSlug })

      // Public institutions: file the verification now. The org already works
      // on Starter; a failure here is recoverable from settings.
      if (wantsPublicEd && newOrg?.id) {
        try {
          await submitPublicEdApplication(
            newOrg.id,
            {
              institution: publicEd.institution.trim() || values.name,
              institutionType: institutionType as string,
              regNumber: publicEd.regNumber.trim(),
              email: (publicEd.email || session?.data?.user?.email || '').trim(),
              agreementAccepted: publicEd.agree,
              document: publicEd.document,
            },
            access_token
          )
        } catch {
          toast(t('hub_new.publicEd.submitLater', { defaultValue: 'Your school is ready. You can finish the Public Education application in settings.' }))
        }
      }

      // The creator is now an admin of this org — record them in the marketing
      // audience (Loops), along with the onboarding choices as contact
      // properties (use_types, …). Fire-and-forget & SaaS-gated
      // server-side; the email is taken from the verified session there.
      void fetch('/api/loops/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orgSlug: newSlug,
          onboarding: {
            use_types: role || undefined,
            use_cases: institutionType || undefined,
            onboarding_completed: true,
          },
        }),
      }).catch(() => {})

      // Refresh session and invalidate the cached org list so the new org appears.
      try {
        await session?.update?.(true)
      } catch {
        /* no-op */
      }
      queryClient.invalidateQueries({ queryKey: ['orgs', 'user'] })
      toast.dismiss(toastId)
      toast.success(t('hub_new.toast.created', { defaultValue: 'Organization created!' }))

      setCreatedSlug(newSlug)
      setDir(1)
      setStep('success')
    } catch (e: any) {
      toast.dismiss(toastId)
      const fallback = t('hub_new.toast.failed', { defaultValue: 'Failed to create organization' })
      const msg = friendlyCreateError(e, fallback)
      track(AnalyticsEvent.OrgCreateFailed, { use_type: role, error: msg })
      toast.error(msg)
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // Navigation helpers
  const goBack = () => {
    setDir(-1)
    if (step === 'usage') setStep('use-type')
    else if (step === 'create-org') setStep('usage')
  }
  const advance = () => {
    setDir(1)
    if (step === 'use-type' && role) setStep('usage')
    else if (step === 'usage' && canAdvanceUsage) setStep('create-org')
  }
  const skip = () => {
    setDir(1)
    setStep('create-org')
  }

  const stepNumber = STEP_NUMBER[step]
  const showSkip = step === 'usage' && role !== 'student'
  const showNav = step === 'use-type' || (step === 'usage' && role !== 'student')
  const showBack = step !== 'use-type' && step !== 'success'
  const canContinue = step === 'use-type' ? role !== null : canAdvanceUsage

  const META: Record<Step, { title: string; subtitle: string }> = {
    'use-type': {
      title: t('hub_new.steps.role.title', { defaultValue: 'What best describes you?' }),
      subtitle: t('hub_new.steps.role.subtitle', { defaultValue: 'We will set up ValidBridge around how you teach or learn.' }),
    },
    usage:
      role === 'student'
        ? {
            title: t('hub_new.steps.join.title', { defaultValue: 'Join your school' }),
            subtitle: t('hub_new.steps.join.subtitle', { defaultValue: 'Your school gives you access. No setup needed.' }),
          }
        : {
            title: t('hub_new.steps.where.title', { defaultValue: 'Where do you teach?' }),
            subtitle: t('hub_new.steps.where.subtitle', { defaultValue: 'This helps us pick the right plan and first steps.' }),
          },
    'create-org': {
      title: t('hub_new.steps.createOrg.title', { defaultValue: 'Name your organization' }),
      subtitle: t('hub_new.steps.createOrg.subtitle', { defaultValue: 'Pick a name and a web address.' }),
    },
    success: {
      title: t('hub_new.steps.success.title', { defaultValue: 'All set' }),
      subtitle: '',
    },
  }
  const meta = META[step]

  const showLoader = isLoading || (isAuthenticated && !session?.data)

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-y-auto">
      <div className="relative min-h-screen">
        {/* Blueprint grid — fades in from bottom */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(rgba(0,0,0,0.018) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.018) 1px, transparent 1px)
            `,
            backgroundSize: '80px 80px, 80px 80px, 16px 16px, 16px 16px',
            maskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
            WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
          }}
        />

        <div className="relative z-10 min-h-screen flex flex-col items-center py-8 px-4">
          {/* Top bar */}
          <div className="w-full max-w-5xl mb-10 grid grid-cols-3 items-center">
            <Link
              href="/home"
              className="flex items-center gap-1.5 text-sm font-semibold text-black/35 hover:text-black transition-colors w-fit"
            >
              <ArrowLeft size={14} data-dir-flip />
              {t('hub_new.topBar.back', { defaultValue: 'Organizations' })}
            </Link>
            <div className="flex justify-center">
              <Link href="/home">
                { }
                <img src="/validbridge.svg" alt="ValidBridge" width={40} height={40} className="opacity-90" />
              </Link>
            </div>
            <div className="flex justify-end">
              {isAuthenticated && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button aria-label="User menu" className="rounded-full">
                      <UserAvatar border="border-2" rounded="rounded-full" width={34} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end">
                    <DropdownMenuLabel>
                      <div className="flex flex-col">
                        <p className="text-sm font-medium">
                          {session?.data?.user?.first_name} {session?.data?.user?.last_name}
                        </p>
                        <p className="text-xs text-gray-500">{session?.data?.user?.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => signOut({ redirect: true, callbackUrl: '/login' })}
                      className="flex items-center space-x-2 text-red-600 focus:text-red-600"
                    >
                      <LogOut size={16} />
                      <span>{t('user.sign_out', { defaultValue: 'Sign out' })}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <div className="w-full max-w-xl">
            {showLoader ? (
              <div className="space-y-3">
                <div className="h-40 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
                <div className="h-40 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
              </div>
            ) : (
              <>
                {/* Header */}
                <AnimatePresence mode="wait" custom={dir * slideAxis}>
                  <motion.div
                    key={`hdr-${step}`}
                    custom={dir * slideAxis}
                    variants={slide}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={trans}
                    className="text-center mb-8"
                  >
                    <div className="flex justify-center mb-5">
                      <StepPills current={stepNumber} />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">{meta.title}</h1>
                    {meta.subtitle && (
                      <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">{meta.subtitle}</p>
                    )}
                  </motion.div>
                </AnimatePresence>

                {/* Body */}
                <AnimatePresence mode="wait" custom={dir * slideAxis}>
                  <motion.div
                    key={`body-${step}`}
                    custom={dir * slideAxis}
                    variants={slide}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={trans}
                  >
                    {step === 'use-type' && (
                      <>
                        <StepRole
                          role={role}
                          onSelect={(r) => {
                            setRole(r)
                            setInstitutionType(null)
                            setDir(1)
                            setStep('usage')
                          }}
                        />
                        {/* A side path, not a wizard step: creating a real
                            organization is untouched by it, and the card
                            renders nothing when the instance has no demo. */}
                        <DemoEntryCard className="mt-6" />
                      </>
                    )}
                    {step === 'usage' && role === 'student' && <StudentJoin />}
                    {step === 'usage' && role && role !== 'student' && (
                      <StepInstitution
                        role={role}
                        institutionType={institutionType}
                        onSelect={setInstitutionType}
                        publicEd={publicEd}
                        onPublicEd={setPublicEd}
                        accountEmail={session?.data?.user?.email ?? ''}
                      />
                    )}
                    {step === 'create-org' && (
                      <CreateOrgForm
                        submitting={submitting}
                        error={error}
                        onSubmit={handleCreate}
                        initialName={wantsPublicEd ? publicEd.institution.trim() : ''}
                        t={t}
                      />
                    )}
                    {step === 'success' && createdSlug && <CreateOrgSuccess slug={createdSlug} t={t} />}
                  </motion.div>
                </AnimatePresence>

                {/* Navigation */}
                {(showNav || (showBack && step === 'create-org')) && (
                  <div className={`flex items-center mt-6 ${showBack ? 'justify-between' : 'justify-end'}`}>
                    {showBack && (
                      <button
                        onClick={goBack}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
                      >
                        <ArrowLeft size={14} data-dir-flip />
                        {t('hub_new.navigation.back', { defaultValue: 'Back' })}
                      </button>
                    )}
                    {showNav && (
                      <motion.button
                        onClick={advance}
                        disabled={!canContinue}
                        whileTap={canContinue ? { scale: 0.97 } : {}}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                          canContinue
                            ? 'bg-gray-900 text-white hover:bg-gray-800 nice-shadow cursor-pointer'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {t('hub_new.navigation.continue', { defaultValue: 'Continue' })}
                        <ArrowRight size={15} data-dir-flip />
                      </motion.button>
                    )}
                  </div>
                )}

                {/* Skip */}
                {showSkip && (
                  <p className="text-center mt-3">
                    <button
                      onClick={skip}
                      className="text-xs text-gray-400 hover:text-gray-500 transition-colors hover:underline underline-offset-2 cursor-pointer"
                    >
                      {t('hub_new.navigation.skip', { defaultValue: 'Skip' })}
                    </button>
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
