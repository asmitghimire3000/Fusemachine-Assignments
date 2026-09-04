import "client-only"

import { apiFetch, throwApiError } from "@/lib/api"

import type { BatchIngestionResult } from "./types"

export async function uploadDocuments(
  files: File[],
  signal?: AbortSignal
): Promise<BatchIngestionResult> {
  const formData = new FormData()
  files.forEach((file) => formData.append("files", file))

  const response = await apiFetch("/documents/batch", {
    method: "POST",
    body: formData,
    signal,
  })

  if (!response.ok) {
    await throwApiError(response)
  }

  return (await response.json()) as BatchIngestionResult
}
