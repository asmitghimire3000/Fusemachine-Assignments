"use client"

import { memo, useEffect, useId, useRef, useState } from "react"
import { useTheme } from "next-themes"

import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block"
import { Skeleton } from "@/components/ui/skeleton"
import { SvgDiagram } from "@/components/ui/svg-diagram"

interface MermaidDiagramProps {
  code: string
}

interface RenderResult {
  key: string
  svg?: string
  error?: string
}

const MermaidDiagram = memo(function MermaidDiagram({
  code,
}: MermaidDiagramProps) {
  const { resolvedTheme } = useTheme()
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "")
  const renderCount = useRef(0)
  const theme = resolvedTheme === "dark" ? "dark" : "default"
  const renderKey = `${theme}:${code}`
  const [result, setResult] = useState<RenderResult>({ key: "" })

  useEffect(() => {
    let cancelled = false
    renderCount.current += 1
    const diagramId = `mermaid-${baseId}-${renderCount.current}`

    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme,
          flowchart: {
            useMaxWidth: true,
            wrappingWidth: 500,
          },
        })

        const { svg } = await mermaid.render(diagramId, code)
        if (!cancelled) setResult({ key: renderKey, svg })
      } catch (error) {
        if (!cancelled) {
          setResult({
            key: renderKey,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    renderDiagram()
    return () => {
      cancelled = true
    }
  }, [baseId, code, renderKey, theme])

  if (result.key !== renderKey) {
    return <Skeleton className="my-4 h-40 w-full" />
  }

  if (result.error || !result.svg) {
    return (
      <div className="my-4">
        <p className="mb-2 text-sm text-destructive">
          Could not render this diagram. Showing its Mermaid source instead.
        </p>
        <CodeBlock>
          <CodeBlockCode code={code} language="mermaid" />
        </CodeBlock>
      </div>
    )
  }

  return (
    <div className="my-4 overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-3 py-2 font-mono text-xs text-muted-foreground">
        mermaid
      </div>
      <SvgDiagram svg={result.svg} />
    </div>
  )
})

MermaidDiagram.displayName = "MermaidDiagram"

export { MermaidDiagram }
