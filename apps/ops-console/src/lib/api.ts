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

export async function requestJson<T = unknown>(
  pathname: string,
  options: {
    method?: string
    body?: unknown
    signal?: AbortSignal
  } = {}
): Promise<ApiResponse<T>> {
  const { method = "GET", body, signal } = options
  const token = getSessionToken()
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

  const text = await response.text()
  if (response.status === 401) {
    clearSessionToken()
    window.dispatchEvent(new Event("ops:unauthorized"))
  }
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as T) : null,
  }
}
