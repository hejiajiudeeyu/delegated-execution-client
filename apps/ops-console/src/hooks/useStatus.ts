import { useEffect, useRef, useState } from "react"
import { apiCall } from "@/lib/api"
import type { StatusData } from "./useAuth"

export function useStatus(intervalMs = 10000) {
  const [data, setData] = useState<StatusData | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = async () => {
    const res = await apiCall<StatusData>("/status", { silent: true })
    if (res.ok && res.data) setData(res.data)
  }

  useEffect(() => {
    fetchStatus()
    timerRef.current = setInterval(fetchStatus, intervalMs)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [intervalMs])

  return { data, refresh: fetchStatus }
}
