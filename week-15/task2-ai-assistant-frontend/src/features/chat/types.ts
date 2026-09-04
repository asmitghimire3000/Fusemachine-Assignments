export type ChatRole = "user" | "assistant"
export type Confidence = "low" | "medium" | "high"
export type MessageStatus = "streaming" | "complete" | "stopped" | "error"

export interface SourceReference {
  citation_number: number
  chunk_id: string
  document_name: string
  chunk_index: number
  score: number
  text: string
}

export interface ToolExecution {
  name: string
  arguments: Record<string, unknown>
  output: string
  success: boolean
}

export interface PipelineStats {
  retrieval_strategy: "hybrid_rerank" | "dense_cosine" | "disabled"
  retrieved_chunks: number
  cited_chunks: number
  tool_executions: number
}

export interface ChatResponse {
  answer: string
  confidence: Confidence
  follow_up_questions: string[]
  sources: SourceReference[]
  tools_used: ToolExecution[]
  model: string
  used_fallback: boolean
  pipeline_stats: PipelineStats
}

export type ChatStreamEvent =
  | { type: "status"; stage: "retrieving" | "generating"; message: string }
  | { type: "tool"; tool: ToolExecution }
  | { type: "delta"; content: string }
  | { type: "complete"; response: ChatResponse }
  | { type: "error"; message: string }

export interface MessageAttachment {
  id: string
  name: string
  chunkCount: number
}

interface BaseMessage {
  id: string
  content: string
  createdAt: string
}

export interface UserMessage extends BaseMessage {
  role: "user"
  attachments: MessageAttachment[]
}

export interface AssistantMessage extends BaseMessage {
  role: "assistant"
  status: MessageStatus
  activity?: string
  activities?: string[]
  confidence?: Confidence
  followUpQuestions: string[]
  sources: SourceReference[]
  tools: ToolExecution[]
  model?: string
  usedFallback?: boolean
}

export type ChatMessage = UserMessage | AssistantMessage

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  useRag: boolean
  createdAt: string
  updatedAt: string
  loaded: boolean
}

export interface SessionSummaryDto {
  id: string
  title: string
  use_rag: boolean
  created_at: string
  updated_at: string
}

export interface AttachedDocumentDto {
  id: string
  name: string
  chunk_count: number
}

export interface StoredMessageDto {
  id: string
  role: ChatRole
  status: "pending" | "streaming" | "complete" | "stopped" | "error"
  content: string
  details: Partial<ChatResponse>
  created_at: string
  documents: AttachedDocumentDto[]
}

export interface SessionDetailDto extends SessionSummaryDto {
  messages: StoredMessageDto[]
}
