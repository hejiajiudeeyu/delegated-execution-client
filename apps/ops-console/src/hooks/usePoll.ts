import { useEffect, useRef } from "react"

export interface UsePollOptions {
  /** Base interval in ms. */
  intervalMs: number
  /** When `fastWhen()` returns true, use this shorter interval instead. */
  fastIntervalMs?: number
  /** Re-evaluated on every tick (not part of effect deps). */
  fastWhen?: () => boolean
  /** Skip the immediate-on-mount fire. Default false (fires immediately). */
  skipInitial?: boolean
  /** Pause polling while document is hidden, resume on visibilitychange. Default true. */
  pauseWhenHidden?: boolean
  /** Disable the poll entirely. Default true. */
  enabled?: boolean
}

/**
 * Repeatedly invoke `loadFn` on a (possibly variable) interval.
 *
 * Rationale: callers were writing `useEffect(() => { setInterval(load, 5000) }, [load, items.some(...)])`
 * and the `items.some(...)` was a fresh boolean every render, recreating
 * the interval on every render and producing a polling jitter bug.
 *
 * This hook isolates that pattern: pass `fastWhen` as a callback that is
 * re-evaluated each tick instead of being a dep, so the interval lifecycle
 * is stable across renders.
 *
 * Also pauses while the tab is hidden (you don't want background polling
 * eating API quota) and re-fires immediately on resume.
 */
export function usePoll(loadFn: () => Promise<void> | void, options: UsePollOptions): void {
  const {
    intervalMs,
    fastIntervalMs,
    fastWhen,
    skipInitial = false,
    pauseWhenHidden = true,
    enabled = true,
  } = options

  const loadRef = useRef(loadFn)
  const fastWhenRef = useRef(fastWhen)
  loadRef.current = loadFn
  fastWhenRef.current = fastWhen

  useEffect(() => {
    if (!enabled) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      if (pauseWhenHidden && typeof document !== "undefined" && document.hidden) {
        schedule()
        return
      }
      try {
        await loadRef.current()
      } catch {
        /* swallow — apiCall already toasts; this guards arbitrary loadFn throws */
      }
      if (!cancelled) schedule()
    }

    const schedule = () => {
      const useFast = fastIntervalMs !== undefined && fastWhenRef.current?.() === true
      const wait = useFast ? fastIntervalMs! : intervalMs
      timer = setTimeout(tick, wait)
    }

    if (!skipInitial) void tick()
    else schedule()

    let onVisibility: (() => void) | null = null
    if (pauseWhenHidden && typeof document !== "undefined") {
      onVisibility = () => {
        if (!document.hidden && !cancelled) {
          if (timer) clearTimeout(timer)
          void tick()
        }
      }
      document.addEventListener("visibilitychange", onVisibility)
    }

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (onVisibility && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility)
      }
    }
  }, [intervalMs, fastIntervalMs, skipInitial, pauseWhenHidden, enabled])
}
