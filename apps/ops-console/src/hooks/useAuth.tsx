import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { clearSessionToken, requestJson, restoreSessionToken, setSessionToken } from "@/lib/api"

export interface AuthState {
  configured: boolean
  locked: boolean
  authenticated: boolean
  setup_required: boolean
  expires_at: string | null
}

export interface StatusData {
  ok: boolean
  auth: AuthState
  caller?: {
    registered?: boolean
    registration_mode?: string | null
    api_key_configured?: boolean
    caller_id?: string | null
    contact_email?: string | null
  }
  config?: Record<string, unknown>
  responder?: {
    enabled: boolean
    responder_id: string | null
    hotline_count: number
    pending_review_count: number
  }
  runtime?: {
    caller?: { health?: { status: number; body: { ok: boolean; [k: string]: unknown } | null } }
    responder?: { health?: { status: number; body: { ok: boolean; [k: string]: unknown } | null } | null }
    relay?: { health?: { status: number; body: { ok: boolean; [k: string]: unknown } | null } }
  }
}

interface AuthContextValue {
  status: StatusData | null
  loading: boolean
  refresh: () => Promise<void>
  login: (passphrase: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  setup: (passphrase: string) => Promise<{ ok: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      if (!sessionStorage.getItem("rsp.ops.session")) {
        await restoreSessionToken()
      }
      const res = await requestJson<StatusData>("/status")
      if (res.body) setStatus(res.body)
    } catch {
      /* network error — keep previous state */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener("ops:unauthorized", handler)
    return () => window.removeEventListener("ops:unauthorized", handler)
  }, [refresh])

  const login = useCallback(async (passphrase: string) => {
    const res = await requestJson<{ token?: string; error?: { message: string } }>(
      "/auth/session/login",
      { method: "POST", body: { passphrase } }
    )
    if (res.status === 200 && res.body?.token) {
      setSessionToken(res.body.token)
      await refresh()
      return { ok: true }
    }
    return { ok: false, error: res.body?.error?.message ?? "认证失败" }
  }, [refresh])

  const logout = useCallback(async () => {
    await requestJson("/auth/session/logout", { method: "POST" })
    clearSessionToken()
    await refresh()
  }, [refresh])

  const setup = useCallback(async (passphrase: string) => {
    const setupRes = await requestJson("/setup", { method: "POST" })
    if (setupRes.status !== 200) {
      return { ok: false, error: "Setup 失败" }
    }
    const keyRes = await requestJson<{ token?: string; error?: { message: string } }>(
      "/auth/session/setup",
      { method: "POST", body: { passphrase } }
    )
    if ((keyRes.status === 200 || keyRes.status === 201) && keyRes.body?.token) {
      setSessionToken(keyRes.body.token)
      await refresh()
      return { ok: true }
    }
    return { ok: false, error: keyRes.body?.error?.message ?? "Setup 失败" }
  }, [refresh])

  return (
    <AuthContext.Provider value={{ status, loading, refresh, login, logout, setup }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
