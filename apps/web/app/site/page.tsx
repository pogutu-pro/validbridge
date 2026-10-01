import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import {
  ArrowRight,
  Buildings,
  CalendarCheck,
  CheckCircle,
  ChatsCircle,
  ClosedCaptioning,
  Certificate,
  Globe,
  Key,
  Lightning,
  PaintBrush,
  PlugsConnected,
  ShieldCheck,
  UserPlus,
  UsersThree,
  VideoCamera,
} from '@phosphor-icons/react/dist/ssr'
import { SITE_LINKS } from '@lib/site/content'
import PlanGrid from '@components/Site/PlanGrid'
import SiteFaq from '@components/Site/SiteFaq'
import Reveal from '@components/Site/Reveal'

// The apex is the one canonical address (www and other aliases point here).
export const metadata: Metadata = { alternates: { canonical: '/' } }

// Landing page. Copy, section order and assets follow the design handoff
// (ValidBridge Landing.dc.html); see app/site/site.css for the visual system.

function SectionHead({
  eyebrow,
  title,
  intro,
  center = false,
}: {
  eyebrow?: string
  title: string
  intro?: string
  center?: boolean
}) {
  return (
    <Reveal className={`mb-12 md:mb-16 ${center ? 's-narrow text-center' : 'max-w-[720px]'}`}>
      {eyebrow && <div className="s-eyebrow">{eyebrow}</div>}
      <h2>{title}</h2>
      {intro && <p className="s-lead !mt-5 mb-0">{intro}</p>}
    </Reveal>
  )
}

function Arrow() {
  return <ArrowRight size={16} weight="bold" className="s-arrow" aria-hidden />
}

function Hero() {
  return (
    <section className="s-hero-bg px-5 pb-20 pt-16 sm:px-8 md:pb-28 md:pt-24">
      <div className="s-narrow text-center">
        <div className="s-tag s-rise mb-7">
          <span className="s-pulse inline-block h-1.5 w-1.5 rounded-full bg-[var(--s-accent)]" aria-hidden />
          The complete teaching platform
        </div>
        <h1 className="s-rise" style={{ animationDelay: '80ms' }}>
          Every course, brought to life.
        </h1>
        <p className="s-lead s-rise mx-auto !mt-6 mb-0 max-w-[560px]" style={{ animationDelay: '160ms' }}>
          Courses, live classes and payments on your own branded site.
        </p>
        <div className="s-rise mt-10 flex flex-wrap justify-center gap-3" style={{ animationDelay: '240ms' }}>
          <a href={SITE_LINKS.signup} className="s-btn s-btn-lg s-btn-primary">
            Start free
          </a>
          <a href={SITE_LINKS.demo} className="s-btn s-btn-lg s-btn-outline">
            Book a demo
          </a>
        </div>
        <p className="s-subtle s-rise mb-0 mt-5 text-sm" style={{ animationDelay: '320ms' }}>
          Free plan · No card needed · 0% fee on course sales
        </p>
      </div>

      <div
        className="s-rise relative mx-auto mt-16 max-w-[1280px] md:mt-20"
        style={{ animationDelay: '300ms', animationDuration: '1s' }}
      >
        <div className="s-hero-frame relative">
          <video
            className="block aspect-video w-full object-cover"
            src="/hero.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-label="ValidBridge in action"
          />
        </div>
      </div>
    </section>
  )
}

function OnePlace() {
  const items = [
    ['01', 'Stop juggling tools', 'Zoom, Forms and spreadsheets, replaced by one login.'],
    ['02', 'Everything together', 'Courses, live classes, quizzes, attendance, payments.'],
    ['03', 'Your own brand', 'school.validbridge.co.ke, looks like yours.'],
  ]
  return (
    <section id="features" className="scroll-mt-16 border-t border-[var(--s-divider)] px-5 py-16 sm:px-8 md:py-20">
      <div className="s-container grid gap-10 md:grid-cols-3 md:gap-12">
        {items.map(([num, title, body], i) => (
          <Reveal key={title} delay={i * 0.08}>
            <div className="mb-3 text-sm font-semibold tabular-nums text-[var(--s-accent-600)]">{num}</div>
            <h3 className="!mb-2">{title}</h3>
            <p className="s-muted m-0">{body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

function LiveBridge() {
  const points: [React.ElementType, string, string][] = [
    [CalendarCheck, 'Schedule from any course', 'Invite by link, email or Google Calendar.'],
    [VideoCamera, 'Teach face to face', 'Camera, microphone and screen sharing, with control over what students see.'],
    [ChatsCircle, 'Keep everyone involved', "Chat, Q&A, polls and live quizzes built from your course's own content."],
    [UsersThree, 'Attendance done for you', 'Present, late, left early, partial or absent, recorded per student.'],
  ]
  return (
    <section id="livebridge" className="s-section s-surface scroll-mt-16">
      <div className="s-container grid !max-w-[1360px] items-center gap-12 lg:grid-cols-[520px_1fr] lg:gap-16">
        <Reveal>
          <div className="s-eyebrow">LiveBridge</div>
          <h2 className="!mb-6">Live classes, without leaving your course.</h2>
          <p className="s-lead m-0 mb-8">
            Teach live inside the same course your students already use. Nothing to install, and every class is
            recorded and added back to the course.
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            {points.map(([Icon, title, body]) => (
              <div key={title}>
                <Icon size={24} weight="duotone" className="mb-3 text-[var(--s-accent)]" aria-hidden />
                <h3 className="!mb-1 !text-base">{title}</h3>
                <p className="s-muted m-0 text-[15px]">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="s-hero-frame">
            <video
              className="block aspect-video w-full object-cover"
              src="/livebridge.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-label="A live class running in LiveBridge"
            />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Editor() {
  return (
    <section className="s-section">
      <div className="s-container grid !max-w-[1360px] items-center gap-12 lg:grid-cols-[520px_1fr] lg:gap-16">
        <Reveal>
          <div className="s-eyebrow">Course builder</div>
          <h2 className="!mb-6">Build a complete course in an afternoon.</h2>
          <p className="s-lead m-0 mb-8">
            Every kind of lesson lives in one menu. Add it, arrange it and publish when you are ready.
          </p>
          <div className="flex flex-col gap-6">
            {[
              ['Every lesson type in one place', 'Type / to add video, documents, quizzes, code exercises, maths, flip cards and H5P.'],
              ['Write together', 'Colleagues edit the same lesson at the same time, and every change is saved.'],
              ['AI that saves hours', 'Draft lessons, generate quizzes and caption videos in English and Swahili. You review before anything is published.'],
            ].map(([title, body]) => (
              <div key={title} className="flex items-start gap-3">
                <CheckCircle size={22} weight="fill" className="mt-0.5 shrink-0 text-[var(--s-accent)]" aria-hidden />
                <div>
                  <h3 className="!mb-1 !text-base">{title}</h3>
                  <p className="s-muted m-0 text-[15px]">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="s-hero-frame">
            <video
              className="block aspect-video w-full object-cover"
              src="/validbridge_screen_only_autograded_showcase.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-label="Building a course in the ValidBridge course builder"
            />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Assess() {
  return (
    <section className="s-section s-surface">
      <div className="s-container">
        <SectionHead eyebrow="Assessments" title="Assess and grade, automatically." />
        <Reveal className="s-bento sm:grid-cols-2 lg:grid-cols-4">
          <div className="s-tile sm:col-span-2">
            <h3 className="!mb-5">Code exercises, 30 languages</h3>
            <div className="flex flex-col gap-2 rounded-2xl bg-[var(--s-surface)] p-4 font-mono text-[13px]">
              {[
                ['test_addition', 'passed'],
                ['test_edge_case', 'passed'],
                ['test_overflow', 'pending'],
              ].map(([name, state]) => (
                <div key={name} className="flex items-center justify-between">
                  <span className={state === 'pending' ? 'text-[var(--s-subtle)]' : ''}>{name}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-sans text-xs font-semibold ${
                      state === 'passed'
                        ? 'bg-[var(--s-accent-100)] text-[var(--s-accent-700)]'
                        : 'bg-[var(--s-surface-2)] text-[var(--s-subtle)]'
                    }`}
                  >
                    {state === 'passed' ? 'Passed' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="s-tile flex flex-col gap-6 sm:col-span-2 sm:flex-row sm:items-center">
            <Image
              src="/site-screen-certificate.png"
              alt="A ValidBridge certificate with a QR code"
              width={1004}
              height={708}
              sizes="200px"
              className="w-full max-w-[200px] shrink-0 rounded-xl shadow-[var(--s-shadow-md)] ring-1 ring-[var(--s-divider)]"
            />
            <div>
              <h3 className="!mb-2">Certificates, QR verify</h3>
              <p className="s-muted m-0">Every certificate has a public verify page.</p>
            </div>
          </div>
          <div className="s-tile">
            <div className="mb-1 text-4xl font-bold tracking-[-0.03em] text-[var(--s-accent)]">6</div>
            <h3 className="!mb-2">Task types</h3>
            <p className="s-muted m-0 text-[15px]">Upload, quiz, short answer, number, code, form.</p>
          </div>
          <div className="s-tile">
            <div className="mb-1 text-4xl font-bold tracking-[-0.03em] text-[var(--s-accent)]">3</div>
            <h3 className="!mb-2">Grading scales</h3>
            <p className="s-muted m-0 text-[15px]">Pass/fail, points, rubric.</p>
          </div>
          <div className="s-tile sm:col-span-2">
            <Lightning size={28} weight="duotone" className="mb-4 text-[var(--s-accent)]" aria-hidden />
            <h3 className="!mb-2">Formative mode</h3>
            <p className="s-muted m-0 text-[15px]">Unlocks a model answer after an attempt.</p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Payments() {
  return (
    <section className="s-section">
      <div className="s-container grid items-center gap-16 lg:grid-cols-2">
        <Reveal>
          <div className="s-eyebrow">Payments</div>
          <h2 className="!mb-6">Sell with your own Paystack account.</h2>
          <p className="s-lead m-0 mb-8">Card, bank or M-Pesa. Money goes straight to you, at 0% platform fee.</p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {['One-time, subscriptions, pay-what-you-want, bundles', 'Prices in KES by default'].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <CheckCircle size={22} weight="fill" className="mt-px shrink-0 text-[var(--s-accent)]" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="s-hero-frame">
            <Image
              src="/payment.png"
              alt="A ValidBridge course checkout with M-Pesa, Airtel Money and card options"
              width={1024}
              height={577}
              sizes="(min-width: 1024px) 560px, 100vw"
              className="block aspect-[1024/577] w-full object-cover"
            />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Insights() {
  const stats = [
    ['1,248', 'Active learners'],
    ['92%', 'Attendance rate'],
    ['76%', 'Avg. completion'],
    ['14', 'Courses tracked'],
  ]
  return (
    <section className="s-section s-surface">
      <div className="s-container">
        <SectionHead
          eyebrow="Insights"
          title="See what's working."
          intro="Organization, course and per-learner analytics over 7, 30 or 90 days. Compare cohorts, spot who's falling behind, export anything."
        />
        <Reveal>
          {/* Sample figures from the dashboard mockup below, not customer data. */}
          <div className="s-bento mb-4 grid-cols-2 lg:grid-cols-4" aria-label="Example dashboard figures">
            {stats.map(([value, label]) => (
              <div key={label} className="s-tile !p-6 sm:!p-8">
                <div className="text-[34px] font-bold tabular-nums tracking-[-0.03em] sm:text-[44px]">{value}</div>
                <div className="s-muted mt-1 text-sm">{label}</div>
              </div>
            ))}
          </div>
          <div className="s-frame">
            <div className="s-chrome !justify-between">
              <span className="text-[13px] font-semibold text-[var(--s-muted)]">Course completion, last 30 days</span>
              <div className="hidden gap-1 rounded-full bg-[var(--s-surface-2)] p-0.5 text-[11px] font-semibold sm:flex" aria-hidden>
                <span className="rounded-full bg-white px-2.5 py-0.5 shadow-[var(--s-shadow-sm)]">30D</span>
                <span className="px-2.5 py-0.5 text-[var(--s-subtle)]">7D</span>
                <span className="px-2.5 py-0.5 text-[var(--s-subtle)]">90D</span>
              </div>
            </div>
            <div className="grid md:grid-cols-[1fr_220px]">
              <Image
                src="/site-screen-analytics.png"
                alt="The ValidBridge analytics dashboard"
                width={1807}
                height={965}
                sizes="(min-width: 1160px) 940px, 100vw"
                className="block h-full w-full object-cover"
              />
              <div className="flex flex-row flex-wrap gap-x-10 gap-y-5 border-t border-[var(--s-divider)] p-6 md:flex-col md:border-s md:border-t-0">
                {[
                  ['Top course', 'Intro to Algebra', false],
                  ['At risk', '6 learners', true],
                  ['Export', 'CSV, PDF', false],
                ].map(([k, v, hot]) => (
                  <div key={k as string}>
                    <div className="s-subtle text-xs">{k}</div>
                    <div className={`text-[15px] font-semibold ${hot ? 'text-[var(--s-accent-700)]' : ''}`}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Learners() {
  const items: { Icon: React.ElementType; title: string; body: string; wide?: boolean }[] = [
    { Icon: Lightning, title: 'Join instantly', body: 'Live classes run in the browser, no app to install.' },
    { Icon: VideoCamera, title: 'Never miss a class', body: 'Recordings land back in the course automatically.' },
    {
      Icon: ClosedCaptioning,
      title: 'Understand in your language',
      body: 'AI captions on every video, translated including Swahili.',
    },
    {
      Icon: CheckCircle,
      title: 'Know where you stand',
      body: "Code, quizzes and assignments graded instantly, with a model answer once you've tried.",
    },
    {
      Icon: Certificate,
      title: 'Leave with a certificate',
      body: 'A QR-verified certificate anyone can check is real.',
      wide: true,
    },
    {
      Icon: ChatsCircle,
      title: 'Ask questions live',
      body: 'Chat, Q&A and polls right inside the class, no separate app.',
      wide: true,
    },
  ]
  return (
    <section className="s-section">
      <div className="s-container">
        <SectionHead
          eyebrow="For learners"
          title="What learners get."
          intro="Nothing to install, nothing lost when class ends."
        />
        <Reveal className="s-bento sm:grid-cols-2 lg:grid-cols-4">
          {items.map(({ Icon, title, body, wide }) => (
            <div key={title} className={`s-tile ${wide ? 'lg:col-span-2' : ''}`}>
              <div className="mb-6 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--s-accent-100)]">
                <Icon size={22} weight="duotone" className="text-[var(--s-accent-600)]" aria-hidden />
              </div>
              <h3 className="!mb-2">{title}</h3>
              <p className="s-muted m-0 text-[15px]">{body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}

function Institutions() {
  const items: [React.ElementType, string, string][] = [
    [PaintBrush, 'Your brand', 'Logo, colours, font'],
    [Globe, 'Your subdomain', 'school.validbridge.co.ke'],
    [Key, 'Roles & permissions', 'Custom access'],
    [UserPlus, 'Invite-only signup', 'User groups'],
    [ShieldCheck, '2FA & audit logs', 'Security per account'],
    [PlugsConnected, 'API & webhooks', '41 signed events, Zapier'],
    [UsersThree, 'Communities', 'Boards and podcasts'],
    [Buildings, 'Custom domains', 'Available on request'],
  ]
  return (
    <section className="s-section border-t border-[var(--s-divider)]">
      <div className="s-container">
        <SectionHead eyebrow="For institutions" title="Built for institutions." />
        <Reveal className="grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([Icon, title, sub]) => (
            <div key={title} className="flex items-start gap-4">
              <Icon size={26} weight="duotone" className="shrink-0 text-[var(--s-accent)]" aria-hidden />
              <div>
                <div className="font-semibold">{title}</div>
                <div className="s-muted mt-0.5 text-[15px]">{sub}</div>
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}

function PricingOverview() {
  return (
    <section id="pricing" className="s-section s-surface scroll-mt-16">
      <div className="mx-auto max-w-[1320px]">
        <SectionHead
          center
          eyebrow="Pricing"
          title="Start free. Pay only for what you use."
          intro="Everything you need to teach is free on every plan, and free for verified public institutions. Paid plans add instructors, live classes and premium AI as you grow."
        />
        <Reveal>
          <PlanGrid billing="monthly" compact />
        </Reveal>
        <div className="mt-10 text-center">
          <Link href={SITE_LINKS.pricing} className="s-link">
            See usage prices, the cost calculator &amp; yearly pricing <Arrow />
          </Link>
        </div>
      </div>
    </section>
  )
}

function Faq() {
  return (
    <section id="faq" className="s-section scroll-mt-16">
      <div className="s-narrow">
        <SectionHead center title="Frequently asked." />
        <SiteFaq />
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section id="contact" className="scroll-mt-16 px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="rounded-[32px] bg-[var(--s-accent-100)] px-6 py-20 text-center ring-1 ring-[var(--s-accent-200)] md:py-28">
        <Reveal>
          <h2 className="s-narrow !mb-4">Start teaching on ValidBridge today.</h2>
          <p className="s-lead mx-auto !mb-10 max-w-[560px]">
            Set up your school in minutes. Free to start, no card needed.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={SITE_LINKS.signup} className="s-btn s-btn-lg s-btn-primary">
              Start free
            </a>
            <a href={SITE_LINKS.demo} className="s-btn s-btn-lg s-btn-outline !bg-white">
              Book a demo
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export default function LandingPage() {
  return (
    <>
      <Hero />
      <OnePlace />
      <LiveBridge />
      <Editor />
      <Assess />
      <Payments />
      <Insights />
      <Learners />
      <Institutions />
      <PricingOverview />
      <Faq />
      <FinalCta />
    </>
  )
}
