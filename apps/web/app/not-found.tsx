import { ArrowRight, Compass, Home } from 'lucide-react'
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-white px-6">
      {/* Blueprint grid backdrop, matching the ValidBridge app aesthetic */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px),
            linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px)
          `,
          backgroundSize: '80px 80px, 80px 80px, 16px 16px, 16px 16px',
          maskImage: 'radial-gradient(ellipse at center, black 0%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 0%, transparent 75%)',
        }}
      />

      {/* Soft brand glow */}
      <div className="pointer-events-none absolute left-1/2 top-0 z-0 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl" />

      <div className="relative z-10 flex flex-col items-center text-center">
        {/* Brand */}
        <div className="flex flex-col items-center gap-4">
          <img src="/validbridge.svg" alt="ValidBridge" width={52} height={52} className="opacity-95" />
          <img src="/validbridge-text.svg" alt="ValidBridge" width={168} height={24} className="opacity-95" />
        </div>

        {/* 404 */}
        <div className="mt-10 flex items-end justify-center">
          <span className="text-8xl md:text-9xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-gray-900 via-gray-800 to-primary">
            404
          </span>
        </div>

        <h1 className="mt-6 text-2xl md:text-3xl font-black tracking-tight text-gray-900">
          This page wandered off the bridge
        </h1>
        <p className="mt-3 max-w-md text-sm md:text-base text-black/50 leading-relaxed">
          We&apos;re sorry for the inconvenience. The page you&apos;re looking for has been
          moved, deleted, or never existed in the first place.
        </p>

        {/* Actions */}
        <div className="mt-9 flex flex-col sm:flex-row items-center gap-3">
          <Link
            href="/"
            className="group flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-sm font-bold text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 hover:shadow-primary/40"
          >
            <Home size={16} />
            Go back to homepage
            <ArrowRight size={16} className="transition-transform duration-150 group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="https://www.validbridge.co.ke"
            className="flex h-12 items-center gap-2 rounded-full border border-black/10 bg-white px-7 text-sm font-semibold text-gray-700 transition-colors hover:bg-black/[0.03]"
          >
            <Compass size={16} />
            Visit validbridge.co.ke
          </Link>
        </div>
      </div>
    </div>
  )
}
