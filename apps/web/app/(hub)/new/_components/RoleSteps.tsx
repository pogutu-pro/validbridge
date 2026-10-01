'use client'
// Role-based onboarding steps for /new: who you are, where you teach, the
// Public Education verification form, and the learner "join your school" path.
import React, { useState } from 'react'
import { Building2, GraduationCap, Presentation, Briefcase, BookOpenCheck, Upload, Info } from 'lucide-react'
import {
  INSTITUTION_OPTIONS,
  isOfficialEmail,
  schoolAddressToUrl,
  type InstitutionType,
  type OnboardingRole,
  type PublicEdForm,
} from './onboarding'

const card =
  'w-full text-start rounded-2xl bg-white p-4 nice-shadow transition-all hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]'
const selectedCls = 'ring-2 ring-[#FF5A1F] bg-[#FFF3EC]'
const inputCls =
  'w-full bg-white nice-shadow text-[14px] text-black/80 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/30 placeholder:text-black/25'

const ROLES: { id: OnboardingRole; label: string; hint: string; Icon: React.ElementType }[] = [
  { id: 'admin', label: 'School or college administrator', hint: 'Set up ValidBridge for your institution', Icon: Building2 },
  { id: 'teacher', label: 'Teacher or lecturer', hint: 'Teach your classes and run live lessons', Icon: Presentation },
  { id: 'creator', label: 'Trainer or course creator', hint: 'Build and sell your own courses', Icon: BookOpenCheck },
  { id: 'company', label: 'Company training', hint: 'Train and onboard your team', Icon: Briefcase },
  { id: 'student', label: 'Student or learner', hint: 'Join your school or a course', Icon: GraduationCap },
]

export function StepRole({ role, onSelect }: { role: OnboardingRole | null; onSelect: (_r: OnboardingRole) => void }) {
  return (
    <div role="radiogroup" aria-label="What best describes you?" className="grid gap-3">
      {ROLES.map(({ id, label, hint, Icon }) => {
        const active = role === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(id)}
            className={`${card} flex items-center gap-4 ${active ? selectedCls : ''}`}
          >
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                active ? 'bg-[#FF5A1F] text-white' : 'bg-[#FFF3EC] text-[#DE4710]'
              }`}
            >
              <Icon size={20} />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-gray-900">{label}</span>
              <span className="block text-sm text-gray-500">{hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function StepInstitution({
  role,
  institutionType,
  onSelect,
  publicEd,
  onPublicEd,
  accountEmail,
}: {
  role: Exclude<OnboardingRole, 'student'>
  institutionType: InstitutionType | null
  onSelect: (_t: InstitutionType) => void
  publicEd: PublicEdForm
  onPublicEd: (_f: PublicEdForm) => void
  accountEmail: string
}) {
  const options = INSTITUTION_OPTIONS[role]
  const showPublicEd = institutionType === 'public_school' || institutionType === 'university' || institutionType === 'tvet_college'
  const email = publicEd.email || accountEmail
  const set = (patch: Partial<PublicEdForm>) => onPublicEd({ ...publicEd, ...patch })

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Where do you teach?" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {options.map((o) => {
          const active = institutionType === o.id
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(o.id)}
              className={`${card} !p-3.5 text-[14px] font-semibold text-gray-800 ${active ? selectedCls : ''}`}
            >
              {o.label}
            </button>
          )
        })}
      </div>

      {showPublicEd && (
        <div className="rounded-2xl bg-white p-5 nice-shadow">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={publicEd.apply}
              onChange={(e) => set({ apply: e.target.checked })}
              className="mt-1 h-4 w-4 accent-[#FF5A1F]"
            />
            <span>
              <span className="block text-[15px] font-semibold text-gray-900">Apply for free Public Education access</span>
              <span className="block text-sm text-gray-500">
                Free for verified public institutions. You can start right away while we check your details.
              </span>
            </span>
          </label>

          {publicEd.apply && (
            <div className="mt-5 space-y-3">
              <input
                className={inputCls}
                placeholder="Institution name, e.g. Kisumu Girls High School"
                value={publicEd.institution}
                onChange={(e) => set({ institution: e.target.value })}
                aria-label="Institution name"
              />
              <input
                className={inputCls}
                placeholder="Registration number, or TSC, KUCCPS or TVETA number"
                value={publicEd.regNumber}
                onChange={(e) => set({ regNumber: e.target.value })}
                aria-label="Registration number"
              />
              <div>
                <input
                  className={inputCls}
                  type="email"
                  placeholder="Official email, e.g. principal@school.sc.ke"
                  value={email}
                  onChange={(e) => set({ email: e.target.value })}
                  aria-label="Official email"
                />
                {email && !isOfficialEmail(email) && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#B23907]">
                    <Info size={12} /> An official address (.ac.ke, .sc.ke, .go.ke, .ed.ke) speeds up approval.
                  </p>
                )}
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-black/15 px-4 py-3 text-sm text-gray-600 hover:bg-black/[0.02]">
                <Upload size={15} />
                <span className="truncate">{publicEd.document ? publicEd.document.name : 'Registration document (optional, PDF or image, 5 MB max)'}</span>
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="sr-only"
                  onChange={(e) => set({ document: e.target.files?.[0] ?? null })}
                />
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={publicEd.agree}
                  onChange={(e) => set({ agree: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-[#FF5A1F]"
                />
                <span>
                  ValidBridge may show our logo on its website and ask for a short testimonial. The Powered by
                  ValidBridge badge stays on our site.
                </span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function StudentJoin() {
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const go = () => {
    const url = schoolAddressToUrl(address, window.location.hostname, window.location.protocol)
    if (!url) {
      setError('Paste your invite link or your school address, e.g. myschool.validbridge.co.ke')
      return
    }
    window.location.href = url
  }
  return (
    <div className="rounded-2xl bg-white p-6 nice-shadow">
      <p className="mb-4 text-sm leading-relaxed text-gray-600">
        Students join through their school. Paste the invite link your teacher sent, or type your school&apos;s address.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={inputCls}
          placeholder="myschool.validbridge.co.ke or invite link"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value)
            setError('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          aria-label="Invite link or school address"
        />
        <button
          type="button"
          onClick={go}
          className="shrink-0 rounded-xl bg-[#FF5A1F] px-5 py-3 text-sm font-semibold text-white hover:bg-[#DE4710]"
        >
          Go to my school
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[#B23907]">{error}</p>}
      <p className="mt-4 text-xs text-gray-400">
        No link yet? Ask your teacher or school administrator to invite you.
      </p>
    </div>
  )
}
