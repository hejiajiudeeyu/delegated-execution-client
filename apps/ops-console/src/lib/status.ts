import type { StatusData } from "@/hooks/useAuth"

export function callerRegistrationMode(status: StatusData | null | undefined): string | null {
  const topLevelMode = status?.caller?.registration_mode
  if (typeof topLevelMode === "string" && topLevelMode.trim()) {
    return topLevelMode
  }
  const configMode = (status?.config as { caller?: { registration_mode?: string | null } } | undefined)?.caller?.registration_mode
  return typeof configMode === "string" && configMode.trim() ? configMode : null
}

export function isCallerRegistered(status: StatusData | null | undefined): boolean {
  if (status?.caller?.registered === true) {
    return true
  }
  const mode = callerRegistrationMode(status)
  if (mode === "local_only") {
    return true
  }
  if (status?.caller?.api_key_configured === true) {
    return true
  }
  const configCaller = (status?.config as { caller?: { api_key_configured?: boolean } } | undefined)?.caller
  return configCaller?.api_key_configured === true
}
