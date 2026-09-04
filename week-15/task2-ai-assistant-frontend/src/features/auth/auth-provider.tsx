"use client"

import { createContext, useContext, useEffect, useState } from "react"

import { AUTH_EXPIRED_EVENT } from "@/lib/api"

import { getCurrentUser, logout as logoutRequest } from "./api"
import type { AuthenticatedUser } from "./types"

type AuthStatus = "loading" | "authenticated" | "unauthenticated"

interface AuthContextValue {
  user: AuthenticatedUser | null
  status: AuthStatus
  setAuthenticatedUser: (user: AuthenticatedUser) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>("loading")

  useEffect(() => {
    getCurrentUser()
      .then((currentUser) => {
        setUser(currentUser)
        setStatus(currentUser ? "authenticated" : "unauthenticated")
      })
      .catch(() => setStatus("unauthenticated"))
  }, [])

  useEffect(() => {
    function clearExpiredSession() {
      setUser(null)
      setStatus("unauthenticated")
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, clearExpiredSession)
    return () =>
      window.removeEventListener(AUTH_EXPIRED_EVENT, clearExpiredSession)
  }, [])

  function setAuthenticatedUser(authenticatedUser: AuthenticatedUser) {
    setUser(authenticatedUser)
    setStatus("authenticated")
  }

  async function logout() {
    await logoutRequest()
    setUser(null)
    setStatus("unauthenticated")
  }

  return (
    <AuthContext.Provider
      value={{ user, status, setAuthenticatedUser, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used inside AuthProvider")
  return context
}
