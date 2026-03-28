import { useEffect, useRef, useState } from "react"
import { requestJson } from "@/lib/api"
import type { StatusData } from "./useAuth"

export function useStatus(intervalMs = 10000) {
  const [data, setData] = useState<StatusData | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetch = async () => {
    try {
      const res = await requestJson<StatusData>("/status")
      if (res.body) setData(res.body)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    fetch()
    timerRef.current = setInterval(fetch, intervalMs)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [intervalMs])

  return data
}
