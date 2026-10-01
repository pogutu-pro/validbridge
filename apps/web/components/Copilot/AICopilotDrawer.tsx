'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import AiCreditsNotice from '@components/AI/AiCreditsNotice'
import { useOrg } from '@components/Contexts/OrgContext'
import { useAICopilot } from '@components/Contexts/AI/AICopilotContext'
import {
  startActivityAIChatSessionStream,
  sendActivityAIChatMessageStream,
  startRAGChatStream,
  sendRAGChatStream,
  startAssistantChatStream,
  sendAssistantChatStream,
  StreamCallbacks,
  StreamFollowUpsData,
  AssistantStreamCallbacks,
} from '@services/ai/ai'
import { getUriWithOrg } from '@services/config/config'
import { useVBAnalytics, AnalyticsEvent } from '@services/analytics'
import {
  AssistantMessage,
  EMPTY_SOURCES,
  ChatMessage,
} from '@/app/orgs/[orgslug]/(withmenu)/copilot/copilot'
import { Sparkle, X, PaperPlaneRight, SpinnerGap, ArrowRight, ArrowSquareOut } from '@phosphor-icons/react'
import Link from 'next/link'

type AICopilotDrawerProps = {
  orgslug: string
}

const ACTIVITY_SUGGESTIONS = [
  'Explain this activity',
  'Summarize this lesson',
  'Give me a practical example',
  'Create flashcards',
  'Help me understand this concept',
]

const COURSE_SUGGESTIONS = [
  'Summarize my courses',
  'Explain a concept I am struggling with',
  'Create flashcards from my notes',
  'Quiz me on what I have learned',
  'Build a study plan',
]

// Product/navigation questions. Deliberately not course-content questions:
// those belong to the course tutor, which the segmented control also offers.
const ASSISTANT_SUGGESTIONS = [
  'What should I do next?',
  'How do I add an instructor?',
  'How do I change the branding?',
  'How do I create an API token?',
  'Where are my AI credits?',
]

export default function AICopilotDrawer({ orgslug }: AICopilotDrawerProps) {
  const {
    isOpen,
    closeCopilot,
    activityContext,
    pageContext,
    pageHints,
    effectiveMode,
    pendingPrompt,
    clearPendingPrompt,
  } = useAICopilot()
  const session = useVBSession() as any
  const org = useOrg() as any
  const accessToken = session?.data?.tokens?.access_token
  const { track } = useVBAnalytics('learner')

  const config = org?.config?.config
  const isV2 = config?.config_version?.startsWith('2')
  const isCopilotEnabled = isV2
    ? (config?.resolved_features?.ai?.enabled !== false && config?.admin_toggles?.ai?.copilot_enabled !== false)
    : (config?.features?.ai?.enabled !== false && config?.features?.ai?.copilot_enabled !== false)

  const isActivityMode = effectiveMode === 'activity'
  const isAssistantMode = effectiveMode === 'assistant'

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [aichatUuid, setAichatUuid] = useState<string | null>(null)
  const [followUps, setFollowUps] = useState<string[]>([])
  const [isLoadingFollowUps, setIsLoadingFollowUps] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const streamingIndexRef = useRef<number>(-1)
  const trackedActivityRef = useRef<string | null>(null)

  // Reset the conversation whenever the contextual activity or the brain
  // changes. A session id is only resumable within the mode that created it —
  // an assistant id would 404 against /rag/chat and vice versa — so carrying the
  // transcript across a mode switch would strand the user.
  useEffect(() => {
    const activityUuid = activityContext?.activity_uuid ?? null
    const current = `${effectiveMode}:${activityUuid ?? ''}`
    if (current !== trackedActivityRef.current) {
      trackedActivityRef.current = current
      setMessages([])
      setAichatUuid(null)
      setFollowUps([])
      setIsLoadingFollowUps(false)
      setError(null)
      setIsStreaming(false)
      setIsWaiting(false)
      streamingIndexRef.current = -1
    }
  }, [activityContext?.activity_uuid, effectiveMode])

  // Autofocus input when the drawer opens.
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 120)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Escape key closes the drawer.
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCopilot()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, closeCopilot])

  useEffect(() => {
    if (messages.length > 0 && messagesContainerRef.current) {
      const c = messagesContainerRef.current
      c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim() || !accessToken) return

    setError(null)
    setFollowUps([])
    setIsLoadingFollowUps(false)

    setMessages((prev) => {
      const next = [
        ...prev,
        { role: 'user' as const, content: message },
        { role: 'assistant' as const, content: '', sources: [] },
      ]
      streamingIndexRef.current = next.length - 1
      return next
    })
    setInput('')
    setIsWaiting(true)
    setIsStreaming(true)

    track(AnalyticsEvent.CopilotMessageSent, {
      chat_mode: effectiveMode,
    })

    const onStart = (data: { aichat_uuid: string }) => {
      setIsWaiting(false)
      if (data.aichat_uuid) setAichatUuid(data.aichat_uuid)
    }
    const onChunk = (chunk: string) => {
      setMessages((prev) => {
        const idx = streamingIndexRef.current
        if (idx < 0 || idx >= prev.length) return prev
        const updated = [...prev]
        updated[idx] = { ...updated[idx], content: updated[idx].content + chunk }
        return updated
      })
    }
    const onComplete = (data: { aichat_uuid: string }) => {
      setIsStreaming(false)
      setIsWaiting(false)
      setIsLoadingFollowUps(true)
      streamingIndexRef.current = -1
      if (data.aichat_uuid) setAichatUuid(data.aichat_uuid)
      track(AnalyticsEvent.CopilotResponseCompleted)
    }
    const onFollowUps = (data: StreamFollowUpsData) => {
      setIsLoadingFollowUps(false)
      if (data.follow_up_suggestions?.length) setFollowUps(data.follow_up_suggestions)
    }
    const onError = (msg: string) => {
      setIsStreaming(false)
      setIsWaiting(false)
      setIsLoadingFollowUps(false)
      streamingIndexRef.current = -1
      setError(msg)
      track(AnalyticsEvent.CopilotResponseFailed)
    }

    const callbacks: StreamCallbacks = {
      onStart,
      onChunk,
      onComplete,
      onFollowUps,
      onError,
      onSources: (data) => {
        const capturedIdx = streamingIndexRef.current
        setMessages((prev) => {
          if (capturedIdx < 0 || capturedIdx >= prev.length) return prev
          const updated = [...prev]
          updated[capturedIdx] = { ...updated[capturedIdx], sources: data.sources }
          return updated
        })
      },
    }

    // Same behaviour, narrower shape: the assistant emits no `sources` event and
    // its `done` event carries no `activity_uuid`.
    const assistantCallbacks: AssistantStreamCallbacks = {
      onStart,
      onChunk,
      onComplete,
      onFollowUps,
      onError,
    }

    if (isAssistantMode) {
      // Managerial dashboard only. Sends the current page as a prompt hint; the
      // backend re-derives org and role from the token and never trusts it.
      if (aichatUuid) {
        await sendAssistantChatStream(message, aichatUuid, accessToken, assistantCallbacks, pageContext, orgslug)
      } else {
        await startAssistantChatStream(message, accessToken, assistantCallbacks, pageContext, orgslug)
      }
    } else if (isActivityMode && activityContext?.activity_uuid) {
      if (aichatUuid) {
        await sendActivityAIChatMessageStream(message, aichatUuid, activityContext.activity_uuid, accessToken, callbacks)
      } else {
        await startActivityAIChatSessionStream(message, activityContext.activity_uuid, accessToken, callbacks)
      }
    } else {
      if (aichatUuid) {
        await sendRAGChatStream(message, aichatUuid, accessToken, callbacks, undefined, 'course_only', orgslug)
      } else {
        await startRAGChatStream(message, accessToken, callbacks, undefined, 'course_only', orgslug)
      }
    }
  }, [accessToken, aichatUuid, isActivityMode, isAssistantMode, activityContext, pageContext, orgslug, track])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  // Auto-send a queued prompt (e.g. a Canva "Explain selection" action).
  useEffect(() => {
    if (isOpen && pendingPrompt && isActivityMode && accessToken) {
      clearPendingPrompt()
      sendMessage(pendingPrompt)
    }
  }, [isOpen, pendingPrompt, isActivityMode, accessToken, sendMessage, clearPendingPrompt])

  if (!isCopilotEnabled) return null

  // Page-specific hints win over the generic set, so the opening suggestions
  // differ per page (Phase 2 acceptance). Falls back to the generic assistant
  // set when the current route has no metadata entry.
  const suggestions = isAssistantMode
    ? (pageHints.length > 0 ? pageHints : ASSISTANT_SUGGESTIONS)
    : isActivityMode
      ? ACTIVITY_SUGGESTIONS
      : COURSE_SUGGESTIONS
  const placeholder = isAssistantMode
    ? 'Ask about ValidBridge or what to do next…'
    : isActivityMode
      ? 'Ask AI about this activity...'
      : 'Ask about your courses...'
  const isInputDisabled = isWaiting

  const hasConversation = messages.length > 0

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.button
          key="ai-copilot-backdrop"
          aria-label="Close AI Copilot"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={closeCopilot}
          style={{ zIndex: 'var(--z-modal-backdrop)' }}
          className="fixed inset-0 bg-black/40 md:hidden"
        />
      )}

      {isOpen && (
        <motion.aside
          key="ai-copilot-panel"
          role="dialog"
          aria-label="AI Copilot"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 360, damping: 36 }}
          style={{ zIndex: 'var(--z-modal)' }}
          className="fixed inset-y-0 end-0 flex w-full flex-col border-s border-border bg-background shadow-2xl shadow-black/10 sm:w-[400px]"
        >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkle size={18} weight="fill" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold text-foreground">AI Copilot</h2>
                <p className="truncate text-xs text-muted-foreground">
                  {isAssistantMode ? 'Product assistant' : 'Your learning assistant'}
                </p>
              </div>
              <Link
                href={getUriWithOrg(orgslug, '/copilot')}
                aria-label="Open full page"
                title="Open full page"
                className="hidden items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:flex"
              >
                <ArrowSquareOut size={16} />
              </Link>
              <button
                aria-label="Close AI Copilot"
                onClick={closeCopilot}
                className="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <X size={18} />
              </button>
            </div>

            {/* The tutor uses paid AI credits; Genie is free. */}
            {!isAssistantMode && <AiCreditsNotice variant="tutor" />}

            {/* Empty state */}
            {!hasConversation && !error && (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-white text-primary">
                  <Sparkle size={26} weight="fill" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-foreground">AI Copilot</h3>
                <p className="mt-1 text-sm font-medium text-muted-foreground">Your learning assistant</p>
                <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  {isAssistantMode
                    ? 'Ask how anything in ValidBridge works, or what to do next on this page.'
                    : 'Ask questions about this activity, clarify concepts, or get help understanding the material.'}
                </p>
                <div className="mt-6 flex w-full flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <Link
                  href={getUriWithOrg(orgslug, '/help/ai/ai-copilot')}
                  onClick={closeCopilot}
                  className="mt-6 text-xs font-medium text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
                >
                  {isAssistantMode ? 'Learn what Genie can help with' : 'Learn how to use the Copilot'}
                </Link>
              </div>
            )}

            {/* Conversation */}
            {hasConversation && (
              <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-4">
                  {messages.map((msg, i) => {
                    if (msg.role === 'user') {
                      return (
                        <div key={i} className="flex justify-end">
                          <div className="max-w-[85%] rounded-2xl rounded-se-sm bg-primary px-3.5 py-2.5 text-primary-foreground">
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      )
                    }
                    const isThisStreaming = i === streamingIndexRef.current && isStreaming
                    const showWaiting = isThisStreaming && isWaiting && !msg.content
                    return (
                      <div key={i} className="space-y-2">
                        <AssistantMessage
                          content={msg.content}
                          sources={msg.sources || EMPTY_SOURCES}
                          orgslug={orgslug}
                          isStreaming={isThisStreaming && !!msg.content}
                          isWaiting={showWaiting}
                        />
                      </div>
                    )
                  })}

                  {error && (
                    <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                      {error}
                    </div>
                  )}

                  {/* Follow-up suggestions */}
                  {!isStreaming && !isWaiting && (isLoadingFollowUps || followUps.length > 0) && (
                    <div className="space-y-1.5 pt-1">
                      {followUps.length > 0 ? (
                        followUps.map((s, i) => (
                          <button
                            key={i}
                            onClick={() => sendMessage(s)}
                            className="group flex items-center gap-2 w-fit max-w-full text-start rounded-xl bg-secondary px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <ArrowRight size={13} weight="bold" className="flex-shrink-0 text-muted-foreground group-hover:text-primary" data-dir-flip />
                            <span className="truncate">{s}</span>
                          </button>
                        ))
                      ) : (
                        <div className="flex items-center gap-2 px-1 py-1">
                          <SpinnerGap size={14} className="animate-spin text-primary" />
                          <span className="text-xs text-muted-foreground">Thinking of follow-ups...</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error (no conversation yet) */}
            {!hasConversation && error && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
                <button
                  onClick={() => setError(null)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Input bar — anchored to the bottom */}
            <div className="border-t border-border px-4 py-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  sendMessage(input)
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  aria-label={placeholder}
                  placeholder={isWaiting ? 'Thinking...' : placeholder}
                  disabled={isInputDisabled}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-white px-3.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                />
                <button
                  type="submit"
                  aria-label="Send message"
                  disabled={isInputDisabled || !input.trim()}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
                >
                  <PaperPlaneRight size={18} weight="fill" />
                </button>
              </form>
            </div>
          </motion.aside>
      )}
    </AnimatePresence>
  )
}
