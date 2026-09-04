"use client"

import type { VariantProps } from "class-variance-authority"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type PromptSuggestionProps = {
  highlight?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

function PromptSuggestion({
  children,
  variant = "outline",
  size = "lg",
  className,
  ...props
}: PromptSuggestionProps) {
  return (
    <Button
      className={cn("rounded-lg", className)}
      size={size}
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  )
}

export { PromptSuggestion }
