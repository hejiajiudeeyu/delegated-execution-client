import { useEffect, useRef, useState } from "react"
import type { JSX } from "react"
import { requestJson } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/components/ui/utils"
import { RefreshCw, Trash2, ChevronDown, ChevronRight } from "lucide-react"

type Service = "caller" | "responder" | "relay"

const SERVICES: { id: Service; label: string }[] = [
  { id: "caller", label: "Caller" },
  { id: "responder", label: "Responder" },
  { id: "relay", label: "Relay" },
]

interface ServiceLogs {
  service: string
  file: string
  logs: string[]
}

interface ServiceAlerts {
  service: string
  alerts: Array<{ ts?: string; type?: string; message?: string; line?: string }>
}

type LogLevel = "error" | "warn" | "info" | "debug" | "all"

// A log entry is a real line or a timestamp separator
type LogEntry =
  | { kind: "line"; text: string }
  | { kind: "separator"; ts: string }

function getLevel(line: string): LogLevel {
  const lower = line.toLowerCase()
  if (lower.includes("error") || lower.includes("err") || lower.includes("failed") || lower.includes("exception")) return "error"
  if (lower.includes("warn")) return "warn"
  if (lower.includes("debug") || lower.includes("verbose")) return "debug"
  return "info"
}

function dedupeLines(lines: string[]): { line: string; count: number }[] {
  return lines.reduce<{ line: string; count: number }[]>((acc, line) => {
    const last = acc[acc.length - 1]
    if (last && last.line === line) { last.count++; return acc }
    return [...acc, { line, count: 1 }]
  }, [])
}

type AlertEntry = { ts?: string; type?: string; message?: string; line?: string }
type DedupedAlert = AlertEntry & { count: number }

function dedupeAlerts(alerts: AlertEntry[]): DedupedAlert[] {
  return alerts.reduce<DedupedAlert[]>((acc, a) => {
    const key = a.message ?? a.line ?? ""
    const existing = acc.find((x) => (x.message ?? x.line ?? "") === key)
    if (existing) { existing.count++; return acc }
    return [...acc, { ...a, count: 1 }]
  }, [])
}

// Hints derived from structured alerts (not from scanning log lines)
const ALERT_HINTS: { pattern: RegExp; hint: string }[] = [
  {
    pattern: /inbox poll failed|inbox pull failed/i,
    hint: "Caller Controller 无法连接 Relay 或平台 Inbox。检查 Transport 配置和各服务运行状态。",
  },
  {
    pattern: /responder.*pull failed|pull failed.*fetch/i,
    hint: "Responder Controller 无法拉取任务，Relay 可能不可达。检查 Relay 状态和 Transport 配置。",
  },
]

function LogLine({ line, count }: { line: string; count: number }) {
  const level = getLevel(line)
  const colors: Record<LogLevel, string> = {
    error: "text-red-400",
    warn: "text-yellow-400",
    info: "text-green-400",
    debug: "text-zinc-400",
    all: "text-green-400",
  }
  const prefix: Record<LogLevel, string> = {
    error: "ERR",
    warn: "WRN",
    info: "INF",
    debug: "DBG",
    all: "INF",
  }
  return (
    <div className={cn("text-xs leading-5 font-mono flex gap-2", colors[level])}>
      <span className="shrink-0 text-zinc-500 text-[10px] leading-5">{prefix[level]}</span>
      <span className="break-all flex-1">{line}</span>
      {count > 1 && (
        <span className="shrink-0 text-zinc-500 text-[10px] leading-5 ml-auto pl-2">×{count}</span>
      )}
    </div>
  )
}

/** Walk entries, deduplicate consecutive identical lines, and preserve separator dividers. */
function renderEntriesWithSeparators(entries: LogEntry[]): JSX.Element[] {
  const result: JSX.Element[] = []
  let prevLine: string | null = null
  let count = 0
  let key = 0

  const flush = () => {
    if (prevLine !== null) {
      result.push(<LogLine key={key++} line={prevLine} count={count} />)
      prevLine = null
      count = 0
    }
  }

  for (const entry of entries) {
    if (entry.kind === "separator") {
      flush()
      result.push(
        <div key={`sep-${key++}`} className="text-[10px] font-mono text-zinc-600 py-1 text-center select-none">
          {entry.ts}
        </div>
      )
    } else {
      if (prevLine === entry.text) {
        count++
      } else {
        flush()
        prevLine = entry.text
        count = 1
      }
    }
  }
  flush()
  return result
}

export function RuntimePage() {
  const [activeService, setActiveService] = useState<Service>("caller")
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [alerts, setAlerts] = useState<ServiceAlerts["alerts"]>([])
  const [logFile, setLogFile] = useState("")
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null)
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filterText, setFilterText] = useState("")
  const [levelFilter, setLevelFilter] = useState<LogLevel>("all")
  const logsEndRef = useRef<HTMLDivElement>(null)

  const load = async (service: Service, { silent = false } = {}) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    const loadedAt = new Date().toLocaleTimeString()
    const [logsRes, alertsRes] = await Promise.all([
      requestJson<ServiceLogs>(`/runtime/logs?service=${service}&max_lines=500`),
      requestJson<ServiceAlerts>(`/runtime/alerts?service=${service}&max_items=20`),
    ])
    if (logsRes.status === 200 && logsRes.body) {
      const newLines: LogEntry[] = (logsRes.body.logs ?? []).map((text) => ({ kind: "line" as const, text }))
      const separator: LogEntry = { kind: "separator", ts: `── 加载于 ${loadedAt} ──` }
      setEntries([...newLines, separator])
      setLogFile(logsRes.body.file ?? "")
    }
    if (alertsRes.status === 200 && alertsRes.body) setAlerts(alertsRes.body.alerts ?? [])
    if (!silent) setLoading(false)
    else setRefreshing(false)
  }

  const loadSnapshot = async () => {
    const res = await requestJson<Record<string, unknown>>("/debug/snapshot")
    if (res.status === 200 && res.body) setSnapshot(res.body)
  }

  useEffect(() => {
    load(activeService)
    loadSnapshot()
  }, [activeService])

  // Auto-refresh every 5 seconds (silent, no spinner)
  useEffect(() => {
    const id = setInterval(() => load(activeService, { silent: true }), 5000)
    return () => clearInterval(id)
  }, [activeService])

  useEffect(() => {
    if (!filterText && levelFilter === "all") {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [entries, filterText, levelFilter])

  const rawLines = entries.filter((e): e is { kind: "line"; text: string } => e.kind === "line").map((e) => e.text)

  const filteredLines = rawLines.filter((line) => {
    const matchesText = !filterText || line.toLowerCase().includes(filterText.toLowerCase())
    const matchesLevel = levelFilter === "all" || getLevel(line) === levelFilter
    return matchesText && matchesLevel
  })
  const dedupedFilteredLogs = dedupeLines(filteredLines)

  // Hints derived from structured alerts, not from log line scanning
  const alertMessages = alerts.map((a) => a.message ?? a.line ?? "")
  const activeHints = ALERT_HINTS.filter(({ pattern }) =>
    alertMessages.some((m) => pattern.test(m))
  )
  const clearAlerts = async () => {
    await requestJson("/runtime/alerts", { method: "DELETE" })
    setAlerts([])
  }

  const dedupedAlerts = dedupeAlerts(alerts)

  const LEVEL_LABELS: { id: LogLevel; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "error", label: "错误" },
    { id: "warn", label: "警告" },
    { id: "info", label: "信息" },
    { id: "debug", label: "调试" },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold">Runtime 监控</h1>
          <p className="text-xs text-muted-foreground mt-0.5">日志、告警与调试信息</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { load(activeService); loadSnapshot() }} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", (loading || refreshing) && "animate-spin")} />
          刷新
        </Button>
      </div>

      <div className="flex gap-1.5">
        {SERVICES.map((s) => (
          <button
            key={s.id}
            onClick={() => { setActiveService(s.id); setFilterText(""); setLevelFilter("all") }}
            className={cn(
              "px-3 py-1.5 rounded text-xs font-semibold border transition-colors",
              activeService === s.id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {dedupedAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-orange-600 flex items-center gap-1.5">
                告警
                <Badge variant="destructive" className="text-xs">
                  {alerts.length > dedupedAlerts.length
                    ? `${dedupedAlerts.length} 类 / ${alerts.length} 条`
                    : alerts.length}
                </Badge>
              </CardTitle>
              <Button
                variant="ghost" size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={clearAlerts}
              >
                <Trash2 className="h-3 w-3 mr-1" />清除告警
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {dedupedAlerts.map((a, i) => (
                <div
                  key={i}
                  className="flex gap-3 rounded bg-red-500/5 border border-red-500/20 px-3 py-2 text-sm"
                >
                  {a.ts && (
                    <span className="shrink-0 text-xs text-muted-foreground font-mono">
                      {new Date(a.ts).toLocaleTimeString()}
                    </span>
                  )}
                  {a.type && <span className="text-red-600 font-medium">[{a.type}]</span>}
                  <span className="flex-1">{a.message ?? a.line ?? ""}</span>
                  {a.count > 1 && (
                    <span className="shrink-0 text-xs text-muted-foreground font-mono ml-auto">×{a.count}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeHints.map(({ hint }, i) => (
        <Card key={i} className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-yellow-700 leading-relaxed">{hint}</p>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">
              日志 — {activeService}
              {logFile && (
                <span className="ml-2 text-[10px] font-mono text-muted-foreground font-normal">({logFile})</span>
              )}
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {dedupedFilteredLogs.length} 类 / {filteredLines.length} 条
              </span>
              <Button
                variant="ghost" size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setEntries([])}
              >
                <Trash2 className="h-3 w-3 mr-1" />清除
              </Button>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <Input
              placeholder="筛选日志…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-7 text-xs max-w-[200px]"
            />
            <div className="flex gap-1">
              {LEVEL_LABELS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setLevelFilter(id)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] font-semibold rounded border transition-colors",
                    levelFilter === id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="terminal-block h-72 overflow-y-auto rounded">
            {filterText || levelFilter !== "all" ? (
              dedupedFilteredLogs.length === 0 ? (
                <p className="text-muted-foreground text-xs">无匹配结果</p>
              ) : (
                dedupedFilteredLogs.map(({ line, count }, i) => <LogLine key={i} line={line} count={count} />)
              )
            ) : (
              entries.length === 0 ? (
                <p className="text-muted-foreground text-xs">暂无日志</p>
              ) : (
                renderEntriesWithSeparators(entries)
              )
            )}
            <div ref={logsEndRef} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <button
          className="w-full flex items-center gap-2 p-4 text-left hover:bg-muted/30 transition-colors"
          onClick={() => setSnapshotOpen((v) => !v)}
        >
          {snapshotOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="text-sm font-semibold">Debug Snapshot</span>
          <span className="text-xs text-muted-foreground ml-1">— 开发调试用，展示当前进程状态快照</span>
        </button>
        {snapshotOpen && (
          <CardContent className="pt-0">
            {snapshot ? (
              <pre className="terminal-block text-xs overflow-auto max-h-64">
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            ) : (
              <p className="text-muted-foreground text-xs">加载中…</p>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
