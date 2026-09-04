export type DocumentStatus = "uploading" | "ready" | "error"

export interface IngestionResult {
  document_id: string
  document_name: string
  character_count: number
  chunk_count: number
  expires_at: string
}

export interface DocumentUploadResult {
  document_name: string
  status: "success" | "error"
  ingestion: IngestionResult | null
  error: string | null
}

export interface BatchIngestionResult {
  total_files: number
  successful_files: number
  failed_files: number
  files: DocumentUploadResult[]
}

export interface SessionDocument {
  id: string
  name: string
  status: DocumentStatus
  characterCount?: number
  chunkCount?: number
  uploadedAt: string
  error?: string
}
