'use client'
import { SessionProvider } from '@components/Contexts/AuthContext'
import VBSessionProvider, { SessionGate } from '@components/Contexts/VBSessionContext'
import React from 'react'

export default function AdminProviders({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SessionProvider>
      <VBSessionProvider>
        <SessionGate>
          {children}
        </SessionGate>
      </VBSessionProvider>
    </SessionProvider>
  )
}
