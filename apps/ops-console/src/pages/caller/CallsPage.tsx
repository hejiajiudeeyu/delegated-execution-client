import { useEffect, useRef, useState, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
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
  CheckCircle2, Clock, XCircle, ChevronRight, ChevronDown,
  RefreshCw, FlaskConical, Inbox, Send,
} from "lucide-react"
import { cn } from "@/components/ui/utils"

interface RequestItem {
  request_id: string
  hotline_id?: string
  status: string
  created_at?: string
  input?: string
  responder_id?: string
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
  if (status === "failed" || status === "error") return <XCircle className="h-3.5 w-3.5 text-red-500" />
  return <Clock className="h-3.5 w-3.5 text-yellow-500" />
}

function StatusBadge({ status }: { status: string }) {
  const v = status === "completed" ? "outline"
    : (status === "failed" || status === "error") ? "destructive"
    : "secondary"
  return <Badge variant={v} className="text-[10px]">{status}</Badge>
}

function RequestDetail({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchDetail = useCallback(async () => {
    const [dRes, rRes] = await Promise.all([
      requestJson<Record<string, unknown>>(`/requests/${requestId}`),
      requestJson<Record<string, unknown>>(`/requests/${requestId}/result`),
    ])
    if (dRes.body) setDetail(dRes.body)
    if (rRes.status === 200 && rRes.body) {
      setResult(rRes.body)
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
              <StatusBadge status={status} />
              {!result && status !== "completed" && status !== "failed" && (
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
  const [inputText, setInputText] = useState("")
  const [prepared, setPrepared] = useState<{
    confirmation_token: string; hotline_id: string; responder_id?: string; estimated_timeout_s?: number
  } | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handlePrepare = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hotlineId) return
    setLoading(true); setError("")
    const res = await requestJson<typeof prepared>("/calls/prepare", {
      method: "POST",
      body: { hotline_id: hotlineId, input: inputText },
    })
    setLoading(false)
    if (res.status === 200 && res.body) setPrepared(res.body)
    else {
      const err = res.body as { error?: { message?: string } } | null
      setError(err?.error?.message ?? "Prepare 失败")
    }
  }

  const handleConfirm = async () => {
    if (!prepared) return
    setConfirming(true)
    const res = await requestJson<{ request_id: string }>("/calls/confirm", {
      method: "POST",
      body: { confirmation_token: prepared.confirmation_token },
    })
    setConfirming(false)
    if (res.status === 200 && res.body?.request_id) {
      onCreated(res.body.request_id)
      setPrepared(null); setInputText("")
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
              <Label>输入内容</Label>
              <Input value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="任务描述…" />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={loading || !hotlineId}>
            {loading ? "准备中…" : "Prepare"} <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border border-teal-500/30 bg-teal-500/5 p-3 text-sm space-y-1">
            <p className="font-semibold text-teal-700 text-xs">确认 Call 详情</p>
            <div className="grid grid-cols-2 gap-x-4 text-xs">
              <div><span className="text-muted-foreground">Hotline:</span> <span className="font-mono">{prepared.hotline_id}</span></div>
              {prepared.responder_id && <div><span className="text-muted-foreground">Responder:</span> <span className="font-mono">{prepared.responder_id}</span></div>}
              {prepared.estimated_timeout_s && <div><span className="text-muted-foreground">超时:</span> {prepared.estimated_timeout_s}s</div>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConfirm} disabled={confirming}>
              <Send className="h-3.5 w-3.5 mr-1" /> {confirming ? "发送中…" : "确认发送"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPrepared(null)}>取消</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function CallsPage() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [testOpen, setTestOpen] = useState(window.location.pathname.endsWith("/new"))

  const loadRequests = useCallback(async () => {
    const res = await requestJson<{ items?: RequestItem[]; requests?: RequestItem[] }>("/requests")
    const items = res.body?.items ?? res.body?.requests ?? []
    if (Array.isArray(items)) setRequests(items)
    setLoadingList(false)
  }, [])

  useEffect(() => { loadRequests() }, [loadRequests])

  const handleCreated = (id: string) => {
    setSelectedId(id)
    setTestOpen(false)
    loadRequests()
    navigate("/caller/calls")
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Call 请求
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">查看所有 Caller 发出的 Hotline Call 请求与状态</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadRequests() }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> 刷新
          </Button>
        </div>
      </div>

      {selectedId && <RequestDetail requestId={selectedId} onClose={() => setSelectedId(null)} />}

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
                    <StatusBadge status={req.status} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
