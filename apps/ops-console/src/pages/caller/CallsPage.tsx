import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { apiCall } from "@/lib/api"
import { usePoll } from "@/hooks/usePoll"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Inbox,
  Loader2,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  XCircle,
} from "lucide-react"
import { cn } from "@/components/ui/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestItem {
  request_id: string
  hotline_id?: string
  responder_id?: string
  status?: string
  created_at?: string
  updated_at?: string
  input?: Record<string, unknown> | string | null
  task_type?: string
  caller_origin?: string
  approval?: { status?: string; decided_at?: string; reason?: string } | null
}

interface ApprovalRecord {
  status: "pending" | "approved" | "rejected" | "expired"
  execution?: { status?: string }
}

interface RequestDetailData {
  request_id?: string
  hotline_id?: string
  responder_id?: string
  status?: string
  created_at?: string
  updated_at?: string
  input?: Record<string, unknown> | null
  task_type?: string
  caller_origin?: string
  approval?: {
    status?: string
    decided_at?: string
    reason?: string
    policy_mode?: string
  } | null
}

interface ResultPackage {
  status?: "ok" | "error" | string
  output?: Record<string, unknown> | null
  error?: { code?: string; message?: string; retryable?: boolean } | null
  timing?: { elapsed_ms?: number; accepted_at?: string; finished_at?: string } | null
  human_summary?: string
  signature_algorithm?: string
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

type NormalizedStatus =
  | "completed"
  | "failed"
  | "running"
  | "result_pending"
  | "pending_approval"
  | "rejected_by_approval"
  | "unknown"

const TERMINAL_FAILED_RAW = new Set(["FAILED", "ERROR", "UNVERIFIED", "TIMED_OUT"])
const TERMINAL_OK_RAW = new Set(["SUCCEEDED", "COMPLETED"])

function normalizeStatus(req: { status?: string; approval?: { status?: string } | null }): NormalizedStatus {
  const raw = String(req.status || "").toUpperCase()
  if (req.approval?.status === "pending") return "pending_approval"
  if (req.approval?.status === "rejected") return "rejected_by_approval"
  if (TERMINAL_OK_RAW.has(raw)) return "completed"
  if (TERMINAL_FAILED_RAW.has(raw)) return "failed"
  if (raw === "RESULT_PENDING" || raw === "ACKED") return "result_pending"
  if (raw === "RUNNING" || raw === "PENDING" || raw === "DISPATCHED" || raw === "SENT" || raw === "CREATED") {
    return "running"
  }
  return "unknown"
}

const STATUS_LABEL: Record<NormalizedStatus, string> = {
  completed: "已完成",
  failed: "失败",
  running: "进行中",
  result_pending: "等待结果",
  pending_approval: "等待审批",
  rejected_by_approval: "已拒绝",
  unknown: "未知",
}

function OutcomeBadge({ status }: { status: NormalizedStatus }) {
  const label = STATUS_LABEL[status]
  switch (status) {
    case "completed":
      return <Badge tone="caller" className="text-[10px]">{label}</Badge>
    case "failed":
    case "rejected_by_approval":
      return <Badge tone="destructive" className="text-[10px]">{label}</Badge>
    case "pending_approval":
    case "result_pending":
      return <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700">{label}</Badge>
    case "running":
      return <Badge variant="outline" className="text-[10px]">{label}</Badge>
    default:
      return <Badge variant="outline" className="text-[10px]">{label}</Badge>
  }
}

// ---------------------------------------------------------------------------
// Headline extraction (graceful fallback when display.summary_template absent)
// ---------------------------------------------------------------------------

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function getHotlineDisplayName(hotlineId?: string): string {
  if (!hotlineId) return "未知 Hotline"
  // Take the last meaningful segment of `namespace.hotline-name.v1` style ids.
  const segments = hotlineId.split(".")
  const tail = segments.length >= 2 ? segments[segments.length - 2] : segments[0]
  return humanizeKey(tail || hotlineId)
}

function extractHeadlineAction(req: { input?: RequestItem["input"]; task_type?: string }): string {
  const input = req.input
  if (!input || typeof input !== "object") {
    if (typeof input === "string" && input.trim()) {
      return input.trim().slice(0, 80) + (input.length > 80 ? "…" : "")
    }
    return req.task_type ? `调用一次（${req.task_type}）` : "调用一次"
  }
  const obj = input as Record<string, unknown>
  for (const key of ["text", "prompt", "message", "query", "summary", "title"]) {
    const v = obj[key]
    if (typeof v === "string" && v.trim()) {
      return v.trim().slice(0, 80) + (v.length > 80 ? "…" : "")
    }
  }
  const firstStringEntry = Object.entries(obj).find(([, v]) => typeof v === "string" && (v as string).trim())
  if (firstStringEntry) {
    const v = firstStringEntry[1] as string
    return v.trim().slice(0, 80) + (v.length > 80 ? "…" : "")
  }
  return req.task_type ? `调用一次（${req.task_type}）` : "调用一次"
}

function formatRelative(iso?: string): string {
  if (!iso) return ""
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ""
  const diff = Math.max(0, Date.now() - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
}

function formatAbsoluteAndRelative(iso?: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  const prefix = sameDay ? `今天 ${time}` : d.toLocaleString()
  const rel = formatRelative(iso)
  return rel ? `${prefix}（${rel}）` : prefix
}

function formatCallerOrigin(o?: string): string {
  if (!o) return "由你手动发起"
  if (o === "manual" || o === "user") return "由你手动发起"
  return `由 ${o} 发起`
}

function formatApprovalPath(req?: RequestDetailData | RequestItem | null): string {
  if (!req) return "—"
  const a = "approval" in req ? req.approval : null
  if (!a) return "无需审批"
  if (a.status === "pending") return "等待你审批中"
  if (a.status === "approved") {
    const when = a.decided_at ? new Date(a.decided_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : ""
    return when ? `你于 ${when} 手动批准` : "你已手动批准"
  }
  if (a.status === "rejected") {
    const when = a.decided_at ? new Date(a.decided_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : ""
    return when ? `你于 ${when} 拒绝` : "你已拒绝"
  }
  if ((a as { policy_mode?: string }).policy_mode === "allow_all") return "全部自动放行"
  if ((a as { policy_mode?: string }).policy_mode === "allow_listed") return "白名单自动放行"
  return "审批信息未知"
}

// ---------------------------------------------------------------------------
// Detail panel (three-section)
// ---------------------------------------------------------------------------

function RawJsonToggle({ data, label = "查看原始 JSON" }: { data: unknown; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-right">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        {label}
      </button>
      {open && (
        <pre className="terminal-block text-xs overflow-auto max-h-40 mt-2 text-left">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

function SectionA_Summary({
  detail,
  result,
  status,
  elapsedMs,
}: {
  detail: RequestDetailData | null
  result: ResultPackage | null
  status: NormalizedStatus
  elapsedMs?: number
}) {
  const hotlineName = getHotlineDisplayName(detail?.hotline_id)
  const headlineAction = detail ? extractHeadlineAction(detail) : "调用一次"
  const resultLine = result?.human_summary
    ? result.human_summary
    : status === "completed"
    ? "执行完成"
    : status === "failed"
    ? result?.error?.message ?? "执行失败"
    : status === "running"
    ? "Responder 正在执行…"
    : status === "result_pending"
    ? "Responder 已接收，结果尚未返回"
    : status === "pending_approval"
    ? "等待你审批"
    : status === "rejected_by_approval"
    ? "审批被拒绝"
    : "—"
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-semibold">{hotlineName} · {headlineAction}</p>
        <RawJsonToggle data={detail} label="原始请求 JSON" />
      </div>
      <p className="text-sm text-muted-foreground">{resultLine}</p>
      <div className="flex flex-wrap items-center gap-2">
        <OutcomeBadge status={status} />
        {typeof elapsedMs === "number" && elapsedMs > 0 && (
          <Badge variant="outline" className="text-[10px]">
            <Clock className="h-3 w-3 mr-0.5" />
            {(elapsedMs / 1000).toFixed(1)}s
          </Badge>
        )}
        {detail?.approval && (
          <Badge variant="outline" className="text-[10px]">
            {formatApprovalPath(detail)}
          </Badge>
        )}
      </div>
    </div>
  )
}

function SectionB_Context({ detail }: { detail: RequestDetailData | null }) {
  if (!detail) return null
  const inputEntries =
    detail.input && typeof detail.input === "object"
      ? Object.entries(detail.input as Record<string, unknown>)
      : []
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">请求背景</h4>
      <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">时间</dt>
        <dd>{formatAbsoluteAndRelative(detail.created_at)}</dd>

        <dt className="text-muted-foreground">发起方</dt>
        <dd>{formatCallerOrigin(detail.caller_origin)}</dd>

        <dt className="text-muted-foreground">Hotline</dt>
        <dd>
          <span title={detail.hotline_id} className="cursor-help">
            {getHotlineDisplayName(detail.hotline_id)}
          </span>
        </dd>

        <dt className="text-muted-foreground">Responder</dt>
        <dd className="break-all">
          <span title={detail.responder_id} className="cursor-help">
            {detail.responder_id ? humanizeKey(detail.responder_id.split("_").slice(-1)[0] || detail.responder_id) : "—"}
          </span>
        </dd>

        <dt className="text-muted-foreground">审批路径</dt>
        <dd>{formatApprovalPath(detail)}</dd>

        <dt className="text-muted-foreground self-start">输入参数</dt>
        <dd>
          {inputEntries.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <ul className="space-y-1 text-xs">
              {inputEntries.map(([k, v]) => (
                <li key={k} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">{humanizeKey(k)}：</span>
                  <span className="break-all">{renderInputValue(v)}</span>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      <RawJsonToggle data={detail} />
    </div>
  )
}

function renderInputValue(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 80) + "…" : v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (Array.isArray(v)) {
    if (v.length === 0) return "（空）"
    return v.length <= 5 ? v.map((x) => String(x)).join("、") : `${v.length} 项（已截断）`
  }
  return JSON.stringify(v).slice(0, 80) + "…"
}

function FailedCTAs({
  detail,
  result,
  navigate,
}: {
  detail: RequestDetailData | null
  result: ResultPackage | null
  navigate: ReturnType<typeof useNavigate>
}) {
  const retryable = result?.error?.retryable !== false
  const hotlineId = detail?.hotline_id
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <Button
        size="sm"
        disabled={!retryable || !hotlineId}
        title={!retryable ? "此错误不可重试" : !hotlineId ? "缺少 hotline_id" : undefined}
        onClick={() => {
          const search = new URLSearchParams({ from: "calls-retry" })
          if (hotlineId) search.set("hotline_id", hotlineId)
          if (detail?.input && typeof detail.input === "object") {
            try {
              search.set("prefill", btoa(unescape(encodeURIComponent(JSON.stringify(detail.input)))))
            } catch {
              /* prefill optional */
            }
          }
          navigate(`/caller/catalog?${search.toString()}`)
        }}
      >
        <RotateCcw className="h-3.5 w-3.5 mr-1" />
        重试调用
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          navigate(`/general/runtime?service=responder&filter=${encodeURIComponent(detail?.request_id ?? "")}&from=calls-detail`)
        }
      >
        查看 Responder 日志
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          // Lightweight: copy diagnostic info to clipboard. Full diagnostic-bundle pipeline is §0.5.
          const payload = JSON.stringify({ request_id: detail?.request_id, error: result?.error }, null, 2)
          if (typeof navigator !== "undefined" && navigator.clipboard) {
            void navigator.clipboard.writeText(payload)
          }
        }}
      >
        报告问题
      </Button>
    </div>
  )
}

function RejectedCTAs({
  detail,
  navigate,
}: {
  detail: RequestDetailData | null
  navigate: ReturnType<typeof useNavigate>
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <Button
        size="sm"
        onClick={() =>
          navigate(`/caller/lists?from=approvals-add-whitelist&hotline_id=${encodeURIComponent(detail?.hotline_id ?? "")}`)
        }
      >
        以后自动放行此 Hotline
      </Button>
      <Button size="sm" variant="outline" onClick={() => navigate("/caller/preferences?from=calls-detail")}>
        换成「白名单自动放行」模式
      </Button>
    </div>
  )
}

function SectionC_Outcome({
  detail,
  result,
  resultPending,
  status,
  navigate,
}: {
  detail: RequestDetailData | null
  result: ResultPackage | null
  resultPending: boolean
  status: NormalizedStatus
  navigate: ReturnType<typeof useNavigate>
}) {
  let railClass = "border-l-4 border-l-zinc-300"
  let icon = <AlertCircle className="h-4 w-4 text-muted-foreground" />
  let headline = "未知状态"
  let body: React.ReactNode = null

  if (status === "completed") {
    railClass = "border-l-4 border-l-green-500"
    icon = <CheckCircle2 className="h-4 w-4 text-green-600" />
    headline = "已完成"
    const elapsed = result?.timing?.elapsed_ms
    body = (
      <div className="space-y-2 text-sm">
        {result?.human_summary && <p className="leading-relaxed">{result.human_summary}</p>}
        {result?.output && (
          <ul className="space-y-1 text-xs">
            {Object.entries(result.output)
              .slice(0, 3)
              .map(([k, v]) => (
                <li key={k} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">{humanizeKey(k)}：</span>
                  <span className="break-all">{renderInputValue(v)}</span>
                </li>
              ))}
          </ul>
        )}
        {typeof elapsed === "number" && elapsed > 0 && (
          <p className="text-xs text-muted-foreground">耗时 {(elapsed / 1000).toFixed(1)}s</p>
        )}
      </div>
    )
  } else if (status === "failed") {
    railClass = "border-l-4 border-l-red-500"
    icon = <XCircle className="h-4 w-4 text-red-600" />
    headline = "失败"
    body = (
      <div className="space-y-3 text-sm">
        {result?.error?.code && (
          <p className="text-xs">
            <Badge variant="outline" className="text-[10px] font-mono">{result.error.code}</Badge>
          </p>
        )}
        <p className="leading-relaxed">{result?.error?.message ?? "未提供错误描述"}</p>
        <FailedCTAs detail={detail} result={result} navigate={navigate} />
      </div>
    )
  } else if (status === "running") {
    railClass = "border-l-4 border-l-blue-500"
    icon = <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
    headline = "Responder 正在执行…"
    body = <p className="text-sm text-muted-foreground">拿到结果会自动刷新。</p>
  } else if (status === "result_pending") {
    railClass = "border-l-4 border-l-amber-500"
    icon = <Clock className="h-4 w-4 text-amber-600" />
    headline = "Responder 已接收，结果尚未返回"
    body = <p className="text-sm text-muted-foreground">正在每 3 秒轮询执行状态。</p>
  } else if (status === "pending_approval") {
    railClass = "border-l-4 border-l-amber-500"
    icon = <ShieldAlert className="h-4 w-4 text-amber-600" />
    headline = "等待你审批"
    body = (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">这条调用需要你确认才能执行。</p>
        <Button size="sm" onClick={() => navigate("/caller/approvals")}>
          打开审批中心
          <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    )
  } else if (status === "rejected_by_approval") {
    railClass = "border-l-4 border-l-red-500"
    icon = <ShieldX className="h-4 w-4 text-red-600" />
    headline = formatApprovalPath(detail) || "审批被拒绝"
    body = (
      <div className="space-y-2 text-sm">
        {detail?.approval?.reason && (
          <p className="leading-relaxed text-muted-foreground">原因：{detail.approval.reason}</p>
        )}
        <RejectedCTAs detail={detail} navigate={navigate} />
      </div>
    )
  }

  return (
    <div className={cn("space-y-2 pl-3 -ml-3", railClass)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold flex items-center gap-2">
          {icon} {headline}
        </p>
        {(result || resultPending) && <RawJsonToggle data={result ?? { pending: true }} label="原始结果 JSON" />}
      </div>
      {body}
    </div>
  )
}

function RequestDetail({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const [detail, setDetail] = useState<RequestDetailData | null>(null)
  const [result, setResult] = useState<ResultPackage | null>(null)
  const [resultPending, setResultPending] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchDetail = useCallback(async () => {
    const [dRes, rRes] = await Promise.all([
      apiCall<RequestDetailData>(`/requests/${requestId}`, { silent: true }),
      apiCall<{ available?: boolean; status?: string; result_package?: ResultPackage | null }>(
        `/requests/${requestId}/result`,
        { silent: true }
      ),
    ])
    if (dRes.ok && dRes.data) setDetail(dRes.data)
    const body = rRes.ok ? rRes.data ?? null : null
    const available = body?.available === true
    setResultPending(Boolean(rRes.ok && body && !available))
    if (rRes.ok && available && body?.result_package) {
      setResult(body.result_package)
    }
    setLoading(false)
  }, [requestId])

  useEffect(() => {
    void fetchDetail()
  }, [fetchDetail])

  const status = normalizeStatus(detail ?? {})

  usePoll(fetchDetail, {
    intervalMs: 3000,
    enabled: status === "running" || status === "result_pending" || resultPending,
    skipInitial: true,
  })

  const elapsedMs = result?.timing?.elapsed_ms

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <PhoneCall className="h-4 w-4" /> 通话详情
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <SectionA_Summary detail={detail} result={result} status={status} elapsedMs={elapsedMs} />
            <hr className="border-t border-border" />
            <SectionB_Context detail={detail} />
            <hr className="border-t border-border" />
            <SectionC_Outcome
              detail={detail}
              result={result}
              resultPending={resultPending}
              status={status}
              navigate={navigate}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// CallSummaryRow (list)
// ---------------------------------------------------------------------------

function CallSummaryRow({
  req,
  selected,
  onSelect,
}: {
  req: RequestItem
  selected: boolean
  onSelect: () => void
}) {
  const hotlineName = getHotlineDisplayName(req.hotline_id)
  const action = extractHeadlineAction(req)
  const status = normalizeStatus(req)
  const time = formatRelative(req.updated_at ?? req.created_at)
  const origin = formatCallerOrigin(req.caller_origin)
  const approvalPath = formatApprovalPath(req)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left flex items-start justify-between gap-3 px-3 py-3 rounded transition-colors hover:bg-muted",
        selected && "bg-muted ring-1 ring-primary/30 border-l-2 border-l-foreground"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">
          <span className="font-semibold">{hotlineName}</span>
          <span className="text-muted-foreground"> · </span>
          {action}
        </p>
        <p className="mt-1 text-xs text-muted-foreground truncate">
          {time}
          <span className="mx-1.5">·</span>
          {origin}
          <span className="mx-1.5">·</span>
          {approvalPath}
        </p>
      </div>
      <div className="shrink-0">
        <OutcomeBadge status={status} />
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CallsPage() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const pendingApprovals = approvals.filter((a) => a.status === "pending")
  const runningCount = requests.filter((r) => normalizeStatus(r) === "running").length

  const loadData = useCallback(async () => {
    const [requestsRes, approvalsRes] = await Promise.all([
      apiCall<{ items?: RequestItem[]; requests?: RequestItem[] }>("/requests", { silent: true }),
      apiCall<{ items?: ApprovalRecord[] }>("/caller/approvals", { silent: true }),
    ])
    const requestItems = requestsRes.ok ? requestsRes.data?.items ?? requestsRes.data?.requests ?? [] : []
    const approvalItems = approvalsRes.ok ? approvalsRes.data?.items ?? [] : []
    if (Array.isArray(requestItems)) setRequests(requestItems)
    if (Array.isArray(approvalItems)) setApprovals(approvalItems)
    setLoadingList(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  usePoll(loadData, {
    intervalMs: 5000,
    fastIntervalMs: 2000,
    fastWhen: () => approvals.some((a) => a.status === "approved" && a.execution?.status === "running"),
    skipInitial: true,
  })

  // Empty state for whole page (no requests at all)
  const isEmpty = !loadingList && requests.length === 0

  return (
    <div className="space-y-5">
      {/* 顶栏 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            <PhoneCall className="h-4 w-4" /> 调用记录
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            查看你过去发起的 Hotline 调用、执行结果与审批路径。新调用请到 Catalog「试拨」；待审批请到审批中心。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => navigate("/caller/catalog?from=calls-detail")}>
            去 Catalog 发起调用
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/caller/approvals")}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            审批中心
            {pendingApprovals.length > 0 && (
              <Badge tone="destructive" className="ml-1.5 text-[10px] px-1.5 py-0">
                {pendingApprovals.length}
              </Badge>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadData()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            刷新
          </Button>
        </div>
      </div>

      {/* 三联 Stat 卡 */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">待审批</p>
            <p className="text-xl font-semibold">{loadingList ? "–" : pendingApprovals.length}</p>
            {pendingApprovals.length > 0 && (
              <button
                className="mt-2 text-xs font-medium text-cyan-600 hover:text-cyan-700"
                onClick={() => navigate("/caller/approvals")}
              >
                去处理审批
              </button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">总调用次数</p>
            <p className="text-xl font-semibold">{loadingList ? "–" : requests.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">运行中</p>
            <p className="text-xl font-semibold">{loadingList ? "–" : runningCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* 主从布局 */}
      {isEmpty ? (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <Inbox className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-base font-semibold">你还没有任何调用记录</p>
            <p className="text-sm text-muted-foreground">去 Catalog 选一个 Hotline 试拨吧——5 秒内能看到第一条记录。</p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <Button size="sm" onClick={() => navigate("/caller/catalog?from=calls-detail")}>
                打开 Catalog
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/")}>
                去 Dashboard 看上手清单
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {/* 左：通话日志 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">通话日志</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingList ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
              ) : (
                <div className="space-y-1">
                  {requests.map((req) => (
                    <CallSummaryRow
                      key={req.request_id}
                      req={req}
                      selected={selectedId === req.request_id}
                      onSelect={() => setSelectedId(req.request_id)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 右：详情 / 审批提醒 */}
          <div className="space-y-4">
            {selectedId ? (
              <RequestDetail requestId={selectedId} onClose={() => setSelectedId(null)} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-cyan-600" />
                    审批提醒
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    待审批请求和批准后的执行结果，已经独立放到「审批中心」统一处理。
                  </p>
                  <div className="rounded-md border bg-muted/20 px-3 py-2">
                    <p className="text-xs text-muted-foreground">当前待审批</p>
                    <p className="text-lg font-semibold">{pendingApprovals.length}</p>
                  </div>
                  <Button size="sm" className="w-full" onClick={() => navigate("/caller/approvals")}>
                    前往审批中心
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
