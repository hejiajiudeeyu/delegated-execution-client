import { toast } from "sonner"
import { ERROR_MESSAGES, getErrorMessage } from "./error-messages"

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

export interface ApiError {
  /** Canonical code (server `error.code`) or synthetic `NETWORK_ERROR | PARSE_ERROR | HTTP_<N> | ABORTED`. */
  code: string
  /** Localized human-readable message. */
  message: string
  /** Whether the caller could reasonably retry. Falls back to `status >= 500`. */
  retryable: boolean
  /** Original HTTP status (0 for transport-level failures). */
  status: number
  /** Domain prefix of the error code, e.g. `AUTH`, `HOTLINE`. */
  domain: string | null
  /** Raw server body or thrown message, for debugging. */
  raw?: unknown
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiError }

export interface ApiCallOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** Suppress the automatic error toast on failure. */
  silent?: boolean
  /** Per-call override mapping `code -> Chinese message`. */
  errorMap?: Record<string, string>
  /** Used when neither errorMap nor the global registry has a match. */
  fallbackMessage?: string
}

interface RawResponse<T> {
  status: number
  body: T | null
  parseError: boolean
}

async function rawFetch<T>(
  pathname: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<RawResponse<T>> {
  const { method = "GET", body, signal } = options

  const execute = async (token: string | null): Promise<RawResponse<T>> => {
    const headers: Record<string, string> = {}
    if (token) headers["X-Ops-Session"] = token
    if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8"

    const response = await fetch(pathname, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })

    const text = await response.text()
    if (!text) return { status: response.status, body: null, parseError: false }
    try {
      return { status: response.status, body: JSON.parse(text) as T, parseError: false }
    } catch {
      return { status: response.status, body: null, parseError: true }
    }
  }

  let token = getSessionToken()
  let result = await execute(token)
  if (result.status === 401 && pathname !== "/auth/session") {
    const recovered = await restoreSessionToken()
    if (recovered) {
      token = recovered
      result = await execute(token)
    }
  }
  if (result.status === 401) {
    clearSessionToken()
    window.dispatchEvent(new Event("ops:unauthorized"))
  }
  return result
}

interface ServerErrorEnvelope {
  error?: {
    code?: string
    message?: string
    retryable?: boolean
  }
}

function extractDomain(code: string): string | null {
  const idx = code.indexOf("_")
  return idx > 0 ? code.slice(0, idx) : null
}

/**
 * Single source of truth for HTTP calls in ops-console.
 *
 * - Returns a discriminated union: callers write `if (!res.ok) return`.
 * - Parses the canonical `{ error: { code, message, retryable } }` envelope.
 * - Catches network throws as `code: "NETWORK_ERROR"` and JSON parse
 *   failures as `code: "PARSE_ERROR"`; AbortController fires return
 *   `code: "ABORTED"` (no toast).
 * - On 401, recovers the persisted session once before clearing and
 *   dispatching `"ops:unauthorized"`.
 * - Auto-toasts the localized error message; pass `silent: true` to skip.
 */
export async function apiCall<T = unknown>(
  pathname: string,
  options: ApiCallOptions = {}
): Promise<ApiResult<T>> {
  const { silent = false, errorMap, fallbackMessage, ...fetchOpts } = options

  let raw: RawResponse<T>
  try {
    raw = await rawFetch<T>(pathname, fetchOpts)
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError"
    const error: ApiError = {
      code: aborted ? "ABORTED" : "NETWORK_ERROR",
      message: aborted ? "请求已取消" : ERROR_MESSAGES.NETWORK_ERROR,
      retryable: !aborted,
      status: 0,
      domain: null,
      raw: err instanceof Error ? err.message : String(err),
    }
    if (!silent && !aborted) toast.error(error.message)
    return { ok: false, status: 0, error }
  }

  if (raw.status >= 200 && raw.status < 300) {
    return { ok: true, status: raw.status, data: (raw.body ?? null) as T }
  }

  if (raw.parseError) {
    const error: ApiError = {
      code: "PARSE_ERROR",
      message: ERROR_MESSAGES.PARSE_ERROR,
      retryable: false,
      status: raw.status,
      domain: null,
    }
    if (!silent) toast.error(error.message)
    return { ok: false, status: raw.status, error }
  }

  const envelope = (raw.body && typeof raw.body === "object" ? (raw.body as ServerErrorEnvelope).error : null) ?? null
  const code = envelope?.code ?? `HTTP_${raw.status}`
  const localized = errorMap?.[code] ?? getErrorMessage(code, raw.status)
  const userMessage = localized ?? envelope?.message ?? fallbackMessage ?? "请求失败，请稍后重试"
  const retryable = envelope?.retryable ?? raw.status >= 500

  const error: ApiError = {
    code,
    message: userMessage,
    retryable,
    status: raw.status,
    domain: extractDomain(code),
    raw: raw.body,
  }

  if (!silent) toast.error(userMessage)
  return { ok: false, status: raw.status, error }
}
