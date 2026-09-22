'use client'

import React, { createContext, useCallback, useContext, useState } from 'react'
import type { ChatMessage } from '@/app/orgs/[orgslug]/(withmenu)/copilot/copilot'

export type AICopilotActivityContext = {
  activity_uuid: string
  name?: string
  activity_type?: string
} | null

/**
 * The conversation a chat lives on. Activity chats are tied to a course
 * activity (activity session endpoints); course chats are the org-wide RAG
 * chat shared by the sidebar and the full-screen page.
 */
export type CopilotConversationMode = 'activity' | 'course'

type AICopilotContextValue = {
  isOpen: boolean
  activityContext: AICopilotActivityContext
  pendingPrompt: string | null
  openCopilot: (prompt?: string) => void
  closeCopilot: () => void
  toggleCopilot: () => void
  setActivityContext: (ctx: AICopilotActivityContext) => void
  clearPendingPrompt: () => void
  // Shared conversation state — lives in the provider so the sidebar drawer
  // and the full-screen AI page render the same transcript. Streaming the
  // chat in one and switching to the other continues where you left off.
  messages: ChatMessage[]
  aichatUuid: string | null
  followUps: string[]
  isStreaming: boolean
  isWaiting: boolean
  isLoadingFollowUps: boolean
  error: string | null
  conversationMode: CopilotConversationMode
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  setAichatUuid: React.Dispatch<React.SetStateAction<string | null>>
  setFollowUps: React.Dispatch<React.SetStateAction<string[]>>
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>
  setIsWaiting: React.Dispatch<React.SetStateAction<boolean>>
  setIsLoadingFollowUps: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setConversationMode: (mode: CopilotConversationMode) => void
  resetConversation: () => void
}

const AICopilotContext = createContext<AICopilotContextValue | null>(null)

export function AICopilotProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activityContext, setActivityContext] = useState<AICopilotActivityContext>(null)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [aichatUuid, setAichatUuid] = useState<string | null>(null)
  const [followUps, setFollowUps] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [isLoadingFollowUps, setIsLoadingFollowUps] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationMode, setConversationMode] = useState<CopilotConversationMode>('course')

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

  const resetConversation = useCallback(() => {
    setMessages([])
    setAichatUuid(null)
    setFollowUps([])
    setIsLoadingFollowUps(false)
    setError(null)
    setIsStreaming(false)
    setIsWaiting(false)
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
        messages,
        aichatUuid,
        followUps,
        isStreaming,
        isWaiting,
        isLoadingFollowUps,
        error,
        conversationMode,
        setMessages,
        setAichatUuid,
        setFollowUps,
        setIsStreaming,
        setIsWaiting,
        setIsLoadingFollowUps,
        setError,
        setConversationMode,
        resetConversation,
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