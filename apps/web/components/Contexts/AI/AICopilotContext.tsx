'use client'

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type AICopilotActivityContext = {
  activity_uuid: string
  name?: string
  activity_type?: string
} | null

/**
 * Which brain answers the next message.
 *
 * - `activity`  : course-tutor bound to one activity (learner, unchanged)
 * - `course`    : course RAG tutor            (learner, unchanged -- the default)
 * - `assistant` : context-aware product copilot (managerial dashboard only)
 *
 * The activity context always wins, so a learner inside a lesson can never be
 * routed to the assistant. `assistant` is only reachable where the mounting
 * layout sets `assistantAvailable` (the /dash managerial dashboard), because
 * students already navigate their course UI without it.
 */
export type CopilotMode = 'activity' | 'course' | 'assistant'

/**
 * Where the user currently is, so the assistant can be page-aware.
 *
 * Untrusted on purpose: the backend treats this as a prompt hint only and
 * re-derives organization and role from the auth token. See AIguide.md rule S4.
 */
export type CopilotPageContext = {
  pathname: string
  title?: string
  description?: string
  aiSummary?: string
} | null

type AICopilotContextValue = {
  isOpen: boolean
  activityContext: AICopilotActivityContext
  pageContext: CopilotPageContext
  pageHints: string[]
  mode: CopilotMode
  effectiveMode: CopilotMode
  assistantAvailable: boolean
  pendingPrompt: string | null
  openCopilot: (prompt?: string) => void
  closeCopilot: () => void
  toggleCopilot: () => void
  setActivityContext: (ctx: AICopilotActivityContext) => void
  setPageContext: (ctx: CopilotPageContext) => void
  setPageHints: (hints: string[]) => void
  setMode: (mode: CopilotMode) => void
  clearPendingPrompt: () => void
}

const AICopilotContext = createContext<AICopilotContextValue | null>(null)

export function AICopilotProvider({
  children,
  assistantAvailable = false,
  defaultMode = 'course',
}: {
  children: React.ReactNode
  /**
   * Makes the drawer Genie (the free navigation/help assistant) only. Set by
   * the managerial /dash dashboard, which has no course tutor. The
   * student-facing course UI leaves it false and gets the course tutor only.
   */
  assistantAvailable?: boolean
  defaultMode?: CopilotMode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [activityContext, setActivityContext] = useState<AICopilotActivityContext>(null)
  const [pageContext, setPageContext] = useState<CopilotPageContext>(null)
  const [pageHints, setPageHints] = useState<string[]>([])
  const [mode, setModeState] = useState<CopilotMode>(defaultMode)
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

  // Dashboard: Genie only. Student side: the course tutor, pinned to the open
  // lesson when there is one; students never get Genie.
  const effectiveMode: CopilotMode = assistantAvailable
    ? 'assistant'
    : activityContext?.activity_uuid
      ? 'activity'
      : 'course'

  const setMode = useCallback(
    (next: CopilotMode) => {
      if (next === 'assistant' && !assistantAvailable) return
      setModeState(next)
    },
    [assistantAvailable]
  )

  const value = useMemo<AICopilotContextValue>(
    () => ({
      isOpen,
      activityContext,
      pageContext,
      pageHints,
      mode,
      effectiveMode,
      assistantAvailable,
      pendingPrompt,
      openCopilot,
      closeCopilot,
      toggleCopilot,
      setActivityContext,
      setPageContext,
      setPageHints,
      setMode,
      clearPendingPrompt,
    }),
    [
      isOpen,
      activityContext,
      pageContext,
      pageHints,
      mode,
      effectiveMode,
      assistantAvailable,
      pendingPrompt,
      openCopilot,
      closeCopilot,
      toggleCopilot,
      setMode,
      clearPendingPrompt,
    ]
  )

  return <AICopilotContext.Provider value={value}>{children}</AICopilotContext.Provider>
}

export function useAICopilot() {
  const ctx = useContext(AICopilotContext)
  if (!ctx) {
    throw new Error('useAICopilot must be used within an AICopilotProvider')
  }
  return ctx
}

export default AICopilotProvider
