'use client'
import React, { useEffect, useState } from 'react'
import { useAuth } from '@components/Contexts/AuthContext'
import { Shield, Info } from 'lucide-react'

export default function AdminLoginPage() {
  const { signIn, completeMfaLogin } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Second-factor challenge. When mfaToken is set the credentials form is
  // replaced in place by the code step, mirroring app/auth/login/login.tsx.
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [mfaError, setMfaError] = useState('')
  const [mfaSubmitting, setMfaSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      // Password accepted but the account has a second factor — no session yet.
      // This result carries error === null, so it must be checked before the
      // success branch or an unauthenticated user gets bounced to /admin and
      // right back here (the redirect loop this page previously caused).
      if (result?.mfa_required && result?.mfa_token) {
        setMfaToken(result.mfa_token)
        setMfaCode('')
        setMfaError('')
        setIsLoading(false)
        return
      }

      if (result?.error) {
        setError('Invalid email or password')
        setIsLoading(false)
        return
      }

      window.location.href = '/admin'
    } catch {
      setError('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  async function handleMfaSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!mfaToken || mfaSubmitting) return

    const code = mfaCode.trim()
    if (!code) return

    setMfaSubmitting(true)
    setMfaError('')

    const res = await completeMfaLogin(mfaToken, code, {
      isBackupCode: useBackupCode,
      redirect: false,
    })

    if (res.ok) {
      window.location.href = '/admin'
      return
    }

    let message = "That code isn't right. Check your device's clock is set automatically, then try the next code."
    let errorCode: string | null = null
    try {
      const parsed = JSON.parse(res.error || '{}')
      errorCode = parsed.code ?? null
      if (parsed.message) message = parsed.message
    } catch {
      // keep the default message
    }

    if (errorCode === 'MFA_SESSION_EXPIRED') {
      // The pending token died — returning to the password step is the only way
      // forward, otherwise retries hit a token that can never be accepted.
      setMfaToken(null)
      setMfaCode('')
      setUseBackupCode(false)
      setError(message)
    } else {
      setMfaError(message)
      setMfaCode('')
    }

    setMfaSubmitting(false)
  }

  // Auto-submit once six digits are in. Backup codes are excluded: they are
  // variable-shaped and pasted.
  useEffect(() => {
    if (mfaToken && !useBackupCode && !mfaSubmitting && mfaCode.length === 6) {
      handleMfaSubmit() // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [mfaCode, useBackupCode, mfaSubmitting, mfaToken])

  function backToLogin() {
    setMfaToken(null)
    setMfaCode('')
    setMfaError('')
    setUseBackupCode(false)
    setError('')
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#F8F7F2]">
      <div className="w-full max-w-sm px-6">
        <div className="flex flex-col items-center mb-6">
          <Shield className="w-10 h-10 text-[#737373] mb-3" />
          <h1 className="text-2xl font-bold text-[#262626]">
            {mfaToken ? 'Two-step verification' : 'ValidBridge Admin'}
          </h1>
          <p className="text-[#737373]/70 text-sm mt-1">
            {mfaToken
              ? useBackupCode
                ? 'Enter one of the backup codes you saved.'
                : 'Enter the 6-digit code from your authenticator app.'
              : 'Sign in to continue'}
          </p>
        </div>

        {mfaToken ? (
          <form onSubmit={handleMfaSubmit} className="space-y-4">
            {mfaError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">
                {mfaError}
              </div>
            )}

            <div>
              <label htmlFor="mfaCode" className="block text-sm font-medium text-[#737373]/80 mb-1.5">
                {useBackupCode ? 'Backup code' : 'Verification code'}
              </label>
              <input
                id="mfaCode"
                type="text"
                value={mfaCode}
                onChange={(e) => {
                  setMfaCode(
                    useBackupCode
                      ? e.target.value.toUpperCase()
                      : e.target.value.replace(/\D/g, '').slice(0, 6)
                  )
                  if (mfaError) setMfaError('')
                }}
                autoFocus
                autoComplete="one-time-code"
                inputMode={useBackupCode ? 'text' : 'numeric'}
                placeholder={useBackupCode ? 'XXXXX-XXXXX' : '000000'}
                disabled={mfaSubmitting}
                className={`w-full px-3 py-2.5 bg-white border border-[#E7E5E4] rounded-lg text-[#262626] placeholder-[#737373]/60 focus:outline-none focus:border-[#FF5A1F] transition-colors disabled:opacity-50 ${
                  useBackupCode ? 'text-base' : 'text-lg tracking-[0.3em] font-semibold'
                }`}
              />
              {mfaError && (
                <p className="mt-2 text-xs text-red-500 flex items-start gap-1.5">
                  <Info size={12} className="shrink-0 mt-0.5" />
                  <span>{mfaError}</span>
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={mfaSubmitting || !mfaCode.trim()}
              className="w-full py-2.5 bg-white text-black font-medium rounded-lg hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mfaSubmitting ? 'Verifying...' : 'Verify'}
            </button>

            <div className="space-y-1 text-center">
              <button
                type="button"
                onClick={() => {
                  setUseBackupCode(!useBackupCode)
                  setMfaCode('')
                  setMfaError('')
                }}
                disabled={mfaSubmitting}
                className="text-sm text-[#262626] font-medium hover:underline disabled:opacity-50"
              >
                {useBackupCode ? 'Use your authenticator app instead' : 'Use a backup code instead'}
              </button>
              <br />
              <button
                type="button"
                onClick={backToLogin}
                disabled={mfaSubmitting}
                className="text-sm text-[#737373]/60 hover:text-[#737373] disabled:opacity-50"
              >
                Back to sign in
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[#737373]/80 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full px-3 py-2.5 bg-white border border-[#E7E5E4] rounded-lg text-[#262626] placeholder-[#737373]/60 focus:outline-none focus:border-[#FF5A1F] transition-colors"
                placeholder="admin@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[#737373]/80 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-white border border-[#E7E5E4] rounded-lg text-[#262626] placeholder-[#737373]/60 focus:outline-none focus:border-[#FF5A1F] transition-colors"
                placeholder="Enter your password"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-white text-black font-medium rounded-lg hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}