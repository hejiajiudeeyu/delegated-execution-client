import { useEffect, useRef, useState, useCallback } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { requestJson } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  FlaskConical,
  Inbox,
  Info,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  User,
  XCircle,
  AlertTriangle,
  Zap,
} from "lucide-react"
import { cn } from "@/components/ui/utils"
import { toast } from "sonner"

interface RequestItem {
  request_id: string
  hotline_id?: string
  status: string
  created_at?: string
  updated_at?: string
  input?: string
  responder_id?: string
}

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

interface PreparedCandidate {
  hotline_id: string
  responder_id: string
  display_name?: string
  responder_display_name?: string
  task_types?: string[]
  match_reasons?: string[]
}

interface PreparedCall {
  task_type?: string | null
  always_ask?: boolean
  remembered_preference?: unknown
  selection_reason?: string
  selected_hotline?: PreparedCandidate
  candidate_hotlines?: PreparedCandidate[]
}

interface HotlineSchemaProperty {
  type?: string
  description?: string
  default?: unknown
  enum?: string[]
}

interface HotlineDetail {
  hotline_id: string
  responder_id?: string
  display_name?: string
  task_types?: string[]
  input_summary?: string | null
  output_summary?: string | null
  input_schema?: {
    required?: string[]
    properties?: Record<string, HotlineSchemaProperty>
  } | null
  output_schema?: Record<string, unknown> | null
}

type FilterValue = "all" | "pending-approval" | "requests"

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

function normalizeRequestStatus(status: string) {
  const normalized = String(status || "").toUpperCase()
  if (["SUCCEEDED", "COMPLETED"].includes(normalized)) return "completed"
  if (["FAILED", "ERROR", "UNVERIFIED", "TIMED_OUT"].includes(normalized)) return "failed"
  return "running"
}

function StatusIcon({ status }: { status: string }) {
  const normalized = normalizeRequestStatus(status)
  if (normalized === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
  if (normalized === "failed") return <XCircle className="h-3.5 w-3.5 text-red-500" />
  return <Clock className="h-3.5 w-3.5 text-yellow-500" />
}

function RequestStatusBadge({ status }: { status: string }) {
  const normalized = normalizeRequestStatus(status)
  const variant =
    normalized === "completed"
      ? "outline"
      : normalized === "failed"
        ? "destructive"
        : "secondary"
  return <Badge variant={variant} className="text-[10px]">{status}</Badge>
}

function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const map: Record<ApprovalStatus, { label: string; className: string }> = {
    pending: { label: "待审批", className: "bg-amber-100 text-amber-700 border-amber-300" },
    approved: { label: "已批准", className: "bg-green-100 text-green-700 border-green-300" },
    rejected: { label: "已拒绝", className: "bg-red-100 text-red-700 border-red-300" },
    expired: { label: "已过期", className: "bg-slate-100 text-slate-500 border-slate-300" },
  }
  const { label, className } = map[status] ?? map.expired
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", className)}>{label}</span>
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

function timeAgo(iso?: string | null): string {
  if (!iso) return "未知"
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

function buildResultRows(result: Record<string, unknown>, hints: OutputDisplayHints | null | undefined): ResultRow[] {
  const primaryField = hints?.primary_field
  const labels = hints?.field_labels ?? {}
  const order = hints?.field_display_order
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

function ExecutionBlock({ execution, hints }: { execution: ExecutionState; hints?: OutputDisplayHints | null }) {
  const isRunning = execution.status === "running"
  const isSucceeded = execution.status === "succeeded"
  const isFailed = execution.status === "failed" || execution.status === "timed_out"
  const resultRows = execution.result ? buildResultRows(execution.result, hints) : null

  return (
    <div className={cn(
      "mt-2 rounded-md border p-3 space-y-2 text-xs",
      isRunning && "border-blue-200 bg-blue-50/60",
      isSucceeded && "border-green-200 bg-green-50/60",
      isFailed && "border-red-200 bg-red-50/60",
    )}>
      <div className="flex items-center gap-1.5 font-medium">
        {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
        {isSucceeded && <CheckCircle className="h-3.5 w-3.5 text-green-600" />}
        {isFailed && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
        <span className={cn(
          isRunning && "text-blue-700",
          isSucceeded && "text-green-700",
          isFailed && "text-red-700",
        )}>
          {isRunning && "Agent 正在执行调用…"}
          {isSucceeded && "执行成功"}
          {isFailed && (execution.status === "timed_out" ? "执行超时" : "执行失败")}
        </span>
        {execution.requestId && (
          <span className="ml-auto font-mono text-muted-foreground opacity-60 select-all">
            {execution.requestId.slice(0, 18)}…
          </span>
        )}
      </div>

      {execution.responder?.responderId && (
        <div className="flex items-center gap-1 text-muted-foreground">
          <User className="h-3 w-3" />
          <span>由 <span className="font-mono text-foreground">{execution.responder.responderId}</span> 处理</span>
        </div>
      )}

      {isSucceeded && execution.humanSummary && (
        <p className="rounded px-2 py-1 font-medium bg-green-100/80 text-green-800">
          {execution.humanSummary}
        </p>
      )}

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
                  isPrimary ? "text-foreground font-medium border-green-400" : "text-foreground border-green-200"
                )}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {isFailed && execution.error && (
        <div className="border-t border-red-200 pt-2 space-y-0.5">
          <p className="font-mono text-red-700 font-medium">{execution.error.code}</p>
          <p className="text-red-600">{execution.error.message}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground opacity-70 pt-0.5">
        {execution.completedAt && <span>{timeAgo(execution.completedAt)} 完成</span>}
        {execution.timing?.elapsed_ms != null && <span>· 耗时 {execution.timing.elapsed_ms} ms</span>}
        {execution.usage && Object.keys(execution.usage).length > 0 && (
          <span className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" />
            {Object.entries(execution.usage).map(([k, v]) => `${k}: ${v}`).join("  ")}
          </span>
        )}
      </div>
    </div>
  )
}

function RequestDetail({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [resultPending, setResultPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchDetail = useCallback(async () => {
    const [dRes, rRes] = await Promise.all([
      requestJson<Record<string, unknown>>(`/requests/${requestId}`),
      requestJson<Record<string, unknown>>(`/requests/${requestId}/result`),
    ])
    if (dRes.body) setDetail(dRes.body)
    const resultBody = rRes.body as { available?: boolean; status?: string; result_package?: Record<string, unknown> | null } | null
    const available = resultBody?.available === true
    setResultPending(Boolean(rRes.status === 200 && resultBody && !available))
    if (rRes.status === 200 && available && resultBody?.result_package) {
      setResult(resultBody.result_package)
      if (pollRef.current) clearInterval(pollRef.current)
    }
    setLoading(false)
  }, [requestId])

  useEffect(() => {
    fetchDetail()
    pollRef.current = setInterval(fetchDetail, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchDetail])

  const status = (detail as { status?: string } | null)?.status ?? "pending"

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <StatusIcon status={status} /> Request 详情
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground font-mono">{requestId}</span>
              <RequestStatusBadge status={status} />
              {!result && normalizeRequestStatus(status) === "running" && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <RefreshCw className="h-3 w-3 animate-spin" /> 轮询中…
                </span>
              )}
            </div>
            {detail && (
              <pre className="terminal-block text-xs overflow-auto max-h-32">
                {JSON.stringify(detail, null, 2)}
              </pre>
            )}
            {resultPending && (
              <div className="text-xs text-muted-foreground rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2">
                结果尚未可用，正在继续轮询最新执行状态…
              </div>
            )}
            {result && (
              <div>
                <p className="text-xs font-semibold mb-1.5 text-green-600">结果</p>
                <pre className="terminal-block text-xs overflow-auto max-h-48">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ManualCallForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [searchParams] = useSearchParams()
  const [hotlineId, setHotlineId] = useState(searchParams.get("hotline_id") ?? "")
  const [responderId, setResponderId] = useState(searchParams.get("responder_id") ?? "")
  const [taskType, setTaskType] = useState(searchParams.get("task_type") ?? "")
  const [hotlineDetail, setHotlineDetail] = useState<HotlineDetail | null>(null)
  const [schemaValues, setSchemaValues] = useState<Record<string, string>>({})
  const [detailLoading, setDetailLoading] = useState(false)
  const [prepared, setPrepared] = useState<PreparedCall | null>(null)
  const [selectedKey, setSelectedKey] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const selectedHotline =
    prepared?.candidate_hotlines?.find((item) => `${item.responder_id}:${item.hotline_id}` === selectedKey) ??
    prepared?.selected_hotline ??
    null
  const schemaProperties = hotlineDetail?.input_schema?.properties ?? {}
  const schemaRequired = hotlineDetail?.input_schema?.required ?? []
  const schemaEntries = Object.entries(schemaProperties)
  const textFallbackValue = schemaValues.text ?? ""
  const missingRequiredField = schemaRequired.find((field) => !String(schemaValues[field] ?? "").trim())
  const isOfficialExampleHotline = hotlineId === "local.delegated-execution.workspace-summary.v1"

  useEffect(() => {
    async function loadDetail() {
      if (!hotlineId) {
        setHotlineDetail(null)
        setSchemaValues({})
        return
      }
      setDetailLoading(true)
      const res = await requestJson<HotlineDetail>(`/catalog/hotlines/${encodeURIComponent(hotlineId)}`)
      setDetailLoading(false)
      if (res.status === 200 && res.body) {
        setHotlineDetail(res.body)
        if (!responderId && res.body.responder_id) setResponderId(res.body.responder_id)
        if (!taskType && res.body.task_types?.[0]) setTaskType(res.body.task_types[0])
        setSchemaValues((current) => {
          const next: Record<string, string> = {}
          for (const [field, definition] of Object.entries(res.body?.input_schema?.properties ?? {})) {
            if (current[field] != null) next[field] = current[field]
            else if (typeof definition.default === "string") next[field] = definition.default
            else if (definition.enum?.length) next[field] = definition.enum[0]
            else next[field] = ""
          }
          return next
        })
      } else {
        setHotlineDetail(null)
      }
    }
    loadDetail()
  }, [hotlineId, responderId, taskType])

  function updateSchemaValue(field: string, value: string) {
    setSchemaValues((current) => ({ ...current, [field]: value }))
  }

  const handlePrepare = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hotlineId) return
    setLoading(true)
    setError("")
    const res = await requestJson<PreparedCall>("/calls/prepare", {
      method: "POST",
      body: {
        hotline_id: hotlineId,
        responder_id: responderId || undefined,
        task_type: taskType || undefined,
        text: textFallbackValue,
      },
    })
    setLoading(false)
    if (res.status === 200 && res.body) {
      setPrepared(res.body)
      const nextSelected = res.body.selected_hotline
      setSelectedKey(nextSelected ? `${nextSelected.responder_id}:${nextSelected.hotline_id}` : "")
      if (!taskType && res.body.task_type) setTaskType(res.body.task_type)
      if (!responderId && nextSelected?.responder_id) setResponderId(nextSelected.responder_id)
    } else {
      const err = res.body as { error?: { message?: string } } | null
      setError(err?.error?.message ?? "Prepare 失败")
    }
  }

  const handleConfirm = async () => {
    if (!prepared || !selectedHotline) return
    if (missingRequiredField) {
      setError(`请先填写必填字段：${missingRequiredField}`)
      return
    }
    const payload = schemaEntries.length > 0
      ? Object.fromEntries(
          schemaEntries
            .map(([field]) => [field, schemaValues[field] ?? ""])
            .filter(([, value]) => String(value).trim() !== "")
        )
      : { text: textFallbackValue }
    setConfirming(true)
    const res = isOfficialExampleHotline
      ? await requestJson<{ request_id: string }>("/requests/example", {
          method: "POST",
          body: {},
        })
      : await requestJson<{ request_id: string }>("/calls/confirm", {
          method: "POST",
          body: {
            responder_id: selectedHotline.responder_id,
            hotline_id: selectedHotline.hotline_id,
            task_type: taskType,
            text: textFallbackValue,
            input: payload,
            payload,
            output_schema: hotlineDetail?.output_schema || {
              type: "object",
              properties: {
                summary: { type: "string" },
              },
            },
          },
        })
    setConfirming(false)
    if ((res.status === 200 || res.status === 201) && res.body?.request_id) {
      onCreated(res.body.request_id)
      setPrepared(null)
      setSelectedKey("")
    } else {
      const err = res.body as { error?: { message?: string } } | null
      setError(err?.error?.message ?? "Confirm 失败")
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="destructive"><p className="text-sm">{error}</p></Alert>}

      {!prepared ? (
        <form onSubmit={handlePrepare} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Hotline ID</Label>
              <Input value={hotlineId} onChange={(e) => setHotlineId(e.target.value)} placeholder="my-org.hotline.v1" />
            </div>
            <div className="space-y-1.5">
              <Label>Task Type</Label>
              <Input value={taskType} onChange={(e) => setTaskType(e.target.value)} placeholder="text_summarize" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Responder ID</Label>
              <Input value={responderId} onChange={(e) => setResponderId(e.target.value)} placeholder="可选，留空则自动选择" />
            </div>
          </div>
          {detailLoading && <Skeleton className="h-20 w-full" />}
          {!detailLoading && hotlineDetail?.input_summary && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {hotlineDetail.input_summary}
            </div>
          )}
          {!detailLoading && schemaEntries.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {schemaEntries.map(([field, definition]) => {
                const required = schemaRequired.includes(field)
                const value = schemaValues[field] ?? ""
                return (
                  <div key={field} className="space-y-1.5">
                    <Label>
                      {field}
                      {required && <span className="ml-1 text-red-500">*</span>}
                    </Label>
                    {definition.enum?.length ? (
                      <select
                        value={value}
                        onChange={(e) => updateSchemaValue(field, e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-input-background px-3 py-2 text-sm outline-none"
                      >
                        {definition.enum.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        value={value}
                        onChange={(e) => updateSchemaValue(field, e.target.value)}
                        placeholder={definition.description || `填写 ${field}`}
                      />
                    )}
                    {definition.description && (
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{definition.description}</p>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>输入内容</Label>
              <Input
                value={textFallbackValue}
                onChange={(e) => updateSchemaValue("text", e.target.value)}
                placeholder="任务描述…"
              />
            </div>
          )}
          <Button type="submit" size="sm" disabled={loading || !hotlineId}>
            {loading ? "准备中…" : "Prepare"} <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border border-teal-500/30 bg-teal-500/5 p-3 text-sm space-y-1">
            <p className="font-semibold text-teal-700 text-xs">确认 Call 详情</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div><span className="text-muted-foreground">Task Type:</span> <span className="font-mono">{(prepared.task_type ?? taskType) || "–"}</span></div>
              {prepared.selection_reason && <div><span className="text-muted-foreground">选择原因:</span> {prepared.selection_reason}</div>}
              {selectedHotline && <div><span className="text-muted-foreground">Hotline:</span> <span className="font-mono">{selectedHotline.hotline_id}</span></div>}
              {selectedHotline && <div><span className="text-muted-foreground">Responder:</span> <span className="font-mono">{selectedHotline.responder_id}</span></div>}
            </div>
          </div>
          {prepared.candidate_hotlines && prepared.candidate_hotlines.length > 0 && (
            <div className="space-y-2">
              <Label>候选 Hotline</Label>
              <div className="space-y-2">
                {prepared.candidate_hotlines.map((candidate) => {
                  const candidateKey = `${candidate.responder_id}:${candidate.hotline_id}`
                  const active = candidateKey === selectedKey
                  return (
                    <button
                      key={candidateKey}
                      type="button"
                      onClick={() => setSelectedKey(candidateKey)}
                      className={cn(
                        "w-full rounded-md border p-3 text-left text-sm transition-colors",
                        active ? "border-teal-500 bg-teal-500/5" : "hover:bg-muted"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{candidate.display_name ?? candidate.hotline_id}</p>
                          <p className="text-xs font-mono text-muted-foreground truncate">
                            {candidate.responder_id} · {candidate.hotline_id}
                          </p>
                        </div>
                        {active && <Badge variant="outline" className="text-[10px] border-teal-500/40 text-teal-600">已选择</Badge>}
                      </div>
                      {candidate.match_reasons && candidate.match_reasons.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {candidate.match_reasons.map((reason) => (
                            <Badge key={reason} variant="secondary" className="text-[10px]">
                              {reason}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {missingRequiredField && (
            <Alert variant="destructive">
              <p className="text-sm">请先填写必填字段：{missingRequiredField}</p>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConfirm} disabled={confirming || !selectedHotline || !taskType || Boolean(missingRequiredField)}>
              <Send className="h-3.5 w-3.5 mr-1" /> {confirming ? "发送中…" : "确认发送"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setPrepared(null); setSelectedKey("") }}>取消</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ApprovalCard({
  item,
  onDecide,
  onSelectRequest,
}: {
  item: ApprovalRecord
  onDecide: (id: string, action: "approve" | "reject") => Promise<void>
  onSelectRequest: (requestId: string) => void
}) {
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null)
  const RiskIcon = RISK_ICONS[item.overallRisk] ?? Info
  const isPending = item.status === "pending"

  async function handleDecide(action: "approve" | "reject") {
    setDeciding(action)
    await onDecide(item.id, action)
    setDeciding(null)
  }

  return (
    <Card className={cn("transition-all", isPending && "border-amber-300/60 shadow-sm")}>
      <CardContent className="p-4 space-y-3">
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
            <ApprovalStatusBadge status={item.status} />
          </div>
        </div>

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

        {!isPending && item.execution && (
          <div className="space-y-2">
            <ExecutionBlock execution={item.execution} hints={item.hotlineInfo?.outputDisplayHints} />
            {item.execution.requestId && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => onSelectRequest(item.execution!.requestId!)}>
                  查看请求详情
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function CallsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [testOpen, setTestOpen] = useState(window.location.pathname.endsWith("/new"))

  const filter = (searchParams.get("filter") as FilterValue | null) ?? "all"
  const pendingApprovals = approvals.filter((item) => item.status === "pending")
  const showApprovals = filter === "all" || filter === "pending-approval"
  const showRequests = filter === "all" || filter === "requests"

  const loadData = useCallback(async () => {
    const [requestsRes, approvalsRes] = await Promise.all([
      requestJson<{ items?: RequestItem[]; requests?: RequestItem[] }>("/requests"),
      requestJson<{ items?: ApprovalRecord[] }>("/caller/approvals"),
    ])
    const requestItems = requestsRes.body?.items ?? requestsRes.body?.requests ?? []
    const approvalItems = approvalsRes.body?.items ?? []
    if (Array.isArray(requestItems)) setRequests(requestItems)
    if (Array.isArray(approvalItems)) setApprovals(approvalItems)
    setLoadingList(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const hasRunningApprovalExecution = approvals.some(
      (item) => item.status === "approved" && item.execution?.status === "running"
    )
    const interval = hasRunningApprovalExecution ? 2000 : 5000
    const timer = setInterval(loadData, interval)
    return () => clearInterval(timer)
  }, [loadData, approvals])

  const handleCreated = (id: string) => {
    setSelectedId(id)
    setTestOpen(false)
    loadData()
    navigate("/caller/calls")
  }

  async function handleDecide(id: string, action: "approve" | "reject") {
    const res = await requestJson(`/caller/approvals/${id}/${action}`, { method: "POST" })
    if (res.status === 200) {
      toast.success(action === "approve" ? "已批准，Agent 可继续执行" : "已拒绝调用请求")
      await loadData()
    } else {
      toast.error("操作失败，请刷新后重试")
    }
  }

  const filters: { value: FilterValue; label: string }[] = [
    { value: "all", label: "全部" },
    { value: "pending-approval", label: "待审批" },
    { value: "requests", label: "请求记录" },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Call 工作台
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            统一查看待审批请求、执行中的调用，以及所有 Hotline Call 历史
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadData() }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> 刷新
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">待审批</p>
            <p className="text-xl font-semibold">{pendingApprovals.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Call 记录</p>
            <p className="text-xl font-semibold">{requests.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">运行中</p>
            <p className="text-xl font-semibold">
              {requests.filter((req) => normalizeRequestStatus(req.status) === "running").length}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-1">
        {filters.map((item) => (
          <button
            key={item.value}
            onClick={() => navigate(item.value === "all" ? "/caller/calls" : `/caller/calls?filter=${item.value}`)}
            className={cn(
              "px-3 py-1 text-xs rounded-md font-medium transition-colors",
              filter === item.value ? "bg-cyan-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {selectedId && <RequestDetail requestId={selectedId} onClose={() => setSelectedId(null)} />}

      {showApprovals && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> 待审批与审批后执行
              {pendingApprovals.length > 0 && (
                <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0">
                  {pendingApprovals.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingList ? (
              <div className="space-y-3">
                {[1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
              </div>
            ) : approvals.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">暂无审批记录</p>
            ) : (
              <div className="space-y-3">
                {approvals.map((item) => (
                  <ApprovalCard
                    key={item.id}
                    item={item}
                    onDecide={handleDecide}
                    onSelectRequest={(requestId) => setSelectedId(requestId)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showRequests && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">请求列表</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingList ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : requests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">暂无 Call 请求记录</p>
            ) : (
              <div className="space-y-0.5">
                {requests.map((req) => (
                  <button
                    key={req.request_id}
                    onClick={() => setSelectedId(req.request_id)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded text-sm hover:bg-muted transition-colors text-left",
                      selectedId === req.request_id && "bg-muted ring-1 ring-primary/30"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusIcon status={req.status} />
                      <span className="font-mono text-xs truncate">{req.request_id.slice(0, 20)}…</span>
                      {req.hotline_id && <Badge variant="outline" className="text-[10px] shrink-0">{req.hotline_id}</Badge>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {req.created_at && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(req.created_at).toLocaleString()}
                        </span>
                      )}
                      <RequestStatusBadge status={req.status} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Separator />

      <Collapsible open={testOpen} onOpenChange={setTestOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" />
            手动发起测试 Call
            <ChevronDown className={cn("h-3 w-3 transition-transform", testOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-1.5">
                <FlaskConical className="h-3.5 w-3.5 text-teal-500" /> 手动测试
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ManualCallForm onCreated={handleCreated} />
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export function CallerApprovalsPage() {
  return <Navigate to="/caller/calls?filter=pending-approval" replace />
}
