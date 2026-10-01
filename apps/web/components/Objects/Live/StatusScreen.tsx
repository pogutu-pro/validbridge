'use client'

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import LiveBridgeBrand from './LiveBridgeBrand'

type Tone = 'neutral' | 'warning' | 'danger' | 'success'

const TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700',
  warning: 'bg-amber-50 text-amber-600',
  danger: 'bg-red-50 text-red-600',
  success: 'bg-emerald-50 text-emerald-600',
}

/** Full-screen, branded state page (loading, errors, waiting, ended). */
export default function StatusScreen({
  icon,
  title,
  description,
  tone = 'neutral',
  loading = false,
  children,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  tone?: Tone
  loading?: boolean
  children?: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 flex flex-col bg-background"
      style={{ zIndex: 'var(--z-sticky)' }}
      role="status"
      aria-live="polite"
    >
      <header className="flex h-16 shrink-0 items-center px-4 sm:px-6">
        <LiveBridgeBrand />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center nice-shadow">
          <div className={`mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl ${TONES[tone]}`}>
            {loading ? <Loader2 className="size-6 animate-spin" aria-hidden /> : icon}
          </div>
          <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
          {description && <div className="mt-2 text-sm leading-relaxed text-neutral-500">{description}</div>}
          {children && <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">{children}</div>}
        </div>
      </main>
    </div>
  )
}
