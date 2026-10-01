'use client'
import React, { useState } from 'react'
import { useAuth } from '@components/Contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { Shield } from 'lucide-react'

export default function AdminLoginPage() {
  const { signIn } = useAuth()
  const _router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

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

      if (result?.error) {
        setError('Invalid email or password')
      } else {
        window.location.href = '/admin'
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#F8F7F2]">
      <div className="w-full max-w-sm px-6">
        <div className="flex flex-col items-center mb-8">
          <Shield className="w-10 h-10 text-[#737373] mb-3" />
          <h1 className="text-2xl font-bold text-[#262626]">ValidBridge Admin</h1>
          <p className="text-[#737373]/70 text-sm mt-1">Sign in to continue</p>
        </div>

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
      </div>
    </div>
  )
}
