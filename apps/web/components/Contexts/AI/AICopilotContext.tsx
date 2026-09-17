'use client'

import React, { createContext, useCallback, useContext, useState } from 'react'

export type AICopilotActivityContext = {
  activity_uuid: string
  name?: string
  activity_type?: string
} | null

type AICopilotContextValue = {
  isOpen: boolean
  activityContext: AICopilotActivityContext
  pendingPrompt: string | null
  openCopilot: (prompt?: string) => void
  closeCopilot: () => void
  toggleCopilot: () => void
  setActivityContext: (ctx: AICopilotActivityContext) => void
  clearPendingPrompt: () => void
}

const AICopilotContext = createContext<AICopilotContextValue | null>(null)

export function AICopilotProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activityContext, setActivityContext] = useState<AICopilotActivityContext>(null)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)

  const openCopilot = useCallback((prompt?: string) => {
    if (prompt) setPendingPrompt(prompt)
    setIsOpen(true)
  }, [])

  const closeCopilot = useCallback(() => {
    setIsOpen(false)
    setPendingPrompt(null)
  }, [])

  const toggleCopilot = useCallback(() => {
    setIsOpen((prev) => {
      if (prev) setPendingPrompt(null)
      return !prev
    })
  }, [])

  const clearPendingPrompt = useCallback(() => {
    setPendingPrompt(null)
  }, [])

  return (
    <AICopilotContext.Provider
      value={{
        isOpen,
        activityContext,
        pendingPrompt,
        openCopilot,
        closeCopilot,
        toggleCopilot,
        setActivityContext,
        clearPendingPrompt,
      }}
    >
      {children}
    </AICopilotContext.Provider>
  )
}

export function useAICopilot() {
  const ctx = useContext(AICopilotContext)
  if (!ctx) {
    throw new Error('useAICopilot must be used within an AICopilotProvider')
  }
  return ctx
}

export default AICopilotProvider
