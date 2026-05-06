import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiCall } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert } from "@/components/ui/alert"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  ArrowRight,
  Loader2,
  PackageSearch,
  Search,
  Send,
  Sparkles,
  X,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

interface HotlineItem {
  hotline_id: string
  display_name?: string
  responder_id?: string
  description?: string
  tags?: string[]
  status?: string
  task_types?: string[]
}

interface HotlineSchemaProperty {
  type?: string
  description?: string
  default?: unknown
  enum?: string[]
}

interface HotlineDetail extends HotlineItem {
  review_status?: string
  summary?: string | null
  input_summary?: string | null
  output_summary?: string | null
  input_schema?: {
    required?: string[]
    properties?: Record<string, HotlineSchemaProperty>
  } | null
  output_schema?: {
    properties?: Record<string, HotlineSchemaProperty>
  } | null
  recommended_for?: string[]
  limitations?: string[]
}

const ONBOARDING_TIP_DISMISS_KEY = "catalog.first-call-tip.dismissed"

function ReviewBadge({ status }: { status?: string }) {
  if (!status || status === "local_only") {
    return <Badge tone="caller" className="text-[10px]">本地热线</Badge>
  }
  if (status === "approved") {
    return <Badge variant="outline" className="text-[10px]">已审核</Badge>
  }
  if (status === "rejected") {
    return <Badge tone="destructive" className="text-[10px]">已拒绝</Badge>
  }
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>
}

function decodePrefill(base64?: string): Record<string, unknown> | null {
  if (!base64) return null
  try {
    const json = decodeURIComponent(escape(atob(base64)))
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// TryCallDrawer
// ---------------------------------------------------------------------------

function TryCallDrawer({
  hotline,
  detail,
  open,
  onOpenChange,
  prefill,
  onSubmitted,
}: {
  hotline: HotlineItem | null
  detail: HotlineDetail | null
  open: boolean
  onOpenChange: (next: boolean) => void
  prefill: Record<string, unknown> | null
  onSubmitted: (requestId: string) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const properties = detail?.input_schema?.properties ?? {}
  const required = detail?.input_schema?.required ?? []
  const entries = Object.entries(properties)

  // Initialise / reset values when the drawer opens or the detail changes.
  useEffect(() => {
    if (!open) return
    const next: Record<string, string> = {}
    for (const [field, def] of entries) {
      const fromPrefill = prefill?.[field]
      if (fromPrefill !== undefined && fromPrefill !== null) {
        next[field] = typeof fromPrefill === "string" ? fromPrefill : JSON.stringify(fromPrefill)
      } else if (typeof def.default === "string") {
        next[field] = def.default
      } else if (def.enum?.length) {
        next[field] = def.enum[0]
      } else {
        next[field] = ""
      }
    }
    // If schema empty but prefill exists, keep a `text` fallback for the schema-less case.
    if (entries.length === 0 && prefill) {
      const keys = Object.keys(prefill)
      if (keys.length === 1 && typeof prefill[keys[0]] === "string") {
        next[keys[0]] = prefill[keys[0]] as string
      } else if (typeof prefill["text"] === "string") {
        next.text = prefill.text as string
      }
    }
    setValues(next)
    setError("")
  }, [open, detail, prefill])

  const missing = required.find((field) => !String(values[field] ?? "").trim())
  const hasSchema = entries.length > 0

  const handleSubmit = async () => {
    if (!hotline) return
    if (missing) {
      setError(`请先填写必填字段：${missing}`)
      return
    }
    setSubmitting(true)
    setError("")

    const isOfficialExample = hotline.hotline_id === "local.delegated-execution.workspace-summary.v1"
    const taskType = detail?.task_types?.[0] ?? hotline.task_types?.[0] ?? ""

    const payload = hasSchema
      ? Object.fromEntries(entries.map(([k]) => [k, values[k] ?? ""]).filter(([, v]) => String(v).trim() !== ""))
      : { text: values.text ?? "" }

    const res = isOfficialExample
      ? await apiCall<{ request_id: string }>("/requests/example", {
          method: "POST",
          body: {},
          silent: true,
        })
      : await apiCall<{ request_id: string }>("/calls/confirm", {
          method: "POST",
          silent: true,
          body: {
            responder_id: detail?.responder_id ?? hotline.responder_id,
            hotline_id: hotline.hotline_id,
            task_type: taskType,
            text: values.text ?? "",
            input: payload,
            payload,
            output_schema: detail?.output_schema || {
              type: "object",
              properties: { summary: { type: "string" } },
            },
          },
        })

    setSubmitting(false)
    if (res.ok && res.data?.request_id) {
      onSubmitted(res.data.request_id)
    } else {
      setError(res.ok ? "调用提交失败，未拿到 request_id" : res.error.message)
    }
  }

  const title = hotline ? hotline.display_name ?? hotline.hotline_id : "试拨"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            试拨 · {title}
          </SheetTitle>
          {detail?.input_summary && (
            <SheetDescription>{detail.input_summary}</SheetDescription>
          )}
        </SheetHeader>

        <div className="px-4 pt-2 pb-4 space-y-4">
          {error && (
            <Alert variant="destructive">
              <p className="text-sm">{error}</p>
            </Alert>
          )}

          {entries.length === 0 ? (
            <div className="space-y-1.5">
              <Label>输入内容</Label>
              <Input
                value={values.text ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, text: e.target.value }))}
                placeholder="任务描述…"
              />
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map(([field, def]) => {
                const isRequired = required.includes(field)
                const value = values[field] ?? ""
                return (
                  <div key={field} className="space-y-1.5">
                    <Label>
                      {field}
                      {isRequired && <span className="ml-1 text-red-500">*</span>}
                      {def.type && (
                        <Badge variant="outline" className="ml-2 text-[10px]">{def.type}</Badge>
                      )}
                    </Label>
                    {def.enum?.length ? (
                      <select
                        value={value}
                        onChange={(e) => setValues((prev) => ({ ...prev, [field]: e.target.value }))}
                        className="flex h-9 w-full rounded-md border border-input bg-input-background px-3 py-2 text-sm outline-none"
                      >
                        {def.enum.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        value={value}
                        onChange={(e) => setValues((prev) => ({ ...prev, [field]: e.target.value }))}
                        placeholder={def.description || `填写 ${field}`}
                      />
                    )}
                    {def.description && (
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{def.description}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <SheetFooter className="px-4 pb-4">
          <Button onClick={handleSubmit} disabled={submitting || !hotline || Boolean(missing)}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> 发送中…
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5 mr-1" /> 发送调用
              </>
            )}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// FirstCallTipBanner — for ?from=dashboard-onboarding / dashboard-nextup
// ---------------------------------------------------------------------------

function FirstCallTipBanner({ from }: { from: string | null }) {
  const isTipKey = from === "dashboard-onboarding" || from === "dashboard-nextup"
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false
    return localStorage.getItem(ONBOARDING_TIP_DISMISS_KEY) === "1"
  })
  if (!isTipKey || dismissed) return null

  const text =
    from === "dashboard-nextup"
      ? "Dashboard「下一步」推荐你试拨一次。选一个 Hotline 开始。"
      : "第一次试拨指南：选一个带 official 标签的 Hotline 点「试拨」即可。结果会自动跳到调用记录。"

  return (
    <Card className="border-sky-500/40 bg-sky-500/5">
      <CardContent className="flex items-start justify-between gap-3 p-3">
        <div className="flex items-start gap-2">
          <Sparkles className="h-4 w-4 mt-0.5 text-sky-600 shrink-0" />
          <p className="text-xs leading-relaxed text-sky-800 dark:text-sky-300">{text}</p>
        </div>
        <button
          type="button"
          aria-label="关闭提示"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (typeof localStorage !== "undefined") {
              localStorage.setItem(ONBOARDING_TIP_DISMISS_KEY, "1")
            }
            setDismissed(true)
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// EmptyState (zero hotlines)
// ---------------------------------------------------------------------------

function EmptyCatalogState({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-4">
        <PackageSearch className="h-10 w-10 mx-auto text-muted-foreground" />
        <p className="text-base font-semibold">你的 Catalog 是空的</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          没有任何 Hotline 可以调。两条路：让你的 Responder 发布一个，或者去 Dashboard 启用平台模式浏览社区已发布的。
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Button size="sm" onClick={() => navigate("/responder/hotlines")}>
            打开 Hotline 管理
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/")}>
            去 Dashboard 启用平台模式
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CatalogPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<HotlineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [detail, setDetail] = useState<HotlineDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const fromParam = searchParams.get("from")
  const deepLinkHotlineId = searchParams.get("hotline_id")
  const prefillBase64 = searchParams.get("prefill")
  const prefillData = useMemo(() => decodePrefill(prefillBase64 ?? undefined), [prefillBase64])

  // Load list once on mount.
  useEffect(() => {
    apiCall<{ items: HotlineItem[] }>("/catalog/hotlines", { silent: true }).then((res) => {
      if (res.ok && res.data?.items) {
        setItems(res.data.items)
      }
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return items.filter((item) => {
      return (
        !q ||
        item.hotline_id.toLowerCase().includes(q) ||
        (item.display_name ?? "").toLowerCase().includes(q) ||
        (item.description ?? "").toLowerCase().includes(q) ||
        (item.task_types ?? []).some((value) => value.toLowerCase().includes(q))
      )
    })
  }, [items, query])

  // Auto-select first filtered item, or honour deep-link hotline_id.
  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId("")
      setDetail(null)
      return
    }
    if (deepLinkHotlineId && filtered.some((item) => item.hotline_id === deepLinkHotlineId)) {
      setSelectedId(deepLinkHotlineId)
      return
    }
    if (!selectedId || !filtered.some((item) => item.hotline_id === selectedId)) {
      setSelectedId(filtered[0].hotline_id)
    }
  }, [filtered, selectedId, deepLinkHotlineId])

  // Load detail whenever selection changes.
  useEffect(() => {
    async function loadDetail() {
      if (!selectedId) {
        setDetail(null)
        return
      }
      setDetailLoading(true)
      const res = await apiCall<HotlineDetail>(
        `/catalog/hotlines/${encodeURIComponent(selectedId)}`,
        { silent: true }
      )
      setDetail(res.ok ? res.data ?? null : null)
      setDetailLoading(false)
    }
    void loadDetail()
  }, [selectedId])

  // Auto-open drawer when arriving via deep link with hotline_id.
  useEffect(() => {
    if (!deepLinkHotlineId) return
    if (!detail || detailLoading) return
    if (detail.hotline_id !== deepLinkHotlineId) return
    setDrawerOpen(true)
    // Consume the deep-link params so re-opening the page doesn't re-trigger.
    const next = new URLSearchParams(searchParams)
    next.delete("hotline_id")
    next.delete("prefill")
    setSearchParams(next, { replace: true })
  }, [deepLinkHotlineId, detail, detailLoading, searchParams, setSearchParams])

  const selectedItem = filtered.find((item) => item.hotline_id === selectedId) ?? null
  const activeHotline = detail ?? selectedItem
  const inputFields = Object.entries(detail?.input_schema?.properties ?? {})
  const outputFields = Object.entries(detail?.output_schema?.properties ?? {})

  const openDrawer = useCallback(
    (item: HotlineItem | null) => {
      if (!item) return
      if (item.hotline_id !== selectedId) {
        setSelectedId(item.hotline_id)
      }
      setDrawerOpen(true)
    },
    [selectedId]
  )

  const handleSubmitted = useCallback(
    (requestId: string) => {
      toast.success("已发起调用，跳转到调用记录", { description: requestId })
      setDrawerOpen(false)
      navigate(`/caller/calls?selected=${encodeURIComponent(requestId)}&from=calls-retry`)
    },
    [navigate]
  )

  // Empty whole page (no hotlines at all and no search query).
  const isEmpty = !loading && items.length === 0
  const isFilterEmpty = !loading && items.length > 0 && filtered.length === 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-bold">热线目录</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            浏览 Hotline、点「试拨」直接发起调用。结果会自动跳到调用记录。
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => openDrawer(activeHotline as HotlineItem | null)}
          disabled={!activeHotline}
        >
          <Zap className="mr-1.5 h-3.5 w-3.5" />
          试拨当前 Hotline
        </Button>
      </div>

      <FirstCallTipBanner from={fromParam} />

      {isEmpty ? (
        <EmptyCatalogState navigate={navigate} />
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="搜索热线、用途或 task type…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 text-sm"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">可用热线</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-24 w-full" />
                    ))}
                  </div>
                ) : isFilterEmpty ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">没有匹配的热线</div>
                ) : (
                  <div className="space-y-2">
                    {filtered.map((item) => {
                      const active = item.hotline_id === selectedId
                      return (
                        <button
                          key={item.hotline_id}
                          type="button"
                          onClick={() => setSelectedId(item.hotline_id)}
                          className={[
                            "w-full rounded-md border p-3 text-left transition-colors",
                            active ? "border-cyan-500 bg-cyan-500/5" : "hover:bg-muted/40",
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-semibold">
                                  {item.display_name ?? item.hotline_id}
                                </span>
                                <Badge variant="outline" className="text-[10px]">
                                  热线
                                </Badge>
                              </div>
                              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                                {item.hotline_id}
                              </p>
                              {item.description && (
                                <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                                  {item.description}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap gap-1">
                                {(item.task_types ?? []).slice(0, 3).map((taskType) => (
                                  <Badge key={taskType} variant="outline" className="text-[10px]">
                                    {taskType}
                                  </Badge>
                                ))}
                                {(item.tags ?? []).slice(0, 2).map((tag) => (
                                  <Badge key={tag} variant="outline" className="text-[10px]">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant={active ? "default" : "outline"}
                              className={active ? "" : "border-cyan-500/40 text-cyan-700"}
                              onClick={(event) => {
                                event.stopPropagation()
                                openDrawer(item)
                              }}
                            >
                              <Zap className="mr-1.5 h-3.5 w-3.5" />
                              试拨
                            </Button>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm">热线详情</CardTitle>
                  {activeHotline && (
                    <Button size="sm" onClick={() => openDrawer(activeHotline as HotlineItem | null)}>
                      <Zap className="mr-1.5 h-3.5 w-3.5" />
                      试拨
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {detailLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4].map((i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : !activeHotline ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">先从左侧选择一条热线。</p>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold">{activeHotline.display_name ?? activeHotline.hotline_id}</h2>
                        <ReviewBadge status={detail?.review_status} />
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">{activeHotline.hotline_id}</p>
                      {activeHotline.description && (
                        <p className="text-sm text-muted-foreground">{activeHotline.description}</p>
                      )}
                      {detail?.summary && (
                        <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                          {detail.summary}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border bg-muted/20 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">输入摘要</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {detail?.input_summary ?? "当前热线未提供输入摘要。"}
                        </p>
                      </div>
                      <div className="rounded-md border bg-muted/20 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">输出摘要</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {detail?.output_summary ?? "当前热线未提供输出摘要。"}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">输入字段</p>
                        {inputFields.length === 0 ? (
                          <p className="mt-2 text-sm text-muted-foreground">未提供结构化输入字段。</p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {inputFields.map(([field, definition]) => (
                              <div key={field} className="rounded-md border bg-muted/20 px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs">{field}</span>
                                  {definition.type && (
                                    <Badge variant="outline" className="text-[10px]">
                                      {definition.type}
                                    </Badge>
                                  )}
                                </div>
                                {definition.description && (
                                  <p className="mt-1 text-xs text-muted-foreground">{definition.description}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-md border p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">返回字段</p>
                        {outputFields.length === 0 ? (
                          <p className="mt-2 text-sm text-muted-foreground">未提供结构化输出字段。</p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {outputFields.map(([field, definition]) => (
                              <div key={field} className="rounded-md border bg-muted/20 px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs">{field}</span>
                                  {definition.type && (
                                    <Badge variant="outline" className="text-[10px]">
                                      {definition.type}
                                    </Badge>
                                  )}
                                </div>
                                {definition.description && (
                                  <p className="mt-1 text-xs text-muted-foreground">{definition.description}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {(detail?.recommended_for?.length || detail?.limitations?.length) ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md border p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">推荐场景</p>
                          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                            {(detail?.recommended_for ?? []).map((item) => (
                              <li key={item}>• {item}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">限制说明</p>
                          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                            {(detail?.limitations ?? []).map((item) => (
                              <li key={item}>• {item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <TryCallDrawer
        hotline={activeHotline as HotlineItem | null}
        detail={detail}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        prefill={prefillData}
        onSubmitted={handleSubmitted}
      />
    </div>
  )
}
