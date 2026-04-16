import { useCallback, useEffect, useState } from "react"
import { requestJson } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CheckCircle, XCircle, Clock, ShieldAlert, ShieldCheck, Info,
  Loader2, AlertTriangle, FileText, User, Zap,
} from "lucide-react"
import { cn } from "@/components/ui/utils"
import { toast } from "sonner"

type ApprovalStatus = "pending" | "approved" | "rejected" | "expired"
type ExecStatus = "running" | "succeeded" | "failed" | "timed_out" | "unknown"

interface RiskFactor {
  factor: string
  description: string
  severity: "high" | "medium" | "low" | "info"
}

interface OutputDisplayHints {
  primary_field?: string
  field_display_order?: string[]
  field_labels?: Record<string, string>
  field_descriptions?: Record<string, string>
}

interface ExecutionState {
  requestId: string | null
  status: ExecStatus
  responder: { responderId: string; hotlineId: string } | null
  result: Record<string, unknown> | null
  humanSummary: string | null
  usage: Record<string, unknown> | null
  error: { code: string; message: string } | null
  timing: { accepted_at?: string; finished_at?: string; elapsed_ms?: number } | null
  startedAt: string | null
  completedAt: string | null
}

interface ApprovalRecord {
  id: string
  hotlineId: string
  purpose: string | null
  agentSessionId: string | null
  inputSummary: string | null
  hotlineInfo: {
    displayName: string
    responderId: string
    description: string | null
    reviewStatus: string | null
    outputDisplayHints?: OutputDisplayHints | null
  } | null
  riskFactors: RiskFactor[]
  overallRisk: "high" | "medium" | "low" | "info"
  status: ApprovalStatus
  createdAt: string
  expiresAt: string
  decidedAt: string | null
  execution: ExecutionState | null
}

type ApprovalMode = "manual" | "allow_listed" | "allow_all"

interface GlobalPolicy {
  mode: ApprovalMode
  responderWhitelist: string[]
  hotlineWhitelist: string[]
  blocklist: string[]
}

const SEVERITY_COLORS: Record<string, string> = {
  high: "text-red-600 bg-red-50 border-red-200",
  medium: "text-amber-600 bg-amber-50 border-amber-200",
  low: "text-blue-600 bg-blue-50 border-blue-200",
  info: "text-slate-600 bg-slate-50 border-slate-200",
}

const RISK_ICONS: Record<string, React.ElementType> = {
  high: ShieldAlert,
  medium: ShieldAlert,
  low: ShieldCheck,
  info: Info,
}

function RiskBadge({ severity }: { severity: string }) {
  const labels: Record<string, string> = {
    high: "高风险",
    medium: "中风险",
    low: "低风险",
    info: "提示",
  }
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info)}>
      {labels[severity] ?? severity}
    </span>
  )
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const map: Record<ApprovalStatus, { label: string; className: string }> = {
    pending: { label: "待审批", className: "bg-amber-100 text-amber-700 border-amber-300" },
    approved: { label: "已批准", className: "bg-green-100 text-green-700 border-green-300" },
    rejected: { label: "已拒绝", className: "bg-red-100 text-red-700 border-red-300" },
    expired: { label: "已过期", className: "bg-slate-100 text-slate-500 border-slate-300" },
  }
  const { label, className } = map[status] ?? map.expired
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", className)}>{label}</span>
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s 前`
  if (diff < 3600) return `${Math.floor(diff / 60)}min 前`
  return `${Math.floor(diff / 3600)}h 前`
}

function expiresIn(iso: string): string {
  const diff = Math.floor((new Date(iso).getTime() - Date.now()) / 1000)
  if (diff <= 0) return "已过期"
  if (diff < 60) return `${diff}s 后过期`
  return `${Math.floor(diff / 60)}min 后过期`
}

interface ResultRow {
  key: string
  label: string
  value: string
  isPrimary: boolean
}

function buildResultRows(
  result: Record<string, unknown>,
  hints: OutputDisplayHints | null | undefined
): ResultRow[] {
  const primaryField = hints?.primary_field
  const labels = hints?.field_labels ?? {}
  const order = hints?.field_display_order

  // Flatten one level: nested objects become "parent.child" keys
  const flat: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(result)) {
    if (v === null || v === undefined) continue
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
        if (subV !== null && subV !== undefined) {
          flat[`${k}.${subK}`] = subV
        }
      }
    } else {
      flat[k] = v
    }
  }

  const allKeys = order
    ? [...order.filter((k) => k in flat), ...Object.keys(flat).filter((k) => !order.includes(k))]
    : Object.keys(flat)

  return allKeys.map((key) => ({
    key,
    label: labels[key] ?? key,
    value: Array.isArray(flat[key]) ? JSON.stringify(flat[key], null, 2) : String(flat[key]),
    isPrimary: key === primaryField,
  }))
}

function ExecutionBlock({
  execution,
  hints,
}: {
  execution: ExecutionState
  hints?: OutputDisplayHints | null
}) {
  const isRunning = execution.status === "running"
  const isSucceeded = execution.status === "succeeded"
  const isFailed = execution.status === "failed" || execution.status === "timed_out"

  const resultRows = execution.result ? buildResultRows(execution.result, hints) : null

  return (
    <div className={cn(
      "mt-1 rounded-md border p-3 space-y-2 text-xs",
      isRunning   && "border-blue-200 bg-blue-50/60",
      isSucceeded && "border-green-200 bg-green-50/60",
      isFailed    && "border-red-200 bg-red-50/60",
    )}>
      {/* Status header */}
      <div className="flex items-center gap-1.5 font-medium">
        {isRunning   && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
        {isSucceeded && <CheckCircle className="h-3.5 w-3.5 text-green-600" />}
        {isFailed    && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
        <span className={cn(
          isRunning   && "text-blue-700",
          isSucceeded && "text-green-700",
          isFailed    && "text-red-700",
        )}>
          {isRunning   && "Agent 正在执行调用…"}
          {isSucceeded && "执行成功"}
          {isFailed    && (execution.status === "timed_out" ? "执行超时" : "执行失败")}
        </span>
        {execution.requestId && (
          <span className="ml-auto font-mono text-muted-foreground opacity-60 select-all">
            {execution.requestId.slice(0, 18)}…
          </span>
        )}
      </div>

      {/* Responder info */}
      {execution.responder?.responderId && (
        <div className="flex items-center gap-1 text-muted-foreground">
          <User className="h-3 w-3" />
          <span>由 <span className="font-mono text-foreground">{execution.responder.responderId}</span> 处理</span>
        </div>
      )}

      {/* human_summary — one-line result preview */}
      {isSucceeded && execution.humanSummary && (
        <p className={cn(
          "rounded px-2 py-1 font-medium",
          "bg-green-100/80 text-green-800"
        )}>
          {execution.humanSummary}
        </p>
      )}

      {/* Structured output fields */}
      {isSucceeded && resultRows && resultRows.length > 0 && (
        <div className="space-y-1.5 border-t border-green-200 pt-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <FileText className="h-3 w-3" /> 返回结果
          </div>
          <dl className="space-y-2">
            {resultRows.map(({ key, label, value, isPrimary }) => (
              <div key={key}>
                <dt className={cn(
                  "text-muted-foreground",
                  isPrimary ? "font-semibold text-foreground" : "font-mono opacity-70"
                )}>
                  {label}
                </dt>
                <dd className={cn(
                  "leading-relaxed whitespace-pre-wrap break-words pl-2 border-l-2 mt-0.5",
                  isPrimary
                    ? "text-foreground font-medium border-green-400"
                    : "text-foreground border-green-200"
                )}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Error detail */}
      {isFailed && execution.error && (
        <div className="border-t border-red-200 pt-2 space-y-0.5">
          <p className="font-mono text-red-700 font-medium">{execution.error.code}</p>
          <p className="text-red-600">{execution.error.message}</p>
        </div>
      )}

      {/* Footer: timing + usage */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground opacity-70 pt-0.5">
        {execution.completedAt && (
          <span>{timeAgo(execution.completedAt)} 完成</span>
        )}
        {execution.timing?.elapsed_ms != null && (
          <span>· 耗时 {execution.timing.elapsed_ms} ms</span>
        )}
        {execution.usage && Object.keys(execution.usage).length > 0 && (
          <span className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" />
            {Object.entries(execution.usage)
              .map(([k, v]) => `${k}: ${v}`)
              .join("  ")}
          </span>
        )}
      </div>
    </div>
  )
}

interface ApprovalCardProps {
  item: ApprovalRecord
  onDecide: (id: string, action: "approve" | "reject") => Promise<void>
  onAllowHotline: (item: ApprovalRecord) => Promise<void>
}

function ApprovalCard({ item, onDecide, onAllowHotline }: ApprovalCardProps) {
  const [deciding, setDeciding] = useState<"approve" | "reject" | "whitelist" | null>(null)
  const RiskIcon = RISK_ICONS[item.overallRisk] ?? Info
  const isPending = item.status === "pending"

  async function handleDecide(action: "approve" | "reject") {
    setDeciding(action)
    await onDecide(item.id, action)
    setDeciding(null)
  }

  async function handleAllowHotline() {
    setDeciding("whitelist")
    await onAllowHotline(item)
    setDeciding(null)
  }

  return (
    <Card className={cn("transition-all", isPending && "border-amber-300/60 shadow-sm")}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <RiskIcon className={cn("h-4 w-4 shrink-0", item.overallRisk === "high" ? "text-red-500" : item.overallRisk === "medium" ? "text-amber-500" : "text-blue-400")} />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{item.hotlineInfo?.displayName ?? item.hotlineId}</p>
              <p className="text-xs text-muted-foreground">{item.hotlineId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <RiskBadge severity={item.overallRisk} />
            <StatusBadge status={item.status} />
          </div>
        </div>

        {/* Context */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {item.purpose && (
            <div className="col-span-2">
              <span className="font-medium text-foreground">调用目的：</span>{item.purpose}
            </div>
          )}
          {item.agentSessionId && (
            <div>
              <span className="font-medium text-foreground">Agent Session：</span>
              <span className="font-mono">{item.agentSessionId}</span>
            </div>
          )}
          {item.inputSummary && (
            <div className="col-span-2">
              <span className="font-medium text-foreground">输入摘要：</span>{item.inputSummary}
            </div>
          )}
          <div>
            <span className="font-medium text-foreground">发起时间：</span>{timeAgo(item.createdAt)}
          </div>
          {isPending && (
            <div>
              <Clock className="inline h-3 w-3 mr-0.5 text-amber-500" />
              {expiresIn(item.expiresAt)}
            </div>
          )}
        </div>

        {/* Risk factors */}
        {item.riskFactors.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">风险因素</p>
            <div className="flex flex-wrap gap-1.5">
              {item.riskFactors.map((f, i) => (
                <span
                  key={i}
                  title={f.description}
                  className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs border", SEVERITY_COLORS[f.severity] ?? SEVERITY_COLORS.info)}
                >
                  {f.description}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {isPending && (
          <div className="flex items-center gap-2 pt-1 border-t border-border">
            <Button
              size="sm"
              className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              disabled={deciding !== null}
              onClick={() => handleDecide("approve")}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              {deciding === "approve" ? "批准中…" : "批准"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={deciding !== null}
              onClick={handleAllowHotline}
            >
              {deciding === "whitelist" ? "加入中…" : "加入白名单"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-red-300 text-red-600 hover:bg-red-50"
              disabled={deciding !== null}
              onClick={() => handleDecide("reject")}
            >
              <XCircle className="h-3.5 w-3.5" />
              {deciding === "reject" ? "拒绝中…" : "拒绝"}
            </Button>
            <p className="ml-auto text-xs text-muted-foreground">批准后 Agent 可继续执行调用</p>
          </div>
        )}

        {/* Execution state (shown after approval, while agent invokes) */}
        {!isPending && item.execution && (
          <ExecutionBlock
            execution={item.execution}
            hints={item.hotlineInfo?.outputDisplayHints}
          />
        )}
      </CardContent>
    </Card>
  )
}

export function CallerApprovalsPage() {
  const [items, setItems] = useState<ApprovalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ApprovalStatus | "all">("pending")

  const load = useCallback(async () => {
    const qs = filter !== "all" ? `?status=${filter}` : ""
    const res = await requestJson<{ items: ApprovalRecord[] }>(`/caller/approvals${qs}`)
    if (res.body?.items) setItems(res.body.items)
    setLoading(false)
  }, [filter])

  useEffect(() => {
    setLoading(true)
    load()
    // Poll faster (2s) when any approved record has a running execution
    const hasRunning = items.some(
      (i) => i.status === "approved" && i.execution?.status === "running"
    )
    const interval = hasRunning ? 2000 : 5000
    const timer = setInterval(load, interval)
    return () => clearInterval(timer)
  }, [load, items.some((i) => i.execution?.status === "running")])

  const pendingCount = items.filter((i) => i.status === "pending").length

  async function handleDecide(id: string, action: "approve" | "reject") {
    const res = await requestJson(`/caller/approvals/${id}/${action}`, { method: "POST" })
    if (res.status === 200) {
      toast.success(action === "approve" ? "已批准，Agent 可继续执行" : "已拒绝调用请求")
      load()
    } else {
      toast.error("操作失败，请刷新后重试")
    }
  }

  async function handleAllowHotline(item: ApprovalRecord) {
    const policyRes = await requestJson<GlobalPolicy>("/caller/global-policy")
    const policy = policyRes.status === 200 ? policyRes.body : null
    if (!policy) {
      toast.error("无法读取当前策略")
      return
    }
    if (policy.hotlineWhitelist.includes(item.hotlineId)) {
      toast.info("该 Hotline 已在白名单中")
      return
    }
    const saveRes = await requestJson<GlobalPolicy>("/caller/global-policy", {
      method: "PUT",
      body: {
        ...policy,
        hotlineWhitelist: [...policy.hotlineWhitelist, item.hotlineId],
      },
    })
    if (saveRes.status === 200 && saveRes.body) {
      toast.success(
        policy.mode === "allow_listed"
          ? "已加入 Hotline 白名单，后续可自动放行"
          : "已加入 Hotline 白名单；切换到白名单模式后才会自动放行"
      )
      return
    }
    toast.error("加入白名单失败，请重试")
  }

  const FILTERS: { value: ApprovalStatus | "all"; label: string }[] = [
    { value: "pending", label: "待审批" },
    { value: "approved", label: "已批准" },
    { value: "rejected", label: "已拒绝" },
    { value: "expired", label: "已过期" },
    { value: "all", label: "全部" },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            Hotline 调用审批
            {pendingCount > 0 && (
              <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0">
                {pendingCount}
              </Badge>
            )}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Agent 发起的 Hotline 调用需要您手动审批后才能执行
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load}>刷新</Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-3 py-1 text-xs rounded-md font-medium transition-colors",
              filter === f.value
                ? "bg-cyan-600 text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {filter === "pending" ? "暂无待审批请求" : "暂无记录"}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ApprovalCard key={item.id} item={item} onDecide={handleDecide} onAllowHotline={handleAllowHotline} />
          ))}
        </div>
      )}
    </div>
  )
}
