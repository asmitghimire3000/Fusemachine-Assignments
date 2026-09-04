"use client"

import { useEffect, useRef, useState } from "react"

import {
  createSession as createSessionRequest,
  deleteSession as deleteSessionRequest,
  getSession,
  listSessions,
  streamChat,
  updateSession,
} from "./api"
import type {
  AssistantMessage,
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  MessageAttachment,
  SessionDetailDto,
  SessionSummaryDto,
  UserMessage,
} from "./types"

interface SessionState {
  sessions: ChatSession[]
  activeSessionId: string | null
}

const EMPTY_STATE: SessionState = { sessions: [], activeSessionId: null }

export function useChatSessions(enabled: boolean) {
  const [state, setState] = useState<SessionState>(EMPTY_STATE)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activeRequest = useRef<AbortController | null>(null)

  const activeSession =
    state.sessions.find((session) => session.id === state.activeSessionId) ??
    null
  const isStreaming =
    activeSession?.messages.some(
      (message) =>
        message.role === "assistant" && message.status === "streaming"
    ) ?? false

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    async function loadInitialSessions() {
      setIsLoading(true)
      setError(null)
      try {
        const summaries = await listSessions()
        if (cancelled) return

        if (!summaries.length) {
          setState(EMPTY_STATE)
          return
        }

        const firstSession = await getSession(summaries[0].id)
        if (cancelled) return

        setState({
          sessions: summaries.map((summary) =>
            summary.id === firstSession.id
              ? mapSessionDetail(firstSession)
              : mapSessionSummary(summary)
          ),
          activeSessionId: firstSession.id,
        })
      } catch (loadError) {
        if (!cancelled) setError(readError(loadError, "Could not load chats"))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadInitialSessions()
    return () => {
      cancelled = true
      activeRequest.current?.abort()
    }
  }, [enabled])

  async function createSession(): Promise<ChatSession | null> {
    if (activeRequest.current) return null

    setError(null)
    try {
      const created = mapSessionSummary(await createSessionRequest())
      setState((current) => ({
        sessions: [created, ...current.sessions],
        activeSessionId: created.id,
      }))
      return created
    } catch (createError) {
      setError(readError(createError, "Could not create a chat"))
      return null
    }
  }

  async function selectSession(sessionId: string) {
    if (activeRequest.current || sessionId === state.activeSessionId) return

    setState((current) => ({ ...current, activeSessionId: sessionId }))
    const session = state.sessions.find((item) => item.id === sessionId)
    if (session?.loaded) return

    setIsLoading(true)
    setError(null)
    try {
      replaceSession(mapSessionDetail(await getSession(sessionId)))
    } catch (loadError) {
      setError(readError(loadError, "Could not load this chat"))
    } finally {
      setIsLoading(false)
    }
  }

  async function deleteSession(sessionId: string) {
    if (activeRequest.current) return

    setError(null)
    try {
      await deleteSessionRequest(sessionId)
      const sessions = state.sessions.filter(
        (session) => session.id !== sessionId
      )
      const nextActiveId =
        state.activeSessionId === sessionId
          ? (sessions[0]?.id ?? null)
          : state.activeSessionId

      setState({ sessions, activeSessionId: nextActiveId })

      const nextSession = sessions.find(
        (session) => session.id === nextActiveId
      )
      if (nextSession && !nextSession.loaded) {
        replaceSession(mapSessionDetail(await getSession(nextSession.id)))
      }
    } catch (deleteError) {
      setError(readError(deleteError, "Could not delete this chat"))
    }
  }

  async function renameSession(sessionId: string, title: string) {
    const cleanTitle = title.trim()
    if (!cleanTitle) return

    setError(null)
    try {
      const updated = await updateSession(sessionId, { title: cleanTitle })
      updateSessionTitle(sessionId, updated.title)
    } catch (renameError) {
      setError(readError(renameError, "Could not rename this chat"))
      throw renameError
    }
  }

  async function sendMessage(
    content: string,
    attachments: MessageAttachment[] = []
  ) {
    const cleanContent = content.trim()
    if (!cleanContent || activeRequest.current) return

    const session = activeSession ?? (await createSession())
    if (!session) return

    const requestController = new AbortController()
    activeRequest.current = requestController
    setError(null)

    const now = new Date().toISOString()
    const userMessage: UserMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: cleanContent,
      createdAt: now,
      attachments,
    }
    const assistantMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: now,
      status: "streaming",
      activity: "Starting",
      activities: ["Started request"],
      followUpQuestions: [],
      sources: [],
      tools: [],
    }

    appendMessages(session.id, userMessage, assistantMessage)

    if (session.title === "New chat" && session.messages.length === 0) {
      const title = createSessionTitle(cleanContent)
      updateSessionTitle(session.id, title)
      void updateSession(session.id, { title }).catch(() => undefined)
    }

    try {
      await streamChat(
        {
          session_id: session.id,
          message: cleanContent,
          document_ids: attachments.map((attachment) => attachment.id),
        },
        (event) => handleStreamEvent(session.id, assistantMessage.id, event),
        requestController.signal
      )
    } catch (streamError) {
      if (requestController.signal.aborted) {
        markAssistantStopped(session.id, assistantMessage.id)
      } else {
        markAssistantError(
          session.id,
          assistantMessage.id,
          readError(streamError, "Could not reach the assistant")
        )
      }
    } finally {
      if (activeRequest.current === requestController) {
        activeRequest.current = null
      }
    }
  }

  function stopGeneration() {
    activeRequest.current?.abort()
  }

  function replaceSession(session: ChatSession) {
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((item) =>
        item.id === session.id ? session : item
      ),
    }))
  }

  function updateSessionTitle(sessionId: string, title: string) {
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === sessionId ? { ...session, title } : session
      ),
    }))
  }

  function appendMessages(
    sessionId: string,
    userMessage: UserMessage,
    assistantMessage: AssistantMessage
  ) {
    setState((current) => {
      const session = current.sessions.find((item) => item.id === sessionId)
      if (!session) return current

      const updatedSession = {
        ...session,
        loaded: true,
        updatedAt: userMessage.createdAt,
        messages: [...session.messages, userMessage, assistantMessage],
      }
      return {
        activeSessionId: sessionId,
        sessions: [
          updatedSession,
          ...current.sessions.filter((item) => item.id !== sessionId),
        ],
      }
    })
  }

  function handleStreamEvent(
    sessionId: string,
    messageId: string,
    event: ChatStreamEvent
  ) {
    if (event.type === "status") {
      updateAssistantMessage(sessionId, messageId, (message) => ({
        ...message,
        activity: event.message,
        activities:
          message.activities?.at(-1) === event.message
            ? message.activities
            : [...(message.activities ?? []), event.message],
      }))
    }

    if (event.type === "tool") {
      updateAssistantMessage(sessionId, messageId, (message) => ({
        ...message,
        tools: [...message.tools, event.tool],
      }))
    }

    if (event.type === "delta") {
      updateAssistantMessage(sessionId, messageId, (message) => ({
        ...message,
        content: message.content + event.content,
      }))
    }

    if (event.type === "complete") {
      updateAssistantMessage(sessionId, messageId, (message) => ({
        ...message,
        content: event.response.answer,
        status: "complete",
        activity: undefined,
        confidence: event.response.confidence,
        followUpQuestions: event.response.follow_up_questions,
        sources: event.response.sources,
        tools: event.response.tools_used,
        model: event.response.model,
        usedFallback: event.response.used_fallback,
      }))
    }

    if (event.type === "error") {
      markAssistantError(sessionId, messageId, event.message)
    }
  }

  function markAssistantError(
    sessionId: string,
    messageId: string,
    errorMessage: string
  ) {
    updateAssistantMessage(sessionId, messageId, (message) => ({
      ...message,
      content: message.content || errorMessage,
      status: "error",
      activity: undefined,
    }))
  }

  function markAssistantStopped(sessionId: string, messageId: string) {
    updateAssistantMessage(sessionId, messageId, (message) => ({
      ...message,
      content: message.content || "Response stopped.",
      status: "stopped",
      activity: undefined,
    }))
  }

  function updateAssistantMessage(
    sessionId: string,
    messageId: string,
    update: (message: AssistantMessage) => AssistantMessage
  ) {
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((session) => {
        if (session.id !== sessionId) return session
        return {
          ...session,
          messages: session.messages.map((message) =>
            message.id === messageId && message.role === "assistant"
              ? update(message)
              : message
          ),
        }
      }),
    }))
  }

  return {
    sessions: state.sessions,
    activeSession,
    activeSessionId: state.activeSessionId,
    isLoading,
    isStreaming,
    error,
    createSession,
    selectSession,
    deleteSession,
    renameSession,
    sendMessage,
    stopGeneration,
  }
}

function mapSessionSummary(session: SessionSummaryDto): ChatSession {
  return {
    id: session.id,
    title: session.title,
    messages: [],
    useRag: session.use_rag,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    loaded: false,
  }
}

function mapSessionDetail(session: SessionDetailDto): ChatSession {
  return {
    ...mapSessionSummary(session),
    loaded: true,
    messages: session.messages.map(mapStoredMessage),
  }
}

function mapStoredMessage(
  message: SessionDetailDto["messages"][number]
): ChatMessage {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      content: message.content,
      createdAt: message.created_at,
      attachments: message.documents.map((document) => ({
        id: document.id,
        name: document.name,
        chunkCount: document.chunk_count,
      })),
    }
  }

  const details = message.details
  const interrupted =
    message.status === "pending" || message.status === "streaming"
  return {
    id: message.id,
    role: "assistant",
    content: message.content || (interrupted ? "Response interrupted." : ""),
    createdAt: message.created_at,
    status:
      message.status === "pending" || message.status === "streaming"
        ? "stopped"
        : message.status,
    confidence: details.confidence,
    followUpQuestions: details.follow_up_questions ?? [],
    sources: details.sources ?? [],
    tools: details.tools_used ?? [],
    model: details.model,
    usedFallback: details.used_fallback,
  }
}

function createSessionTitle(message: string): string {
  return message.length > 40 ? `${message.slice(0, 40)}…` : message
}

function readError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
