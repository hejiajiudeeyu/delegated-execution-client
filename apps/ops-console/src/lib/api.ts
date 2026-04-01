const SESSION_KEY = "rsp.ops.session"

export function getSessionToken(): string | null {
  return sessionStorage.getItem(SESSION_KEY)
}

export function setSessionToken(token: string): void {
  sessionStorage.setItem(SESSION_KEY, token)
}

export function clearSessionToken(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

export interface ApiResponse<T = unknown> {
  status: number
  body: T | null
}

interface SessionRecoveryResponse {
  recoverable_session?: {
    token?: string | null
    expires_at?: string | null
  } | null
}

async function parseJsonBody<T>(response: Response): Promise<T | null> {
  const text = await response.text()
  return text ? (JSON.parse(text) as T) : null
}

export async function restoreSessionToken(): Promise<string | null> {
  const response = await fetch("/auth/session")
  const body = await parseJsonBody<SessionRecoveryResponse>(response)
  const token = body?.recoverable_session?.token ?? null
  if (response.status === 200 && token) {
    setSessionToken(token)
    return token
  }
  return null
}

export async function requestJson<T = unknown>(
  pathname: string,
  options: {
    method?: string
    body?: unknown
    signal?: AbortSignal
  } = {}
): Promise<ApiResponse<T>> {
  const { method = "GET", body, signal } = options
  const execute = async (token: string | null): Promise<ApiResponse<T>> => {
    const headers: Record<string, string> = {}
    if (token) {
      headers["X-Ops-Session"] = token
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8"
    }
    const response = await fetch(pathname, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
    return {
      status: response.status,
      body: await parseJsonBody<T>(response),
    }
  }

  let token = getSessionToken()
  let result = await execute(token)
  if (result.status === 401 && pathname !== "/auth/session") {
    const recoveredToken = await restoreSessionToken()
    if (recoveredToken) {
      token = recoveredToken
      result = await execute(token)
    }
  }
  if (result.status === 401) {
    clearSessionToken()
    window.dispatchEvent(new Event("ops:unauthorized"))
  }
  return result
}
