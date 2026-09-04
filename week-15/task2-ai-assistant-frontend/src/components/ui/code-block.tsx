"use client"

import React, { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"
import { useTheme } from "next-themes"
import { codeToHtml } from "shiki"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip border",
        "rounded-xl border-border bg-card text-card-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlockCode({
  code,
  language = "tsx",
  theme,
  className,
  ...props
}: CodeBlockCodeProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)
  const { resolvedTheme } = useTheme()
  const syntaxTheme =
    theme ?? (resolvedTheme === "dark" ? "github-dark" : "github-light")

  useEffect(() => {
    let cancelled = false

    async function highlight() {
      if (!code) {
        if (!cancelled) setHighlightedHtml("<pre><code></code></pre>")
        return
      }

      const html = await codeToHtml(code, {
        lang: language,
        theme: syntaxTheme,
      })
      if (!cancelled) setHighlightedHtml(html)
    }

    highlight()

    return () => {
      cancelled = true
    }
  }, [code, language, syntaxTheme])

  const classNames = cn(
    "w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
    className
  )

  return (
    <div {...props}>
      <div className="flex h-10 items-center justify-between border-b px-3">
        <span className="font-mono text-xs text-muted-foreground">
          {language}
        </span>
        <CopyCodeButton code={code} />
      </div>

      {highlightedHtml ? (
        <div
          className={classNames}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <div className={classNames}>
          <pre>
            <code>{code}</code>
          </pre>
        </div>
      )}
    </div>
  )
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const label = copied ? "Copied" : "Copy code"

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            className="size-7"
            onClick={copyCode}
            size="icon-xs"
            variant="ghost"
          >
            {copied ? (
              <Check aria-hidden="true" className="size-3.5" />
            ) : (
              <Copy aria-hidden="true" className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }
