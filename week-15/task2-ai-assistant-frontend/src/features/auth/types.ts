export interface AuthenticatedUser {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
}

export interface LoginResponse {
  user: AuthenticatedUser
}
