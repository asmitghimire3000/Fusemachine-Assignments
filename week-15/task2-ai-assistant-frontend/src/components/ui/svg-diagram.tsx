import { cn } from "@/lib/utils"

interface SvgDiagramProps {
  svg: string
  className?: string
}

function SvgDiagram({ svg, className }: SvgDiagramProps) {
  return (
    <div
      aria-label="Generated diagram"
      className={cn(
        "overflow-x-auto p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full",
        className
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
    />
  )
}

export { SvgDiagram }
