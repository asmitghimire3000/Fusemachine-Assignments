import { cn } from "@/lib/utils"
import { memo, useMemo } from "react"
import ReactMarkdown, { Components } from "react-markdown"

import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"

import "katex/dist/katex.min.css"

import { CodeBlock, CodeBlockCode } from "./code-block"
import { MermaidDiagram } from "./mermaid-diagram"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext"

  const match = className.match(/language-(\w+)/)
  return match ? match[1] : "plaintext"
}

function normalizeMathDelimiters(markdown: string): string {
  const replacements: Record<string, string> = {
    "\\(": "$",
    "\\)": "$",
    "\\[": "$$",
    "\\]": "$$",
  }
  let normalized = ""
  let position = 0

  while (position < markdown.length) {
    const character = markdown[position]

    // Preserve inline and fenced code exactly as the model produced it.
    if (character === "`" || character === "~") {
      let delimiterEnd = position + 1
      while (markdown[delimiterEnd] === character) delimiterEnd += 1

      const delimiter = markdown.slice(position, delimiterEnd)
      const isCodeDelimiter = character === "`" || delimiter.length >= 3
      const closingPosition = isCodeDelimiter
        ? markdown.indexOf(delimiter, delimiterEnd)
        : -1

      if (closingPosition !== -1) {
        const codeEnd = closingPosition + delimiter.length
        normalized += markdown.slice(position, codeEnd)
        position = codeEnd
        continue
      }
    }

    const latexDelimiter = markdown.slice(position, position + 2)
    const replacement = replacements[latexDelimiter]
    if (replacement) {
      normalized += replacement
      position += 2
      continue
    }

    normalized += character
    position += 1
  }

  return normalized
}

const INITIAL_COMPONENTS: Partial<Components> = {
  h1({ children }) {
    return (
      <h1 className="mt-8 mb-3 text-2xl font-semibold tracking-tight first:mt-0">
        {children}
      </h1>
    )
  },

  h2({ children }) {
    return (
      <h2 className="mt-7 mb-3 text-xl font-semibold tracking-tight first:mt-0">
        {children}
      </h2>
    )
  },

  h3({ children }) {
    return (
      <h3 className="mt-6 mb-2 text-base font-semibold first:mt-0">
        {children}
      </h3>
    )
  },

  p({ children }) {
    return <p className="my-3 leading-7 first:mt-0 last:mb-0">{children}</p>
  },

  ul({ children }) {
    return <ul className="my-3 list-disc space-y-1.5 pl-6">{children}</ul>
  },

  ol({ children }) {
    return <ol className="my-3 list-decimal space-y-1.5 pl-6">{children}</ol>
  },

  li({ children }) {
    return <li className="pl-1 leading-7">{children}</li>
  },

  blockquote({ children }) {
    return (
      <blockquote className="my-4 border-l-2 pl-4 text-muted-foreground">
        {children}
      </blockquote>
    )
  },

  table({ children }) {
    return (
      <div className="my-5 max-w-full overflow-x-auto rounded-lg border">
        <table className="w-full min-w-max border-collapse text-left text-sm">
          {children}
        </table>
      </div>
    )
  },

  th({ children }) {
    return (
      <th className="border-b bg-muted/60 px-3 py-2.5 font-semibold">
        {children}
      </th>
    )
  },

  td({ children }) {
    return <td className="border-b px-3 py-2.5 align-top">{children}</td>
  },

  hr() {
    return <hr className="my-6" />
  },

  a({ children, href }) {
    return (
      <a
        className="font-medium underline underline-offset-4"
        href={href}
        rel="noreferrer"
        target="_blank"
      >
        {children}
      </a>
    )
  },

  code({ className, children, ...props }) {
    const isInline =
      !props.node?.position?.start.line ||
      props.node?.position?.start.line === props.node?.position?.end.line

    if (isInline) {
      return (
        <span
          className={cn(
            "rounded-sm bg-primary-foreground px-1 font-mono text-sm",
            className
          )}
        >
          {children}
        </span>
      )
    }

    const language = extractLanguage(className)

    if (language === "mermaid") {
      return <MermaidDiagram code={String(children).trim()} />
    }

    return (
      <CodeBlock className={className}>
        <CodeBlockCode code={String(children)} language={language} />
      </CodeBlock>
    )
  },

  pre({ children }) {
    return <>{children}</>
  },
}

function MarkdownComponent({
  children,
  className,
  components = INITIAL_COMPONENTS,
}: MarkdownProps) {
  const normalizedMarkdown = useMemo(
    () => normalizeMathDelimiters(children),
    [children]
  )

  return (
    <div
      className={cn(
        "[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
