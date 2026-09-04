import "client-only"

import { apiFetch, throwApiError } from "@/lib/api"

import type { AuthenticatedUser, LoginResponse } from "./types"

export async function loginWithGoogle(
  credential: string
): Promise<AuthenticatedUser> {
  const response = await apiFetch("/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  })

  if (!response.ok) await throwApiError(response)
  return ((await response.json()) as LoginResponse).user
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const response = await apiFetch("/auth/me")
  if (response.status === 401) return null
  if (!response.ok) await throwApiError(response)
  return (await response.json()) as AuthenticatedUser
}

export async function logout(): Promise<void> {
  const response = await apiFetch("/auth/logout", { method: "POST" })
  if (!response.ok) await throwApiError(response)
}
