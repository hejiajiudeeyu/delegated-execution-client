import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { apiCall } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Search, Send, Zap } from "lucide-react"

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

export function CatalogPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<HotlineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [detail, setDetail] = useState<HotlineDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

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

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId("")
      setDetail(null)
      return
    }
    if (!selectedId || !filtered.some((item) => item.hotline_id === selectedId)) {
      setSelectedId(filtered[0].hotline_id)
    }
  }, [filtered, selectedId])

  useEffect(() => {
    async function loadDetail() {
      if (!selectedId) {
        setDetail(null)
        return
      }
      setDetailLoading(true)
      const res = await apiCall<HotlineDetail>(`/catalog/hotlines/${encodeURIComponent(selectedId)}`, { silent: true })
      setDetail(res.ok ? res.data ?? null : null)
      setDetailLoading(false)
    }
    void loadDetail()
  }, [selectedId])

  const selectedItem = filtered.find((item) => item.hotline_id === selectedId) ?? null
  const activeDetail = detail ?? selectedItem
  const inputFields = Object.entries(detail?.input_schema?.properties ?? {})
  const outputFields = Object.entries(detail?.output_schema?.properties ?? {})

  function startCall(item: HotlineItem | HotlineDetail | null) {
    if (!item) return
    const params = new URLSearchParams({
      hotline_id: item.hotline_id,
    })
    if (item.responder_id) params.set("responder_id", item.responder_id)
    if (item.task_types?.[0]) params.set("task_type", item.task_types[0])
    navigate(`/caller/calls/new?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-bold">热线目录</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            先选热线，再看输入输出摘要，确认适合后再进入调用页。
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => activeDetail && startCall(activeDetail)}
          disabled={!activeDetail}
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          发起调用
        </Button>
      </div>

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
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {query ? "没有匹配的热线" : "暂无可用热线"}
              </div>
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
                            <Badge variant="outline" className="text-[10px]">热线</Badge>
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
                            startCall(item)
                          }}
                        >
                          <Zap className="mr-1.5 h-3.5 w-3.5" />
                          调用
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
            <CardTitle className="text-sm">热线详情</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {detailLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : !activeDetail ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                先从左侧选择一条热线。
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{activeDetail.display_name ?? activeDetail.hotline_id}</h2>
                    <ReviewBadge status={detail?.review_status} />
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{activeDetail.hotline_id}</p>
                  {activeDetail.description && (
                    <p className="text-sm text-muted-foreground">{activeDetail.description}</p>
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
                                <Badge variant="outline" className="text-[10px]">{definition.type}</Badge>
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
                                <Badge variant="outline" className="text-[10px]">{definition.type}</Badge>
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
    </div>
  )
}
