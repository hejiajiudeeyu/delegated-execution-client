import { useEffect, useState, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiCall } from "@/lib/api"
import { usePoll } from "@/hooks/usePoll"
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
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FlaskConical,
  Inbox,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react"
import { cn } from "@/components/ui/utils"

interface RequestItem {
  request_id: string
  hotline_id?: string
  status: string
  created_at?: string
  updated_at?: string
  input?: string
  responder_id?: string
}

interface ApprovalRecord {
  status: "pending" | "approved" | "rejected" | "expired"
  execution?: { status?: string }
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
  if (normalized === "completed") {
    return <Badge tone="caller" className="text-[10px]">{status}</Badge>
  }
  if (normalized === "failed") {
    return <Badge tone="destructive" className="text-[10px]">{status}</Badge>
  }
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>
}

function RequestDetail({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [resultPending, setResultPending] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchDetail = useCallback(async () => {
    const [dRes, rRes] = await Promise.all([
      apiCall<Record<string, unknown>>(`/requests/${requestId}`, { silent: true }),
      apiCall<Record<string, unknown>>(`/requests/${requestId}/result`, { silent: true }),
    ])
    if (dRes.ok && dRes.data) setDetail(dRes.data)
    const resultBody = rRes.ok
      ? (rRes.data as { available?: boolean; status?: string; result_package?: Record<string, unknown> | null } | null)
      : null
    const available = resultBody?.available === true
    setResultPending(Boolean(rRes.ok && resultBody && !available))
    if (rRes.ok && available && resultBody?.result_package) {
      setResult(resultBody.result_package)
    }
    setLoading(false)
  }, [requestId])

  useEffect(() => { void fetchDetail() }, [fetchDetail])

  // Stop polling once the result has materialized — otherwise keep refreshing
  // every 3s while the executor is still working.
  usePoll(fetchDetail, {
    intervalMs: 3000,
    enabled: result === null,
    skipInitial: true,
  })

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
      const res = await apiCall<HotlineDetail>(`/catalog/hotlines/${encodeURIComponent(hotlineId)}`, { silent: true })
      setDetailLoading(false)
      if (res.ok && res.data) {
        const detail = res.data
        setHotlineDetail(detail)
        if (!responderId && detail.responder_id) setResponderId(detail.responder_id)
        if (!taskType && detail.task_types?.[0]) setTaskType(detail.task_types[0])
        setSchemaValues((current) => {
          const next: Record<string, string> = {}
          for (const [field, definition] of Object.entries(detail.input_schema?.properties ?? {})) {
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
    const res = await apiCall<PreparedCall>("/calls/prepare", {
      method: "POST",
      silent: true,
      body: {
        hotline_id: hotlineId,
        responder_id: responderId || undefined,
        task_type: taskType || undefined,
        text: textFallbackValue,
      },
    })
    setLoading(false)
    if (res.ok && res.data) {
      const prep = res.data
      setPrepared(prep)
      const nextSelected = prep.selected_hotline
      setSelectedKey(nextSelected ? `${nextSelected.responder_id}:${nextSelected.hotline_id}` : "")
      if (!taskType && prep.task_type) setTaskType(prep.task_type)
      if (!responderId && nextSelected?.responder_id) setResponderId(nextSelected.responder_id)
    } else {
      setError(res.ok ? "Prepare 失败" : res.error.message)
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
      ? await apiCall<{ request_id: string }>("/requests/example", {
          method: "POST",
          silent: true,
          body: {},
        })
      : await apiCall<{ request_id: string }>("/calls/confirm", {
          method: "POST",
          silent: true,
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
    if (res.ok && res.data?.request_id) {
      onCreated(res.data.request_id)
      setPrepared(null)
      setSelectedKey("")
    } else {
      setError(res.ok ? "Confirm 失败" : res.error.message)
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
                            <Badge key={reason} variant="outline" className="text-[10px]">
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

export function CallsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [testOpen, setTestOpen] = useState(window.location.pathname.endsWith("/new"))
  const pendingApprovals = approvals.filter((item) => item.status === "pending")

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

  // Tighten poll cadence while any approved request is still executing so the
  // list flips to a terminal state quickly.
  usePoll(loadData, {
    intervalMs: 5000,
    fastIntervalMs: 2000,
    fastWhen: () => approvals.some((item) => item.status === "approved" && item.execution?.status === "running"),
    skipInitial: true,
  })

  const handleCreated = (id: string) => {
    setSelectedId(id)
    setTestOpen(false)
    loadData()
    navigate("/caller/calls")
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            <Inbox className="h-4 w-4" /> 调用记录
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            查看 Hotline 请求历史、状态变化和返回结果；新的审批请求请前往审批中心处理。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/caller/approvals")}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1" /> 审批中心
          </Button>
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
            <button
              className="mt-2 text-xs font-medium text-cyan-600 hover:text-cyan-700"
              onClick={() => navigate("/caller/approvals")}
            >
              去处理审批
            </button>
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

      {selectedId && <RequestDetail requestId={selectedId} onClose={() => setSelectedId(null)} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
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
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs truncate">{req.request_id.slice(0, 20)}…</span>
                          {req.hotline_id && <Badge variant="outline" className="text-[10px] shrink-0">{req.hotline_id}</Badge>}
                        </div>
                        {req.responder_id && (
                          <p className="text-[11px] text-muted-foreground font-mono truncate">{req.responder_id}</p>
                        )}
                      </div>
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

        <div className="space-y-4">
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

          <Collapsible open={testOpen} onOpenChange={setTestOpen}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <FlaskConical className="h-3.5 w-3.5 text-cyan-600" /> 手动发起测试 Call
                  </CardTitle>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      {testOpen ? "收起" : "展开"}
                      <ChevronDown className={cn("h-3 w-3 transition-transform", testOpen && "rotate-180")} />
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <ManualCallForm onCreated={handleCreated} />
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>

      <Separator />
    </div>
  )
}
