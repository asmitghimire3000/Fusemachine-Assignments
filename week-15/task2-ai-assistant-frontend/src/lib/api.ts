export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "/backend/api/v1"
).replace(/\/$/, "")

export const AUTH_EXPIRED_EVENT = "assistant:auth-expired"

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export async function throwApiError(response: Response): Promise<never> {
  const body: unknown = await response.json().catch(() => null)
  const message =
    isErrorBody(body) && typeof body.detail === "string"
      ? body.detail
      : "The API request failed"

  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }
  throw new ApiError(message, response.status)
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
  })
}

function isErrorBody(value: unknown): value is { detail?: unknown } {
  return typeof value === "object" && value !== null
}
