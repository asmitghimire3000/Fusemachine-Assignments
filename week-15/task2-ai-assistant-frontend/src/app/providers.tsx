"use client"

import { GoogleOAuthProvider } from "@react-oauth/google"
import { Toaster } from "sonner"

import { ThemeProvider } from "@/components/theme-provider"
import { AuthProvider } from "@/features/auth/auth-provider"

const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ""

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <ThemeProvider>
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </GoogleOAuthProvider>
  )
}
