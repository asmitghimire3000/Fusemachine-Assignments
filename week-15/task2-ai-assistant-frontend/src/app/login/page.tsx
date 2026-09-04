"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { GoogleLogin } from "@react-oauth/google"
import { LockKeyhole } from "lucide-react"

import assistantLogo from "@/app/icon1.png"
import { Loader } from "@/components/ui/loader"
import { loginWithGoogle } from "@/features/auth/api"
import { useAuth } from "@/features/auth/auth-provider"

export default function LoginPage() {
  const router = useRouter()
  const { status, setAuthenticatedUser } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)

  useEffect(() => {
    if (status === "authenticated") router.replace("/chat")
  }, [router, status])

  async function handleGoogleCredential(credential?: string) {
    if (!credential) {
      setError("Google did not return a sign-in credential.")
      return
    }

    setError(null)
    setIsSigningIn(true)
    try {
      const user = await loginWithGoogle(credential)
      setAuthenticatedUser(user)
      router.replace("/chat")
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : "Sign in failed"
      )
      setIsSigningIn(false)
    }
  }

  if (status === "loading" || status === "authenticated" || isSigningIn) {
    return <FullPageLoader message="Signing you in…" />
  }

  return (
    <main className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-background px-5 py-12">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(20,184,166,0.10),transparent_42%)] dark:bg-[radial-gradient(circle_at_top,rgba(20,184,166,0.06),transparent_38%)]"
      />

      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <Image
            alt=""
            className="size-8 rounded-lg"
            height={32}
            priority
            src={assistantLogo}
            width={32}
          />
          <span className="text-sm font-semibold tracking-tight">
            SmartChat AI
          </span>
        </div>

        <section className="rounded-2xl border bg-card p-7 shadow-sm sm:p-8">
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Your conversations, uploaded files, and AI history are all saved
              to your account.
            </p>
          </div>

          <div className="mt-7 flex min-h-10 justify-center">
            <GoogleLogin
              onError={() => setError("Google sign in could not be started.")}
              onSuccess={(response) =>
                handleGoogleCredential(response.credential)
              }
              shape="pill"
              size="large"
              text="continue_with"
              theme="outline"
              width="300"
            />
          </div>

          {error ? (
            <p
              aria-live="polite"
              className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole aria-hidden="true" className="size-3.5" />
            <span>Secure sign-in with Google</span>
          </div>
        </section>

        <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
          By continuing, you agree to use the assistant responsibly.
        </p>
      </div>
    </main>
  )
}

function FullPageLoader({ message }: { message: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader aria-label={message} variant="circular" />
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-xs text-muted-foreground/80">
          The server may take a moment to start up.
        </p>
      </div>
    </main>
  )
}
