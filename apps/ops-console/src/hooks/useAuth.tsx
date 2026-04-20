import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { apiCall, clearSessionToken, restoreSessionToken, setSessionToken } from "@/lib/api"

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
    if (!sessionStorage.getItem("rsp.ops.session")) {
      await restoreSessionToken()
    }
    const res = await apiCall<StatusData>("/status", { silent: true })
    if (res.ok && res.data) setStatus(res.data)
    setLoading(false)
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
    const res = await apiCall<{ token?: string }>(
      "/auth/session/login",
      { method: "POST", body: { passphrase }, silent: true }
    )
    if (res.ok && res.data?.token) {
      setSessionToken(res.data.token)
      await refresh()
      return { ok: true }
    }
    return { ok: false, error: res.ok ? "认证失败" : res.error.message }
  }, [refresh])

  const logout = useCallback(async () => {
    await apiCall("/auth/session/logout", { method: "POST", silent: true })
    clearSessionToken()
    await refresh()
  }, [refresh])

  const setup = useCallback(async (passphrase: string) => {
    const setupRes = await apiCall("/setup", { method: "POST", silent: true })
    if (!setupRes.ok) {
      return { ok: false, error: setupRes.error.message }
    }
    const keyRes = await apiCall<{ token?: string }>(
      "/auth/session/setup",
      { method: "POST", body: { passphrase }, silent: true }
    )
    if (keyRes.ok && keyRes.data?.token) {
      setSessionToken(keyRes.data.token)
      await refresh()
      return { ok: true }
    }
    return { ok: false, error: keyRes.ok ? "Setup 失败" : keyRes.error.message }
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
