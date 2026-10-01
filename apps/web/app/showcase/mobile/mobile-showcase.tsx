/*
 * ============================================================================
 *  PRESENTATION MOCKUP — Not a real feature
 * ============================================================================
 *  This client component renders a **static, hardcoded visual demo** of what
 *  the planned ValidBridge mobile app *will* look like. It exists solely so
 *  the team has something real to show in stakeholder meetings while the
 *  actual React Native app is still in planning.
 *
 *  All data is hardcoded. No API calls. No real auth. No live backend state.
 *  The "web ↔ mobile sync" interaction is purely local React state — clicking
 *  a lesson updates both panels instantly via shared state, but nothing is
 *  persisted or sent to a server.
 *
 *  If you find this component referenced in any production navigation,
 *  layout, or marketing flow, it has been mistakenly promoted and should
 *  be removed immediately.
 * ============================================================================
 */

'use client'

import { useMemo, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import {
  Smartphone, Wifi, Signal, BatteryFull, Home, Route, Award,
  CheckCircle2, ChevronLeft, ArrowRight, Play, FileText, HelpCircle,
  Dumbbell, ExternalLink, RefreshCw, BookOpen, ShieldCheck, Download,
  Share2,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — realistic sample drawn from the ValidBridge demo course bundle.
// This data has NO connection to any real org, user, or backend state.
// ─────────────────────────────────────────────────────────────────────────────

type Kind = 'video' | 'reading' | 'quiz' | 'practice'

type Lesson = {
  id: string
  title: string
  kind: Kind
  minutes: number
  done: boolean
}

type Course = {
  id: string
  name: string
  topic: string
  lessons: Lesson[]
  certified: boolean
}

const INITIAL_COURSES: Course[] = [
  {
    id: 'compliance',
    name: 'Compliance Essentials',
    topic: 'Workplace · 8 lessons',
    certified: true,
    lessons: [
      { id: 'c1', title: 'Introduction to Compliance', kind: 'video', minutes: 8, done: true },
      { id: 'c2', title: 'Anti-Bribery Basics', kind: 'video', minutes: 12, done: true },
      { id: 'c3', title: 'Data Protection Fundamentals', kind: 'reading', minutes: 10, done: true },
      { id: 'c4', title: 'GDPR Deep-Dive', kind: 'video', minutes: 15, done: true },
      { id: 'c5', title: 'Reporting Misconduct', kind: 'reading', minutes: 6, done: true },
      { id: 'c6', title: 'Audit Readiness', kind: 'reading', minutes: 9, done: false },
      { id: 'c7', title: 'Ethics in Practice', kind: 'quiz', minutes: 10, done: false },
      { id: 'c8', title: 'Final Compliance Exam', kind: 'practice', minutes: 20, done: false },
    ],
  },
  {
    id: 'support',
    name: 'Customer Support Fundamentals',
    topic: 'Service · 12 lessons',
    certified: true,
    lessons: [
      { id: 's1', title: 'First Impressions', kind: 'video', minutes: 5, done: true },
      { id: 's2', title: 'Active Listening', kind: 'video', minutes: 7, done: true },
      { id: 's3', title: 'Ticket Etiquette', kind: 'reading', minutes: 6, done: true },
      { id: 's4', title: 'De-escalation Techniques', kind: 'video', minutes: 9, done: true },
      { id: 's5', title: 'The Support Toolbox', kind: 'reading', minutes: 4, done: false },
      { id: 's6', title: 'Knowledge Base Writing', kind: 'reading', minutes: 8, done: false },
      { id: 's7', title: 'Multi-Channel Management', kind: 'video', minutes: 11, done: false },
      { id: 's8', title: 'Metrics That Matter', kind: 'reading', minutes: 5, done: false },
      { id: 's9', title: 'Peer Shadowing', kind: 'practice', minutes: 30, done: false },
      { id: 's10', title: 'Escalation Scenarios', kind: 'quiz', minutes: 15, done: false },
      { id: 's11', title: 'Role-Play Assessment', kind: 'practice', minutes: 20, done: false },
      { id: 's12', title: 'Final Support Exam', kind: 'practice', minutes: 25, done: false },
    ],
  },
  {
    id: 'data-lit',
    name: 'Data Literacy',
    topic: 'Analytics · 10 lessons',
    certified: true,
    lessons: [
      { id: 'd1', title: 'Why Data Matters', kind: 'video', minutes: 8, done: true },
      { id: 'd2', title: 'Reading Dashboards', kind: 'reading', minutes: 10, done: true },
      { id: 'd3', title: 'Excel Essentials', kind: 'reading', minutes: 12, done: true },
      { id: 'd4', title: 'Pivot Tables', kind: 'video', minutes: 15, done: true },
      { id: 'd5', title: 'SQL Foundations', kind: 'video', minutes: 20, done: true },
      { id: 'd6', title: 'Data Cleaning', kind: 'practice', minutes: 25, done: true },
      { id: 'd7', title: 'Statistical Thinking', kind: 'reading', minutes: 14, done: true },
      { id: 'd8', title: 'Visualisation Best Practices', kind: 'video', minutes: 10, done: true },
      { id: 'd9', title: 'Build a Dashboard', kind: 'practice', minutes: 30, done: false },
      { id: 'd10', title: 'Final Data Exam', kind: 'practice', minutes: 20, done: false },
    ],
  },
  {
    id: 'onboarding',
    name: 'Onboarding Essentials',
    topic: 'Getting Started · 6 lessons',
    certified: true,
    lessons: [
      { id: 'o1', title: 'Welcome to the Team', kind: 'video', minutes: 4, done: true },
      { id: 'o2', title: 'Company Values & Culture', kind: 'reading', minutes: 6, done: true },
      { id: 'o3', title: 'Tools of the Trade', kind: 'video', minutes: 8, done: true },
      { id: 'o4', title: 'Security & Compliance', kind: 'reading', minutes: 10, done: true },
      { id: 'o5', title: 'Your First Assignment', kind: 'practice', minutes: 20, done: true },
      { id: 'o6', title: 'Onboarding Quiz', kind: 'quiz', minutes: 10, done: true },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pct(course: Course, done: Record<string, boolean>) {
  const n = course.lessons.filter((l) => done[l.id]).length
  return course.lessons.length > 0 ? Math.round((n / course.lessons.length) * 100) : 0
}

function steps(course: Course, done: Record<string, boolean>) {
  return course.lessons.filter((l) => done[l.id]).length
}

const KIND_ICON: Record<Kind, typeof Play> = {
  video: Play,
  reading: FileText,
  quiz: HelpCircle,
  practice: Dumbbell,
}

const CERT_COURSE_ID = 'onboarding'
const CERT_NAME = 'Onboarding Excellence Award'
const CERT_DATE = 'Sep 11 2026'
const USER = 'Dana Akinyi · dana@validbridge.co.ke'
const ORG = 'ValidBridge Demo'

// ─────────────────────────────────────────────────────────────────────────────
// Tiny UI primitives used only inside this mockup
// ─────────────────────────────────────────────────────────────────────────────

function Ring({
  pct: value,
  size = 48,
  sw = 5,
  className,
}: {
  pct: number
  size?: number
  sw?: number
  className?: string
}) {
  const r = (size - sw) / 2
  const c = 2 * Math.PI * r
  const off = c - (value / 100) * c
  const done = value === 100

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="currentColor" strokeWidth={sw}
        className="text-gray-200"
      />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="currentColor" strokeWidth={sw}
        strokeDasharray={c} strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className={cn('transition-all duration-700 ease-out', done ? 'text-green-500' : 'text-teal-500')}
      />
      <text
        x={size / 2} y={size / 2}
        textAnchor="middle" dominantBaseline="central"
        className="fill-foreground text-[11px] font-bold"
      >
        {value}%
      </text>
    </svg>
  )
}

function SyncBadge({ active }: { active: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-all',
      active ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 bg-gray-50 text-gray-400',
    )}>
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', active ? 'bg-green-500 animate-pulse' : 'bg-gray-300')} />
      {active ? 'Live sync' : 'Mock data'}
    </span>
  )
}

function FlashBadge({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <span className="absolute top-2 end-2 z-10 inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm animate-pulse">
      <RefreshCw size={9} className="animate-spin" style={{ animationDuration: '1s' }} />
      Synced
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone chrome — status bar, tabs
// ─────────────────────────────────────────────────────────────────────────────

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-6 pt-3 pb-1 text-[11px] font-semibold text-zinc-800">
      <span>9:41</span>
      <div className="flex items-center gap-1.5">
        <Signal size={12} />
        <Wifi size={12} />
        <BatteryFull size={14} />
      </div>
    </div>
  )
}

function Tabs({ active, onTab }: { active: string; onTab: (_t: string) => void }) {
  const items = [
    { id: 'home', label: 'Home', Icon: Home },
    { id: 'courses', label: 'My Courses', Icon: Route },
    { id: 'certs', label: 'Certificates', Icon: Award },
  ]
  return (
    <div className="flex items-center justify-around border-t border-gray-200 bg-white px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
      {items.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onTab(id)}
          className={cn(
            'flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px] font-medium transition-colors',
            active === id ? 'text-primary' : 'text-gray-400',
          )}
        >
          <Icon size={18} strokeWidth={active === id ? 2.4 : 1.6} />
          {label}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone — Home tab (course list with progress rings)
// ─────────────────────────────────────────────────────────────────────────────

function PhoneHome({
  courses,
  done,
  onPick,
}: {
  courses: Course[]
  done: Record<string, boolean>
  onPick: (_id: string) => void
}) {
  const overall = useMemo(() => {
    const all = courses.flatMap((c) => c.lessons)
    const n = all.filter((l) => done[l.id]).length
    return all.length > 0 ? Math.round((n / all.length) * 100) : 0
  }, [courses, done])

  const inProg = courses.filter((c) => pct(c, done) < 100)
  const doneList = courses.filter((c) => pct(c, done) === 100)

  return (
    <div className="flex-1 overflow-y-auto bg-[#fbfbfb] px-4 pt-2 pb-2 space-y-3 scrollbar-hide">
      {/* Hero */}
      <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100 flex items-center gap-3">
        <Ring pct={overall} size={56} sw={5} />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Overall Progress</p>
          <p className="text-base font-bold text-gray-900 leading-tight">Keep it up — {overall}% complete</p>
          <p className="text-xs text-gray-500 mt-0.5">{courses.length} courses enrolled</p>
        </div>
      </div>

      {/* In-progress */}
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">In Progress</h3>
      {inProg.map((course) => {
        const v = pct(course, done)
        const n = steps(course, done)
        return (
          <button
            key={course.id}
            onClick={() => onPick(course.id)}
            className="w-full rounded-xl bg-white p-3 shadow-sm border border-gray-100 text-start transition-all hover:border-primary/40"
          >
            <div className="flex items-center gap-3">
              <Ring pct={v} size={44} sw={4} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900 leading-tight line-clamp-1">{course.name}</p>
                <p className="text-[11px] text-gray-500">{n}/{course.lessons.length} lessons</p>
              </div>
              <ArrowRight size={14} className="text-gray-300 shrink-0" />
            </div>
          </button>
        )
      })}

      {/* Completed */}
      {doneList.length > 0 && (
        <>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Completed</h3>
          {doneList.map((course) => (
            <div key={course.id} className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm border border-gray-100">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-50">
                <CheckCircle2 size={20} className="text-green-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900 leading-tight line-clamp-1">{course.name}</p>
                <p className="text-[11px] text-green-600 font-semibold">Completed · Certificate earned</p>
              </div>
              {course.certified && <Award size={16} className="text-yellow-500 shrink-0" />}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone — Course detail (lesson list with toggleable completion)
// ─────────────────────────────────────────────────────────────────────────────

function PhoneCourse({
  course,
  done,
  onToggle,
  onBack,
}: {
  course: Course
  done: Record<string, boolean>
  onToggle: (_id: string) => void
  onBack: () => void
}) {
  const v = pct(course, done)
  const n = steps(course, done)
  const allDone = v === 100

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#fbfbfb]">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-white px-3 py-2.5">
        <button onClick={onBack} className="rounded-lg p-1 hover:bg-gray-100 transition-colors">
          <ChevronLeft size={20} className="text-gray-600" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900 line-clamp-1">{course.name}</p>
          <p className="text-[11px] text-gray-500">{n}/{course.lessons.length} lessons · {v}%</p>
        </div>
      </div>

      {/* Progress card */}
      <div className="mx-3 mt-3 rounded-xl bg-white p-3 shadow-sm border border-gray-100">
        <div className="flex items-center gap-3">
          <Ring pct={v} size={52} sw={5} />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
              {allDone ? 'Course Complete' : 'Continue Learning'}
            </p>
            <p className="text-sm font-bold text-gray-900 leading-tight">
              {allDone ? 'Congratulations! Certificate earned.' : `${course.lessons.length - n} lessons remaining`}
            </p>
          </div>
        </div>
        <div className="mt-3 h-1.5 w-full rounded-full bg-gray-100">
          <div
            className={cn('h-full rounded-full transition-all duration-500', allDone ? 'bg-green-500' : 'bg-teal-500')}
            style={{ width: `${v}%` }}
          />
        </div>
      </div>

      {/* Lesson list */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-2 space-y-1.5 scrollbar-hide">
        {course.lessons.map((lesson, i) => {
          const isDone = done[lesson.id]
          const Icon = KIND_ICON[lesson.kind]
          return (
            <button
              key={lesson.id}
              onClick={() => onToggle(lesson.id)}
              className={cn(
                'w-full flex items-center gap-3 rounded-xl p-2.5 text-start transition-all border',
                isDone ? 'bg-green-50 border-green-200' : 'bg-white border-gray-100 hover:border-gray-200',
              )}
            >
              <span className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                isDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500',
              )}>
                {isDone ? <CheckCircle2 size={14} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-[13px] font-medium leading-tight line-clamp-1', isDone ? 'text-green-800' : 'text-gray-900')}>
                  {lesson.title}
                </p>
                <p className="text-[11px] text-gray-400">{lesson.minutes} min · {lesson.kind}</p>
              </div>
              <Icon size={14} className={cn('shrink-0', isDone ? 'text-green-400' : 'text-gray-300')} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone — Certificates tab
// ─────────────────────────────────────────────────────────────────────────────

function PhoneCerts({ unlocked }: { unlocked: boolean }) {
  if (!unlocked) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#fbfbfb] px-6 text-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
          <Award size={36} className="text-gray-300" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-base font-bold text-gray-700">No certificates yet</p>
          <p className="text-sm text-gray-400 mt-1">Complete all lessons in a course to earn your certificate.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#fbfbfb] px-4 pt-3 pb-3 space-y-3 scrollbar-hide">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">My Certificates</h3>
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <div className="relative aspect-video bg-gradient-to-br from-yellow-50 via-amber-100 to-orange-50 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center justify-center opacity-10">
            <ShieldCheck size={120} className="text-yellow-600" />
          </div>
          <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-md">
            <Award size={28} className="text-yellow-500" />
          </div>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-sm font-bold text-gray-900">{CERT_NAME}</p>
          <p className="text-xs text-gray-500">Onboarding Essentials</p>
          <p className="text-[11px] text-gray-400">Issued {CERT_DATE}</p>
          <div className="flex gap-2 pt-2">
            <button className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary/90 transition-colors">
              <Download size={13} /> Download PDF
            </button>
            <button className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
              <Share2 size={13} /> Share
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Web dashboard replica — mirrors the real trail page visual language
// ─────────────────────────────────────────────────────────────────────────────

function WebPanel({
  courses,
  done,
  syncCourse,
}: {
  courses: Course[]
  done: Record<string, boolean>
  syncCourse: string | null
}) {
  const inProg = courses.filter((c) => pct(c, done) < 100)
  const doneList = courses.filter((c) => pct(c, done) === 100)
  const totalLessons = courses.reduce((n, c) => n + c.lessons.length, 0)
  const totalDone = courses.reduce((n, c) => n + steps(c, done), 0)
  const certs = doneList.filter((c) => c.certified).length

  return (
    <div className="flex flex-col gap-5">
      {/* Org header bar */}
      <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm border border-gray-100">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-sm">V</div>
          <div>
            <p className="text-sm font-bold text-gray-900 leading-tight">{ORG}</p>
            <p className="text-[11px] text-gray-500">{USER}</p>
          </div>
        </div>
        <SyncBadge active={syncCourse !== null} />
      </div>

      {/* Stat cards — same pattern as the real trail page */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<BookOpen size={18} />} label="In progress" value={inProg.length} tone="blue" />
        <StatCard icon={<Route size={18} />} label="Steps done" value={`${totalDone}/${totalLessons}`} tone="green" />
        <StatCard icon={<Award size={18} />} label="Certificates" value={certs} tone="primary" />
      </div>

      {/* Trail cards — same pattern as real TrailCourseCard */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen size={16} />
          </span>
          <h3 className="text-sm font-bold text-gray-900">My Trail</h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {courses.map((course) => {
            const v = pct(course, done)
            const n = steps(course, done)
            const complete = v === 100
            return (
              <div key={course.id} className="group relative flex flex-col rounded-xl border border-gray-100 bg-white overflow-hidden">
                <div className="relative aspect-video bg-gray-50 flex items-center justify-center">
                  <BookOpen size={28} className="text-gray-200" strokeWidth={1.5} />
                  <div className="absolute bottom-0 inset-x-0 h-1.5 bg-gray-200/80">
                    <div
                      className={cn('h-full transition-all duration-500', complete ? 'bg-green-500' : 'bg-teal-500')}
                      style={{ width: `${v}%` }}
                    />
                  </div>
                  <FlashBadge show={syncCourse === course.id} />
                </div>
                <div className="p-2.5 flex flex-col gap-1">
                  <p className="text-[13px] font-bold text-gray-900 leading-tight line-clamp-1">{course.name}</p>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className={cn('font-semibold', complete ? 'text-green-600' : 'text-teal-600')}>{v}%</span>
                    <span className="text-gray-400">{n} of {course.lessons.length}</span>
                  </div>
                </div>
                <div className="border-t border-gray-100 px-2.5 py-2 flex items-center justify-between">
                  {complete ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-600">
                      <Award size={10} /> Complete
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                      <BookOpen size={10} /> In Progress
                    </span>
                  )}
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    {complete ? 'Verify' : 'Continue'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Certificate section — same pattern as real UserCertificates */}
      {doneList.filter((c) => c.certified).length > 0 && (
        <div className="rounded-xl bg-white shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-50 text-yellow-500">
              <Award size={16} />
            </span>
            <h3 className="text-sm font-bold text-gray-900">My Certificates</h3>
            <span className="bg-yellow-100 text-yellow-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
              {doneList.filter((c) => c.certified).length}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {doneList.filter((c) => c.certified).map((course) => (
              <div key={course.id} className="flex flex-col rounded-xl border border-gray-100 bg-white overflow-hidden">
                <div className="relative aspect-video bg-gradient-to-br from-yellow-50 to-amber-100 flex items-center justify-center">
                  <div className="p-3 bg-white/90 backdrop-blur-sm rounded-full shadow-sm">
                    <Award size={22} className="text-yellow-500" />
                  </div>
                  <FlashBadge show={syncCourse === course.id} />
                </div>
                <div className="p-2.5 flex flex-col gap-1">
                  <p className="text-[13px] font-bold text-gray-900 leading-tight line-clamp-1">{CERT_NAME}</p>
                  <p className="text-[11px] text-gray-500">{course.name}</p>
                </div>
                <div className="border-t border-gray-100 px-2.5 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{CERT_DATE}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                    Verify <ExternalLink size={9} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main showcase — orchestrates shared state between web panel & phone frame
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileShowcase() {
  // Shared completion state: the single source of truth that both panels read.
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}
    INITIAL_COURSES.forEach((c) => c.lessons.forEach((l) => { m[l.id] = l.done }))
    return m
  })

  const [phoneTab, setPhoneTab] = useState('home')
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null)
  const [syncFlash, setSyncFlash] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'split' | 'phone'>('split')

  const activeCourse = useMemo(
    () => INITIAL_COURSES.find((c) => c.id === activeCourseId) ?? null,
    [activeCourseId],
  )

  const toggleLesson = useCallback((lessonId: string) => {
    setDone((prev) => ({ ...prev, [lessonId]: !prev[lessonId] }))

    const course = INITIAL_COURSES.find((c) => c.lessons.some((l) => l.id === lessonId))
    if (course) {
      setSyncFlash(course.id)
      setTimeout(() => setSyncFlash(null), 1800)
      setToastMsg('Progress synced — Web \u2194 Mobile')
      setTimeout(() => setToastMsg(null), 2400)
    }
  }, [])

  const pickCourse = useCallback((id: string) => {
    setActiveCourseId(id)
    setPhoneTab('courses')
  }, [])

  const goHome = useCallback(() => {
    setActiveCourseId(null)
    setPhoneTab('home')
  }, [])

  const certUnlocked = useMemo(() => {
    const c = INITIAL_COURSES.find((cs) => cs.id === CERT_COURSE_ID)
    return c ? pct(c, done) === 100 : false
  }, [done])

  return (
    <div className="min-h-screen bg-background">
      {/* ── Sync toast ───────────────────────────────────────────────── */}
      {toastMsg && (
        <div className="fixed top-6 left-1/2 z-[9999] -translate-x-1/2 animate-fade-in">
          <div className="flex items-center gap-2 rounded-full border border-green-200 bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-green-600/20">
            <RefreshCw size={14} className="animate-spin" style={{ animationDuration: '1.2s' }} />
            {toastMsg}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-5">
        {/* Page header */}
        <PageHeader
          icon={<Smartphone />}
          title="ValidBridge Mobile — UX Preview"
          description="Static, hardcoded visuals of the planned mobile experience. Click any lesson to toggle completion — both panels react instantly."
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Presentation mockup</Badge>
              <Badge variant="secondary">No real data · No API calls</Badge>
            </div>
          }
        />

        {/* Banner */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 leading-relaxed">
          <strong className="font-bold">Presentation mockup</strong> — this page is a static UI demo for internal meetings.
          It is not linked from any production navigation, makes no API calls, uses no React Native code, and renders only
          hardcoded sample data. No certificates, progress, or user data shown here is real.
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground me-1">View:</span>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
            {(['split', 'phone'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                  viewMode === mode ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                {mode === 'split' ? 'Side by Side' : 'Phone Only'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Main grid ──────────────────────────────────────────────────── */}
        <div className={cn(
          'grid gap-6 items-start',
          viewMode === 'split'
            ? 'lg:grid-cols-[1fr_minmax(320px,380px)]'
            : 'grid-cols-1 max-w-[400px] mx-auto',
        )}>
          {/* Web panel */}
          {viewMode === 'split' && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wider',
                  syncFlash ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700',
                )}>
                  <RefreshCw size={10} className={syncFlash ? 'animate-spin text-green-600' : 'text-blue-400'} style={syncFlash ? { animationDuration: '1s' } : undefined} />
                  Web Dashboard
                </span>
                {syncFlash && (
                  <span className="animate-pulse text-[10px] font-semibold text-green-600">Last sync: just now</span>
                )}
              </div>
              <WebPanel courses={INITIAL_COURSES} done={done} syncCourse={syncFlash} />
            </div>
          )}

          {/* Phone */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary uppercase tracking-wider">
                <Smartphone size={10} />
                Mobile App
              </span>
              {syncFlash && (
                <span className="animate-pulse text-[10px] font-semibold text-green-600">Last sync: just now</span>
              )}
            </div>

            <div className="mx-auto max-w-[340px]">
              {/* Device frame */}
              <div className="relative rounded-[44px] border-[6px] border-zinc-900 bg-black p-1 shadow-2xl shadow-zinc-900/20">
                {/* Dynamic Island / notch */}
                <div className="absolute top-1.5 left-1/2 -translate-x-1/2 z-20 h-6 w-24 rounded-full bg-zinc-900" />

                {/* Screen */}
                <div className="relative flex flex-col rounded-[34px] bg-[#fbfbfb] overflow-hidden" style={{ height: 640 }}>
                  <StatusBar />

                  {phoneTab === 'home' && (
                    <PhoneHome courses={INITIAL_COURSES} done={done} onPick={pickCourse} />
                  )}
                  {phoneTab === 'courses' && activeCourse && (
                    <PhoneCourse course={activeCourse} done={done} onToggle={toggleLesson} onBack={goHome} />
                  )}
                  {phoneTab === 'certs' && (
                    <PhoneCerts unlocked={certUnlocked} />
                  )}

                  <Tabs active={phoneTab} onTab={setPhoneTab} />
                </div>
              </div>
              <div className="mt-2 flex justify-center">
                <div className="h-1 w-28 rounded-full bg-zinc-300" />
              </div>
            </div>
          </div>
        </div>

        {/* Footer disclaimer */}
        <p className="text-xs text-muted-foreground text-center pt-6 border-t border-gray-100 mt-4">
          This page contains no React Native code, no Expo modules, no native build configuration, and no live API calls.
          It is a pure Next.js / Tailwind / React static UI mockup intended for internal stakeholder presentations only.
        </p>
      </div>
    </div>
  )
}
