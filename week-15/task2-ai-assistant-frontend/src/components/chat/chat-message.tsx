"use client"

import { useState } from "react"
import { Check, ChevronDown, Copy, FileText, ListChecks } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Loader } from "@/components/ui/loader"
import { Markdown } from "@/components/ui/markdown"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ui/message"
import { PromptSuggestion } from "@/components/ui/prompt-suggestion"
import {
  Steps,
  StepsContent,
  StepsItem,
  StepsTrigger,
} from "@/components/ui/steps"
import { Tool } from "@/components/ui/tool"
import type {
  AssistantMessage,
  ChatMessage as ChatMessageType,
  MessageAttachment,
  SourceReference,
  ToolExecution,
} from "@/features/chat/types"

interface ChatMessageProps {
  message: ChatMessageType
  suggestionsDisabled?: boolean
  onSuggestionSelect: (suggestion: string) => void
}

export function ChatMessage({
  message,
  suggestionsDisabled = false,
  onSuggestionSelect,
}: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <Message className="justify-end">
        <div className="flex max-w-[85%] flex-col items-end">
          <div className="max-w-full rounded-lg bg-muted px-3 py-2.5 text-sm break-words text-foreground">
            {message.attachments?.length ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {message.attachments.map((attachment) => (
                  <MessageAttachmentCard
                    attachment={attachment}
                    key={attachment.id}
                  />
                ))}
              </div>
            ) : null}
            <p className="px-1 whitespace-pre-wrap">{message.content}</p>
          </div>
          <MessageActions className="mt-1">
            <CopyMessageButton content={message.content} />
          </MessageActions>
        </div>
      </Message>
    )
  }

  return (
    <Message>
      <div className="min-w-0 flex-1">
        <AssistantActivity message={message} />

        {message.content ? (
          <MessageContent
            className="max-w-none bg-transparent p-0 text-sm leading-7"
            markdown
          >
            {message.content}
          </MessageContent>
        ) : null}

        {message.status === "error" ? (
          <p className="mt-2 text-sm text-destructive">Response interrupted</p>
        ) : null}

        {message.content ? (
          <MessageActions className="mt-1">
            <CopyMessageButton content={message.content} />
          </MessageActions>
        ) : null}

        {message.status === "complete" && message.followUpQuestions?.length ? (
          <div
            aria-label="Suggested follow-up questions"
            className="mt-3 flex flex-wrap gap-2"
          >
            {message.followUpQuestions.map((question) => (
              <PromptSuggestion
                className="h-auto min-h-9 max-w-full justify-start py-2 text-left whitespace-normal"
                disabled={suggestionsDisabled}
                key={question}
                onClick={() => onSuggestionSelect(question)}
                size="sm"
              >
                {question}
              </PromptSuggestion>
            ))}
          </div>
        ) : null}
      </div>
    </Message>
  )
}

function MessageAttachmentCard({
  attachment,
}: {
  attachment: MessageAttachment
}) {
  return (
    <div className="flex max-w-64 min-w-0 items-center gap-2 rounded-xl border bg-background/70 px-2.5 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <FileText aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate font-medium">{attachment.name}</span>
        {attachment.chunkCount ? (
          <span className="block text-xs text-muted-foreground">
            {attachment.chunkCount} passages indexed
          </span>
        ) : null}
      </span>
    </div>
  )
}

function CopyMessageButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  async function copyMessage() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const label = copied ? "Copied" : "Copy message"

  return (
    <MessageAction tooltip={label}>
      <Button
        aria-label={label}
        className="size-8 cursor-pointer"
        onClick={copyMessage}
        size="icon"
        variant="ghost"
      >
        {copied ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </Button>
    </MessageAction>
  )
}

function AssistantActivity({ message }: { message: AssistantMessage }) {
  const activities = message.activities ?? []
  const hasDetails =
    activities.length > 0 ||
    message.tools.length > 0 ||
    message.sources.length > 0 ||
    Boolean(message.model)

  if (!hasDetails) return null

  const isStreaming = message.status === "streaming"
  const summary = isStreaming
    ? (message.activity ?? "Working")
    : buildActivitySummary(message)

  return (
    <Steps className="mb-4" defaultOpen={isStreaming} key={message.status}>
      <StepsTrigger
        leftIcon={
          isStreaming ? (
            <Loader size="sm" variant="pulse-dot" />
          ) : (
            <ListChecks aria-hidden="true" className="size-4" />
          )
        }
      >
        {summary}
      </StepsTrigger>
      <StepsContent>
        {activities.map((activity, index) => (
          <StepsItem key={`${message.id}-activity-${index}`}>
            {activity}
          </StepsItem>
        ))}

        {message.tools.map((tool, index) => (
          <Tool
            className="mt-0"
            defaultOpen={!tool.success}
            key={`${message.id}-tool-${index}`}
            toolPart={toToolPart(tool)}
          />
        ))}

        {message.sources.map((source) => (
          <SourcePassage key={source.chunk_id} source={source} />
        ))}

        {message.model ? (
          <StepsItem>
            Model: {message.model}
            {message.usedFallback ? " (fallback)" : ""}
          </StepsItem>
        ) : null}
      </StepsContent>
    </Steps>
  )
}

function SourcePassage({ source }: { source: SourceReference }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-start gap-2 text-left">
        <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
          [{source.citation_number ?? source.chunk_index + 1}]{" "}
          {source.document_name} · Passage {source.chunk_index + 1}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pl-6">
        <Markdown className="prose max-w-none text-sm leading-6 text-foreground">
          {source.text}
        </Markdown>
      </CollapsibleContent>
    </Collapsible>
  )
}

function buildActivitySummary(message: AssistantMessage): string {
  const details = []
  if (message.tools.length) {
    details.push(
      `${message.tools.length} tool${message.tools.length === 1 ? "" : "s"}`
    )
  }
  if (message.sources.length) {
    details.push(
      `${message.sources.length} source${message.sources.length === 1 ? "" : "s"}`
    )
  }

  return details.length ? `Used ${details.join(" and ")}` : "Activity"
}

function toToolPart(tool: ToolExecution) {
  return {
    type: tool.name,
    state: tool.success
      ? ("output-available" as const)
      : ("output-error" as const),
    input: tool.arguments,
    output: tool.success ? parseToolOutput(tool.output) : undefined,
    errorText: tool.success ? undefined : tool.output,
  }
}

function parseToolOutput(output: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(output)
    return isRecord(parsed) ? parsed : { result: parsed }
  } catch {
    return { result: output }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
