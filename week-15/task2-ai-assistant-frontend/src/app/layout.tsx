import type { Metadata } from "next"
import { DM_Sans, JetBrains_Mono } from "next/font/google"

import "./globals.css"
import { Providers } from "@/app/providers"
import { cn } from "@/lib/utils"

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "SmartChat AI",
  description: "Upload documents, ask questions, and get AI-powered answers with source citations.",
  appleWebApp: {
    title: "SmartChat AI",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans antialiased", dmSans.variable, fontMono.variable)}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
