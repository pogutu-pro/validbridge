import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

export async function startActivityAIChatSession(
  message: string,
  access_token: string,
  activity_uuid?: string
) {
  const data = {
    message,
    activity_uuid,
  }
  const result = await fetch(
    `${getAPIUrl()}ai/start/activity_chat_session`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const json = await result.json()
  if (result.status === 200) {
    return {
      success: true,
      data: json,
      status: result.status,
      HTTPmessage: result.statusText,
    }
  } else {
    return {
      success: false,
      data: json,
      status: result.status,
      HTTPmessage: result.statusText,
    }
  }
}

export async function sendActivityAIChatMessage(
  message: string,
  aichat_uuid: string,
  activity_uuid: string,
  access_token: string
) {
  const data = {
    aichat_uuid,
    message,
    activity_uuid,
  }
  const result = await fetch(
    `${getAPIUrl()}ai/send/activity_chat_message`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )

  const json = await result.json()
  if (result.status === 200) {
    return {
      success: true,
      data: json,
      status: result.status,
      HTTPmessage: result.statusText,
    }
  } else {
    return {
      success: false,
      data: json,
      status: result.status,
      HTTPmessage: result.statusText,
    }
  }
}

// Streaming response types
export interface StreamStartData {
  aichat_uuid: string
}

export interface StreamDoneData {
  aichat_uuid: string
  activity_uuid: string
}

export interface StreamFollowUpsData {
  follow_up_suggestions: string[]
}

interface StreamStartEvent {
  type: 'start'
  aichat_uuid: string
}

interface StreamChunkEvent {
  type: 'chunk'
  content: string
}

interface StreamDoneEvent {
  type: 'done'
  aichat_uuid: string
  activity_uuid: string
}

interface StreamFollowUpsEvent {
  type: 'follow_ups'
  follow_up_suggestions: string[]
}

interface StreamSourcesEvent {
  type: 'sources'
  sources: Array<{
    activity_uuid?: string
    activity_name?: string
    chapter_name?: string
    course_name?: string
    course_uuid?: string
    source_type?: string
    chunk_text?: string
    similarity?: number
  }>
}

interface StreamSessionTitleEvent {
  type: 'session_title'
  title: string
}

interface StreamErrorEvent {
  type: 'error'
  message: string
}

type StreamEvent = StreamStartEvent | StreamChunkEvent | StreamDoneEvent | StreamFollowUpsEvent | StreamSourcesEvent | StreamSessionTitleEvent | StreamErrorEvent

export interface StreamSourceData {
  sources: Array<{
    activity_uuid?: string
    activity_name?: string
    chapter_name?: string
    course_name?: string
    course_uuid?: string
    source_type?: string
    chunk_text?: string
    similarity?: number
  }>
}

export interface StreamCallbacks {
  onStart?: (data: StreamStartData) => void
  onChunk: (chunk: string) => void
  onComplete: (data: StreamDoneData) => void
  onFollowUps?: (data: StreamFollowUpsData) => void
  onSources?: (data: StreamSourceData) => void
  onSessionTitle?: (title: string) => void
  onError: (error: string) => void
}

/**
 * Process SSE stream from response
 */
async function processStream(
  response: Response,
  callbacks: StreamCallbacks
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError('Failed to get response reader')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete SSE events (data: {...}\n\n)
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || '' // Keep incomplete data in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.slice(6) // Remove 'data: ' prefix
            const event: StreamEvent = JSON.parse(jsonStr)

            switch (event.type) {
              case 'start':
                callbacks.onStart?.({ aichat_uuid: event.aichat_uuid })
                break
              case 'chunk':
                callbacks.onChunk(event.content)
                break
              case 'done':
                callbacks.onComplete({
                  aichat_uuid: event.aichat_uuid,
                  activity_uuid: event.activity_uuid,
                })
                break
              case 'follow_ups':
                callbacks.onFollowUps?.({ follow_up_suggestions: event.follow_up_suggestions })
                break
              case 'sources':
                callbacks.onSources?.({ sources: event.sources })
                break
              case 'session_title':
                callbacks.onSessionTitle?.(event.title)
                break
              case 'error':
                callbacks.onError(event.message)
                break
            }
          } catch {
            // Failed to parse SSE event, skip
          }
        }
      }
    }
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Stream processing failed')
  } finally {
    reader.releaseLock()
  }
}

/**
 * Start a new AI chat session with streaming response
 */
export async function startActivityAIChatSessionStream(
  message: string,
  activity_uuid: string,
  access_token: string,
  callbacks: StreamCallbacks
): Promise<void> {
  const data = {
    message,
    activity_uuid,
  }

  try {
    const response = await fetch(
      `${getAPIUrl()}ai/stream/start/activity_chat_session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify(data),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
      callbacks.onError(errorData.detail || `HTTP error ${response.status}`)
      return
    }

    await processStream(response, callbacks)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Failed to start chat session')
  }
}

/**
 * Send a message to existing AI chat session with streaming response
 */
export async function sendActivityAIChatMessageStream(
  message: string,
  aichat_uuid: string,
  activity_uuid: string,
  access_token: string,
  callbacks: StreamCallbacks
): Promise<void> {
  const data = {
    aichat_uuid,
    message,
    activity_uuid,
  }

  try {
    const response = await fetch(
      `${getAPIUrl()}ai/stream/send/activity_chat_message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify(data),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
      callbacks.onError(errorData.detail || `HTTP error ${response.status}`)
      return
    }

    await processStream(response, callbacks)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Failed to send message')
  }
}

// Editor AI Types and Functions
export interface EditorModifyRequest {
  message: string
  activity_uuid: string
  current_content: any // TipTap JSON
  selected_text?: string
  aichat_uuid?: string
  cursor_position?: number
}

export interface EditorStreamCallbacks {
  onStart?: (data: { aichat_uuid: string }) => void
  onChatChunk?: (chunk: string) => void
  onContentStart?: () => void
  onContentChunk?: (chunk: string) => void
  onContentEnd?: (fullContent: string) => void
  onComplete: (data: { aichat_uuid: string; activity_uuid: string }) => void
  onFollowUps?: (suggestions: string[]) => void
  onError: (error: string) => void
}

interface EditorStreamEvent {
  type: 'start' | 'chat_chunk' | 'content_start' | 'content_chunk' | 'content_end' | 'done' | 'follow_ups' | 'error'
  content?: string
  full_content?: string
  aichat_uuid?: string
  activity_uuid?: string
  follow_up_suggestions?: string[]
  message?: string
}

async function processEditorStream(
  response: Response,
  callbacks: EditorStreamCallbacks
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError('Failed to get response reader')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.slice(6)
            const event: EditorStreamEvent = JSON.parse(jsonStr)

            switch (event.type) {
              case 'start':
                callbacks.onStart?.({ aichat_uuid: event.aichat_uuid || '' })
                break
              case 'chat_chunk':
                callbacks.onChatChunk?.(event.content || '')
                break
              case 'content_start':
                callbacks.onContentStart?.()
                break
              case 'content_chunk':
                callbacks.onContentChunk?.(event.content || '')
                break
              case 'content_end':
                callbacks.onContentEnd?.(event.full_content || '')
                break
              case 'done':
                callbacks.onComplete({
                  aichat_uuid: event.aichat_uuid || '',
                  activity_uuid: event.activity_uuid || '',
                })
                break
              case 'follow_ups':
                callbacks.onFollowUps?.(event.follow_up_suggestions || [])
                break
              case 'error':
                callbacks.onError(event.message || 'Unknown error')
                break
            }
          } catch {
            // Failed to parse SSE event, skip
          }
        }
      }
    }
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Stream processing failed')
  } finally {
    reader.releaseLock()
  }
}

/**
 * Start a new AI Editor chat session with streaming response
 */
export async function startEditorAIChatSessionStream(
  request: EditorModifyRequest,
  access_token: string,
  callbacks: EditorStreamCallbacks
): Promise<void> {
  const data = {
    message: request.message,
    activity_uuid: request.activity_uuid,
    current_content: request.current_content,
    selected_text: request.selected_text,
  }

  try {
    const response = await fetch(
      `${getAPIUrl()}ai/stream/editor/start`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify(data),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
      callbacks.onError(errorData.detail || `HTTP error ${response.status}`)
      return
    }

    await processEditorStream(response, callbacks)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Failed to start editor chat session')
  }
}

/**
 * Send a message to existing AI Editor chat session with streaming response
 */
export async function sendEditorAIChatMessageStream(
  request: EditorModifyRequest,
  access_token: string,
  callbacks: EditorStreamCallbacks
): Promise<void> {
  const data = {
    message: request.message,
    activity_uuid: request.activity_uuid,
    current_content: request.current_content,
    selected_text: request.selected_text,
    aichat_uuid: request.aichat_uuid,
  }

  try {
    const response = await fetch(
      `${getAPIUrl()}ai/stream/editor/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify(data),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
      callbacks.onError(errorData.detail || `HTTP error ${response.status}`)
      return
    }

    await processEditorStream(response, callbacks)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Failed to send editor message')
  }
}

// ============================================================================
// RAG Session Management Functions
// ============================================================================

export interface RAGChatSession {
  aichat_uuid: string
  title: string
  course_uuid?: string | null
  created_at: string
  favorite?: boolean
  mode?: 'course_only' | 'general'
}

export async function fetchRAGChatSessions(
  accessToken: string,
  orgSlug?: string
): Promise<RAGChatSession[]> {
  const params = orgSlug ? `?org_slug=${encodeURIComponent(orgSlug)}` : ''
  const res = await fetch(`${getAPIUrl()}ai/rag/sessions${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.sessions || []
}

export async function fetchRAGChatMessages(
  aichatUuid: string,
  accessToken: string
): Promise<Array<{ role: string; content: string; sources?: StreamSourceData['sources'] }>> {
  const res = await fetch(`${getAPIUrl()}ai/rag/sessions/${aichatUuid}/messages`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.messages || []
}

export async function deleteRAGChatSession(
  aichatUuid: string,
  accessToken: string
): Promise<boolean> {
  const res = await fetch(`${getAPIUrl()}ai/rag/sessions/${aichatUuid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return res.ok
}

export async function updateRAGChatSession(
  aichatUuid: string,
  accessToken: string,
  updates: { title?: string; favorite?: boolean }
): Promise<RAGChatSession | null> {
  const res = await fetch(`${getAPIUrl()}ai/rag/sessions/${aichatUuid}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(updates),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.session || null
}

// ============================================================================
// RAG Chat Streaming Functions
// ============================================================================

/**
 * Start a new RAG chat session with streaming response
 */
export async function startRAGChatStream(
  message: string,
  accessToken: string,
  callbacks: StreamCallbacks,
  courseUuid?: string,
  mode?: string,
  orgSlug?: string
): Promise<void> {
  const data: Record<string, string> = { message, mode: mode || 'course_only' }
  if (courseUuid) {
    data.course_uuid = courseUuid
  }
  if (orgSlug) {
    data.org_slug = orgSlug
  }

  try {
    const response = await fetch(
      `${getAPIUrl()}ai/rag/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(data),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
      callbacks.onError(errorData.detail || `HTTP error ${response.status}`)
      return
    }

    await processStream(response, callbacks)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Failed to start RAG chat session')
  }
}

/**
 * Send a message to an existing RAG chat session with streaming response
 */
export async function sendRAGChatStream(
  message: string,
  aichatUuid: string,
  accessToken: string,
  callbacks: StreamCallbacks,
  courseUuid?: string,
  mode?: string,
  orgSlug?: string
): Promise<void> {
  const data: Record<string, string> = { message, aichat_uuid: aichatUuid, mode: mode || 'course_only' }
  if (courseUuid) {
    data.course_uuid = courseUuid
  }
  if (orgSlug) {
    data.org_slug = orgSlug
  }

  try {
    const response = await fetch(
      `${getAPIUrl()}ai/rag/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(data),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
      callbacks.onError(errorData.detail || `HTTP error ${response.status}`)
      return
    }

    await processStream(response, callbacks)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Failed to send RAG chat message')
  }
}

// ============================================================================
// Context-aware Assistant ("Genie") — managerial dashboard only
// ============================================================================

/**
 * Separate transport for the product-aware assistant.
 *
 * This deliberately does NOT reuse `processStream`: the assistant's `done`
 * event carries no `activity_uuid`, and its `start` event adds
 * `retrieval_hinted`. Sharing the tutor's parser would silently drop that flag
 * and blur the two response shapes, which is the thing AIguide.md wants kept
 * apart. The existing `startRAGChatStream` / `sendRAGChatStream` functions are
 * untouched.
 */
export interface AssistantPageContext {
  pathname: string
  title?: string
  description?: string
  aiSummary?: string
}

export interface AssistantStreamStartData {
  aichat_uuid: string
  /** Server's cost routing decision: would this turn have needed retrieval? */
  retrieval_hinted: boolean
}

export interface AssistantStreamCallbacks {
  onStart?: (data: AssistantStreamStartData) => void
  onChunk: (chunk: string) => void
  onComplete: (data: { aichat_uuid: string }) => void
  onFollowUps?: (data: StreamFollowUpsData) => void
  onSessionTitle?: (title: string) => void
  onError: (error: string) => void
}

interface AssistantStreamEvent {
  type: 'start' | 'chunk' | 'done' | 'follow_ups' | 'session_title' | 'error'
  aichat_uuid?: string
  content?: string
  retrieval_hinted?: boolean
  follow_up_suggestions?: string[]
  title?: string
  message?: string
}

async function processAssistantStream(
  response: Response,
  callbacks: AssistantStreamCallbacks
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError('Failed to get response reader')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        let event: AssistantStreamEvent
        try {
          event = JSON.parse(line.slice(6))
        } catch {
          continue
        }

        switch (event.type) {
          case 'start':
            callbacks.onStart?.({
              aichat_uuid: event.aichat_uuid || '',
              retrieval_hinted: event.retrieval_hinted ?? false,
            })
            break
          case 'chunk':
            callbacks.onChunk(event.content || '')
            break
          case 'done':
            callbacks.onComplete({ aichat_uuid: event.aichat_uuid || '' })
            break
          case 'follow_ups':
            callbacks.onFollowUps?.({ follow_up_suggestions: event.follow_up_suggestions || [] })
            break
          case 'session_title':
            callbacks.onSessionTitle?.(event.title || '')
            break
          case 'error':
            callbacks.onError(event.message || 'Unknown error')
            break
        }
      }
    }
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Stream processing failed')
  } finally {
    reader.releaseLock()
  }
}

export interface AssistantChatSession {
  aichat_uuid: string
  title: string
  org_id?: number | null
  created_at: string
  favorite?: boolean
}

function assistantChatBody(
  message: string,
  aichatUuid: string | null,
  pageContext: AssistantPageContext | null,
  orgSlug: string | undefined,
  includeFollowUps: boolean
) {
  const body: Record<string, unknown> = { message, include_follow_ups: includeFollowUps }
  if (aichatUuid) body.aichat_uuid = aichatUuid
  if (pageContext) body.page_context = pageContext
  if (orgSlug) body.org_slug = orgSlug
  return body
}

async function postAssistantChat(
  body: Record<string, unknown>,
  accessToken: string,
  callbacks: AssistantStreamCallbacks
): Promise<void> {
  try {
    const response = await fetch(`${getAPIUrl()}ai/assistant/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
      callbacks.onError(errorData.detail || `HTTP error ${response.status}`)
      return
    }

    await processAssistantStream(response, callbacks)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Failed to reach the AI assistant')
  }
}

/**
 * First message of a new assistant conversation.
 *
 * Requests follow-up suggestions -- an extra model call -- since that's where
 * they earn their keep: pointing a first-time user at what to ask next. Later
 * turns skip it (see `sendAssistantChatStream`); by then the user is already
 * driving the conversation, so the extra call stops paying for itself.
 */
export async function startAssistantChatStream(
  message: string,
  accessToken: string,
  callbacks: AssistantStreamCallbacks,
  pageContext?: AssistantPageContext | null,
  orgSlug?: string
): Promise<void> {
  await postAssistantChat(
    assistantChatBody(message, null, pageContext ?? null, orgSlug, true),
    accessToken,
    callbacks
  )
}

/** Follow-up message on an existing assistant conversation. */
export async function sendAssistantChatStream(
  message: string,
  aichatUuid: string,
  accessToken: string,
  callbacks: AssistantStreamCallbacks,
  pageContext?: AssistantPageContext | null,
  orgSlug?: string
): Promise<void> {
  await postAssistantChat(
    assistantChatBody(message, aichatUuid, pageContext ?? null, orgSlug, false),
    accessToken,
    callbacks
  )
}

export async function fetchAssistantChatSessions(
  accessToken: string,
  orgSlug?: string
): Promise<AssistantChatSession[]> {
  const params = orgSlug ? `?org_slug=${encodeURIComponent(orgSlug)}` : ''
  const res = await fetch(`${getAPIUrl()}ai/assistant/sessions${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.sessions || []
}

export async function deleteAssistantChatSession(
  aichatUuid: string,
  accessToken: string
): Promise<boolean> {
  const res = await fetch(`${getAPIUrl()}ai/assistant/sessions/${aichatUuid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return res.ok
}
