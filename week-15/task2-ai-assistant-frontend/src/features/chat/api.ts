import "client-only"

import { apiFetch, throwApiError } from "@/lib/api"

import type {
  ChatStreamEvent,
  SessionDetailDto,
  SessionSummaryDto,
} from "./types"

export async function listSessions(): Promise<SessionSummaryDto[]> {
  const response = await apiFetch("/sessions")
  if (!response.ok) await throwApiError(response)
  return (await response.json()) as SessionSummaryDto[]
}

export async function getSession(sessionId: string): Promise<SessionDetailDto> {
  const response = await apiFetch(`/sessions/${sessionId}`)
  if (!response.ok) await throwApiError(response)
  return (await response.json()) as SessionDetailDto
}

export async function createSession(): Promise<SessionSummaryDto> {
  const response = await apiFetch("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "New chat", use_rag: true }),
  })
  if (!response.ok) await throwApiError(response)
  return (await response.json()) as SessionSummaryDto
}

export async function updateSession(
  sessionId: string,
  changes: { title?: string; use_rag?: boolean }
): Promise<SessionSummaryDto> {
  const response = await apiFetch(`/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  })
  if (!response.ok) await throwApiError(response)
  return (await response.json()) as SessionSummaryDto
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await apiFetch(`/sessions/${sessionId}`, {
    method: "DELETE",
  })
  if (!response.ok) await throwApiError(response)
}

interface StreamChatRequest {
  session_id: string
  message: string
  document_ids: string[]
}

export async function streamChat(
  request: StreamChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await apiFetch("/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) await throwApiError(response)
  if (!response.body) throw new Error("The streaming response has no body")
  await readEventStream(response.body, onEvent)
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n")
    const blocks = buffer.split("\n\n")
    buffer = blocks.pop() ?? ""
    blocks.forEach((block) => emitEvent(block, onEvent))

    if (done) {
      if (buffer.trim()) emitEvent(buffer, onEvent)
      return
    }
  }
}

function emitEvent(
  eventBlock: string,
  onEvent: (event: ChatStreamEvent) => void
) {
  const data = eventBlock
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")

  if (data) onEvent(JSON.parse(data) as ChatStreamEvent)
}
