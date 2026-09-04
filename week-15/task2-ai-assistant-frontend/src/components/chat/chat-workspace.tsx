"use client"

import { useState, type FormEvent, type KeyboardEvent } from "react"
import Image from "next/image"
import {
  ArrowUp,
  Check,
  CircleAlert,
  FileText,
  FileUp,
  Paperclip,
  Square,
} from "lucide-react"

import assistantLogo from "@/app/icon1.png"
import { ChatMessage } from "@/components/chat/chat-message"
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container"
import {
  FileUpload,
  FileUploadContent,
  FileUploadTrigger,
} from "@/components/ui/file-upload"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Loader } from "@/components/ui/loader"
import { PromptSuggestion } from "@/components/ui/prompt-suggestion"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

import type {
  ChatMessage as ChatMessageType,
  MessageAttachment,
} from "@/features/chat/types"
import { uploadDocuments } from "@/features/documents/api"
import type { SessionDocument } from "@/features/documents/types"

interface ChatWorkspaceProps {
  messages: ChatMessageType[]
  isStreaming: boolean
  sessionTitle?: string
  isLoading: boolean
  error: string | null
  onSendMessage: (
    message: string,
    attachments?: MessageAttachment[]
  ) => void
  onStopGeneration: () => void
}

export function ChatWorkspace({
  messages,
  isStreaming,
  sessionTitle,
  isLoading,
  error,
  onSendMessage,
  onStopGeneration,
}: ChatWorkspaceProps) {
  const [message, setMessage] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [uploadFailed, setUploadFailed] = useState(false)

  const [uploadedDocuments, setUploadedDocuments] = useState<
    SessionDocument[]
  >([])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!message.trim() || isStreaming || isUploading) return

    const attachments = uploadedDocuments
      .filter((document) => document.status === "ready")
      .map((document) => ({
        id: document.id,
        name: document.name,
        chunkCount: document.chunkCount ?? 0,
      }))

    onSendMessage(message, attachments)

    setMessage("")
    setUploadedDocuments([])
    setUploadMessage(null)
    setUploadFailed(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  async function handleFilesSelected(files: File[]) {
    if (!files.length) return

    const pendingDocuments = files.map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}`,
      name: file.name,
      status: "uploading" as const,
      uploadedAt: new Date().toISOString(),
    }))

    setUploadedDocuments((current) => [
      ...current,
      ...pendingDocuments,
    ])

    setIsUploading(true)
    setUploadFailed(false)

    setUploadMessage(
      `Uploading ${files.length} document${files.length === 1 ? "" : "s"
      }...`
    )

    try {
      const result = await uploadDocuments(files)

      const failedNames = result.files
        .filter((file) => file.status === "error")
        .map((file) => file.document_name)

      setUploadedDocuments((current) =>
        current.map((document) => {
          const resultIndex = pendingDocuments.findIndex(
            (pending) => pending.id === document.id
          )

          if (resultIndex === -1) return document

          const fileResult = result.files[resultIndex]

          if (
            fileResult.status === "error" ||
            !fileResult.ingestion
          ) {
            return {
              ...document,
              status: "error",
              error: fileResult.error ?? "Upload failed",
            }
          }

          return {
            ...document,
            id: fileResult.ingestion.document_id,
            status: "ready",
            characterCount:
              fileResult.ingestion.character_count,
            chunkCount: fileResult.ingestion.chunk_count,
          }
        })
      )

      setUploadFailed(result.failed_files > 0)

      setUploadMessage(
        result.failed_files === 0
          ? `${result.successful_files} document${result.successful_files === 1 ? "" : "s"
          } ready`
          : `${result.successful_files} ready; failed: ${failedNames.join(
            ", "
          )}`
      )
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Document upload failed"

      setUploadedDocuments((current) =>
        current.map((document) =>
          pendingDocuments.some(
            (pending) => pending.id === document.id
          )
            ? {
              ...document,
              status: "error",
              error: errorMessage,
            }
            : document
        )
      )

      setUploadFailed(true)
      setUploadMessage(errorMessage)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger aria-label="Open chat sessions" />

          <Separator
            className="mr-1 h-4 mt-2"
            orientation="vertical"
          />

          <h1 className="truncate text-sm font-semibold">
            {sessionTitle ?? "SmartChat AI"}
          </h1>
        </div>
      </header>

      {/* Main chat area */}
      <ChatContainerRoot className="min-h-0 flex-1 px-4">
        {!isLoading && messages.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="w-full max-w-3xl pb-20 text-center">
              <Image
                alt=""
                className="mx-auto size-10 rounded-full"
                height={40}
                priority
                src={assistantLogo}
                width={40}
              />

              <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                What would you like to know?
              </h2>

              <p className="mt-2 text-sm text-muted-foreground">
                Start a conversation or attach a document to get started.
              </p>

              <div className="mx-auto mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
                <PromptSuggestion
                  disabled={isStreaming}
                  onClick={() =>
                    onSendMessage(
                      "Explain how vector search and reranking pipelines work"
                    )
                  }
                  size="sm"
                >
                  Vector search &amp; reranking
                </PromptSuggestion>

                <PromptSuggestion
                  disabled={isStreaming}
                  onClick={() =>
                    onSendMessage(
                      "What happened in the latest Avengers movie?"
                    )
                  }
                  size="sm"
                >
                  Latest Avengers movie
                </PromptSuggestion>

                <PromptSuggestion
                  disabled={isStreaming}
                  onClick={() =>
                    onSendMessage(
                      "What is the current weather in New York City?"
                    )
                  }
                  size="sm"
                >
                  Weather in NYC
                </PromptSuggestion>

                <PromptSuggestion
                  disabled={isStreaming}
                  onClick={() =>
                    onSendMessage(
                      "Calculate the square root of 2401."
                    )
                  }
                  size="sm"
                >
                  Square root of 2401
                </PromptSuggestion>
              </div>
            </div>
          </div>
        ) : !isLoading ? (
          <ChatContainerContent className="mx-auto w-full max-w-3xl gap-8 py-6">
            {messages.map((chatMessage) => (
              <ChatMessage
                key={chatMessage.id}
                message={chatMessage}
                onSuggestionSelect={onSendMessage}
                suggestionsDisabled={isStreaming}
              />
            ))}

            <ChatContainerScrollAnchor />
          </ChatContainerContent>
        ) : null}
      </ChatContainerRoot>

      {/* Input */}
      <div className="shrink-0 px-3 pb-2 sm:px-6">
        {error ? (
          <p
            aria-live="polite"
            className="mx-auto mb-2 max-w-3xl text-center text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <form
          className="mx-auto max-w-3xl"
          onSubmit={handleSubmit}
        >
          <FileUpload
            accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf"
            disabled={isUploading}
            onFilesAdded={handleFilesSelected}
          >
            <FileUploadContent>
              <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-8 py-6 shadow-lg">
                <FileUp
                  aria-hidden="true"
                  className="size-7"
                />

                <p className="font-medium">
                Drop files here to upload
              </p>

              <p className="text-sm text-muted-foreground">
                Supports Markdown, Text, and PDF
              </p>
              </div>
            </FileUploadContent>

            <InputGroup className="rounded-lg bg-card shadow-xs">
              {uploadedDocuments.length ? (
                <InputGroupAddon
                  align="block-start"
                  className="flex-wrap gap-2"
                >
                  {uploadedDocuments.map((document) => (
                    <DocumentChip
                      document={document}
                      key={document.id}
                    />
                  ))}
                </InputGroupAddon>
              ) : null}

              <label
                className="sr-only"
                htmlFor="chat-message"
              >
                Message the assistant
              </label>

              <InputGroupTextarea
                className="min-h-16 px-3"
                disabled={isStreaming}
                id="chat-message"
                onChange={(event) =>
                  setMessage(event.target.value)
                }
                onKeyDown={handleKeyDown}
                placeholder="Type your message here..."
                rows={2}
                value={message}
              />

              <InputGroupAddon
                align="block-end"
                className="justify-between"
              >
                <FileUploadTrigger asChild>
                  <InputGroupButton
                    aria-label={
                      isUploading
                        ? "Uploading documents"
                        : "Attach documents"
                    }
                    disabled={isUploading}
                    size="icon-sm"
                    variant="ghost"
                  >
                    {isUploading ? (
                      <Loader
                        size="sm"
                        variant="circular"
                      />
                    ) : (
                      <Paperclip aria-hidden="true" />
                    )}
                  </InputGroupButton>
                </FileUploadTrigger>

                {isStreaming ? (
                  <InputGroupButton
                    aria-label="Stop generating"
                    onClick={onStopGeneration}
                    size="icon-sm"
                    type="button"
                  >
                    <Square
                      aria-hidden="true"
                      className="fill-current"
                    />
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    aria-label="Send message"
                    disabled={
                      !message.trim() || isUploading
                    }
                    size="icon-sm"
                    type="submit"
                  >
                    <ArrowUp aria-hidden="true" />
                  </InputGroupButton>
                )}
              </InputGroupAddon>
            </InputGroup>
          </FileUpload>
        </form>

        {uploadMessage ? (
          <p
            aria-live="polite"
            className={
              uploadFailed
                ? "mt-2 text-center text-xs text-destructive"
                : "mt-2 text-center text-xs text-muted-foreground"
            }
          >
            {uploadMessage}
          </p>
        ) : null}

        <p className="mt-2 text-center text-xs text-muted-foreground">
          AI can make mistakes. Check important information.
        </p>
      </div>

      {/* Server waking/loading state */}
      {isLoading ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="-translate-y-8 flex flex-col items-center gap-3 text-center">
            <Loader
              aria-label="Loading conversation"
              variant="circular"
            />

            <p className="text-sm text-muted-foreground">
              Connecting to the server…
            </p>

            <p className="text-xs text-muted-foreground/80">
              This may take a moment after being idle.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function DocumentChip({
  document,
}: {
  document: SessionDocument
}) {
  return (
    <div className="flex max-w-56 min-w-0 items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-sm">
      <FileText
        aria-hidden="true"
        className="size-4 shrink-0"
      />

      <span className="truncate">{document.name}</span>

      {document.status === "uploading" ? (
        <Loader
          className="shrink-0"
          size="sm"
          variant="circular"
        />
      ) : document.status === "ready" ? (
        <Check
          aria-label="Upload complete"
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : (
        <CircleAlert
          aria-label={document.error ?? "Upload failed"}
          className="size-4 shrink-0 text-destructive"
        />
      )}
    </div>
  )
}
