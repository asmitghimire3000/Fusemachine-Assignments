"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { ChatSidebar } from "@/components/chat/chat-sidebar"
import { ChatWorkspace } from "@/components/chat/chat-workspace"
import { Loader } from "@/components/ui/loader"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { useAuth } from "@/features/auth/auth-provider"
import { useChatSessions } from "@/features/chat/use-chat-sessions"

export default function ChatPage() {
  const router = useRouter()
  const { status, user, logout } = useAuth()

  const chat = useChatSessions(status === "authenticated")

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login")
    }
  }, [router, status])

  if (status !== "authenticated" || !user) {
    const isRedirecting = status === "unauthenticated"

    return (
      <main className="flex min-h-svh items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center text-center">
          <Loader
            aria-label={
              isRedirecting
                ? "Redirecting to login"
                : "Loading your workspace"
            }
            variant="circular"
          />

          <h1 className="mt-5 text-base font-medium">
            {isRedirecting
              ? "Taking you to sign in"
              : "Preparing your workspace"}
          </h1>

          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {isRedirecting
              ? "Your session is no longer active. Redirecting you to the login page."
              : "Verifying your session and preparing your workspace."}
          </p>

          {!isRedirecting ? (
            <p className="mt-1 text-xs text-muted-foreground/70">
              This should only take a moment.
            </p>
          ) : null}
        </div>
      </main>
    )
  }

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <ChatSidebar
        activeSessionId={chat.activeSessionId}
        onCreateSession={chat.createSession}
        onDeleteSession={chat.deleteSession}
        onLogout={logout}
        onRenameSession={chat.renameSession}
        onSelectSession={chat.selectSession}
        sessions={chat.sessions}
        user={user}
      />

      <SidebarInset className="h-full min-h-0 overflow-hidden">
        <ChatWorkspace
          error={chat.error}
          isLoading={chat.isLoading}
          isStreaming={chat.isStreaming}
          messages={chat.activeSession?.messages ?? []}
          onSendMessage={chat.sendMessage}
          onStopGeneration={chat.stopGeneration}
          sessionTitle={chat.activeSession?.title}
        />
      </SidebarInset>
    </SidebarProvider>
  )
}