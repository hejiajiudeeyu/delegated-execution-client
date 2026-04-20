import { useEffect, useState } from "react"
import { apiCall } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, ScrollText, Trash2 } from "lucide-react"
import { toast } from "sonner"

interface Hotline {
  hotline_id: string
  display_name?: string
  enabled?: boolean
  adapter_type?: string
  review_status?: string
  submitted_for_review?: boolean
  draft_ready?: boolean
  draft_file?: string | null
  runtime_loaded?: boolean
  local_status?: string
  task_types?: string[]
  capabilities?: string[]
  tags?: string[]
  adapter?: Record<string, unknown>
  metadata?: { registration?: { draft_file?: string } | null } | null
  timeouts?: { soft_timeout_s?: number; hard_timeout_s?: number }
}

interface DraftResponse {
  ok: boolean
  hotline_id: string
  review_status?: string
  submitted_for_review?: boolean
  draft_file: string
  draft: unknown
}

interface DraftDocument {
  display_name?: string
  description?: string
  summary?: string
  template_ref?: string
  task_types?: string[]
  capabilities?: string[]
  tags?: string[]
  input_summary?: string
  output_summary?: string
  input_schema?: unknown
  output_schema?: unknown
  input_examples?: unknown[]
  output_examples?: unknown[]
  recommended_for?: string[]
  not_recommended_for?: string[]
  limitations?: string[]
  contact_email?: string
  support_email?: string | null
}

interface SchemaProperty {
  type?: string
  description?: string
  minLength?: number
  maxLength?: number
  enum?: string[]
}

interface SchemaObjectDocument {
  type?: string
  required?: string[]
  properties?: Record<string, SchemaProperty>
}

function ReviewBadge({ status }: { status?: string }) {
  const v = status === "approved" ? "outline" : status === "rejected" ? "destructive" : "secondary"
  return <Badge variant={v} className="text-[10px] shrink-0">{status ?? "local_only"}</Badge>
}

function DraftSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-background px-3 py-2 font-mono text-[11px] leading-5 text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function SchemaFieldList({
  schema,
  guidanceLabel,
}: {
  schema?: unknown
  guidanceLabel: string
}) {
  const doc = (schema && typeof schema === "object" ? schema : null) as SchemaObjectDocument | null
  const fields = doc?.properties ? Object.entries(doc.properties) : []

  if (!doc || fields.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无结构化字段。</p>
  }

  return (
    <div className="space-y-2">
      {fields.map(([name, field]) => {
        const required = (doc.required || []).includes(name)
        return (
          <div key={name} className="rounded-md border bg-background px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{name}</span>
              <Badge variant={required ? "outline" : "secondary"} className="text-[10px]">
                {required ? "required" : "optional"}
              </Badge>
              {field?.type && <Badge variant="outline" className="text-[10px]">{field.type}</Badge>}
            </div>
            <div className="mt-2 rounded-md border border-dashed bg-muted/30 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{guidanceLabel}</p>
              <p className="mt-1 text-sm text-foreground">{field?.description ?? "—"}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {field?.minLength != null && <span>minLength: {field.minLength}</span>}
              {field?.maxLength != null && <span>maxLength: {field.maxLength}</span>}
              {field?.enum && field.enum.length > 0 && <span>enum: {field.enum.join(", ")}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ValueTree({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">[]</span>
    }
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded-md border bg-background px-3 py-2">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Item {index + 1}</p>
            <ValueTree value={item} />
          </div>
        ))}
      </div>
    )
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      return <span className="text-muted-foreground">{"{}"}</span>
    }
    return (
      <div className="space-y-2">
        {entries.map(([key, nested]) => (
          <div key={key} className="grid gap-1 rounded-md border bg-background px-3 py-2">
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{key}</p>
            <div className="text-sm">
              <ValueTree value={nested} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return <span className="break-words text-sm text-foreground">{String(value)}</span>
}

function HotlineRow({
  hotline, onToggle, onDelete, onShowDraft,
}: {
  hotline: Hotline
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  onShowDraft: (id: string) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{hotline.display_name ?? hotline.hotline_id}</span>
          <ReviewBadge status={hotline.review_status} />
          {hotline.draft_ready && (
            <Badge variant="outline" className="text-[10px]">草稿就绪</Badge>
          )}
          {hotline.runtime_loaded && (
            <Badge variant="outline" className="text-[10px]">本地已加载</Badge>
          )}
          {hotline.adapter_type && (
            <Badge variant="outline" className="text-[10px]">{hotline.adapter_type}</Badge>
          )}
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">{hotline.hotline_id}</p>
        {hotline.task_types && hotline.task_types.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {hotline.task_types.map((t) => (
              <Badge key={t} variant="secondary" className="text-[9px] px-1.5 py-0">{t}</Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 ml-3 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px]"
          onClick={() => onShowDraft(hotline.hotline_id)}
        >
          <ScrollText className="h-3.5 w-3.5" />
          草稿
        </Button>
        <Switch
          checked={hotline.enabled !== false}
          onCheckedChange={(checked) => onToggle(hotline.hotline_id, checked)}
          className="data-[state=checked]:bg-orange-500"
        />
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(hotline.hotline_id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function AddHotlineDialog({
  open, onClose, onAdded,
}: {
  open: boolean; onClose: () => void; onAdded: () => void
}) {
  const [form, setForm] = useState({
    hotline_id: "", display_name: "", adapter_type: "process" as "process" | "http",
    cmd: "", url: "",
    task_types: "", capabilities: "", tags: "",
    soft_timeout_s: "60", hard_timeout_s: "180",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const patch = (k: string, v: string) => setForm({ ...form, [k]: v })

  const handleSave = async () => {
    if (!form.hotline_id) return
    setSaving(true); setError("")
    const adapter = form.adapter_type === "process" ? { cmd: form.cmd } : { url: form.url }
    const res = await apiCall("/responder/hotlines", {
      method: "POST",
      silent: true,
      body: {
        hotline_id: form.hotline_id,
        display_name: form.display_name || form.hotline_id,
        adapter_type: form.adapter_type,
        adapter,
        enabled: true,
        task_types: form.task_types.split(",").map((s) => s.trim()).filter(Boolean),
        capabilities: form.capabilities.split(",").map((s) => s.trim()).filter(Boolean),
        tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
        timeouts: {
          soft_timeout_s: Number(form.soft_timeout_s) || 60,
          hard_timeout_s: Number(form.hard_timeout_s) || 180,
        },
      },
    })
    setSaving(false)
    if (res.ok) {
      onAdded(); onClose()
      setForm({ hotline_id: "", display_name: "", adapter_type: "process", cmd: "", url: "", task_types: "", capabilities: "", tags: "", soft_timeout_s: "60", hard_timeout_s: "180" })
    } else {
      setError(res.error.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>添加 Hotline</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
          {error && <Alert variant="destructive"><p className="text-sm">{error}</p></Alert>}
          <div className="space-y-1.5">
            <Label>Hotline ID *</Label>
            <Input placeholder="my-org.my-skill.v1" value={form.hotline_id} onChange={(e) => patch("hotline_id", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>显示名称</Label>
            <Input placeholder="My Hotline" value={form.display_name} onChange={(e) => patch("display_name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Adapter 类型</Label>
            <div className="flex gap-2">
              {(["process", "http"] as const).map((t) => (
                <button key={t} onClick={() => patch("adapter_type", t)} className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${form.adapter_type === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {form.adapter_type === "process" ? (
            <div className="space-y-1.5">
              <Label>执行命令</Label>
              <Input placeholder="node ./worker.js" value={form.cmd} onChange={(e) => patch("cmd", e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>HTTP URL</Label>
              <Input placeholder="http://localhost:9090/execute" value={form.url} onChange={(e) => patch("url", e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Task Types（逗号分隔）</Label>
            <Input placeholder="text_summarize, code_review" value={form.task_types} onChange={(e) => patch("task_types", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Capabilities（逗号分隔）</Label>
            <Input placeholder="text.summarize, code.review" value={form.capabilities} onChange={(e) => patch("capabilities", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Tags（逗号分隔）</Label>
            <Input placeholder="local, example" value={form.tags} onChange={(e) => patch("tags", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Soft Timeout (s)</Label>
              <Input type="number" value={form.soft_timeout_s} onChange={(e) => patch("soft_timeout_s", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Hard Timeout (s)</Label>
              <Input type="number" value={form.hard_timeout_s} onChange={(e) => patch("hard_timeout_s", e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !form.hotline_id}>{saving ? "保存中…" : "添加"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ResponderHotlinesPage() {
  const [hotlines, setHotlines] = useState<Hotline[]>([])
  const [platformEnabled, setPlatformEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)
  const [selectedDraft, setSelectedDraft] = useState<DraftResponse | null>(null)

  const load = async () => {
    const res = await apiCall<{ items: Hotline[]; platform_enabled?: boolean }>("/responder/hotlines")
    if (res.ok && res.data) {
      setHotlines(res.data.items ?? [])
      setPlatformEnabled(res.data.platform_enabled === true)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleToggle = async (id: string, enabled: boolean) => {
    await apiCall(`/responder/hotlines/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, { method: "POST" })
    load()
  }

  const handleDelete = async (id: string) => {
    await apiCall(`/responder/hotlines/${encodeURIComponent(id)}`, { method: "DELETE" })
    load()
  }

  const handleAddExample = async () => {
    await apiCall("/responder/hotlines/example", { method: "POST" })
    load()
  }

  const handleShowDraft = async (id: string) => {
    setDraftLoading(true)
    setDraftOpen(true)
    const res = await apiCall<DraftResponse>(`/responder/hotlines/${encodeURIComponent(id)}/draft`, { silent: true })
    setDraftLoading(false)
    if (res.ok && res.data) {
      setSelectedDraft(res.data)
      return
    }
    setSelectedDraft(null)
    toast.error("读取草稿失败", {
      description: res.ok ? "请稍后重试" : res.error.message,
    })
  }

  const draftDoc = (selectedDraft?.draft ?? null) as DraftDocument | null

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold">Hotline 管理</h1>
          <p className="text-xs text-muted-foreground mt-0.5">先管理本地 Hotline 和草稿，再按需发布到平台</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddExample}
            title="插入一个官方示例 Hotline（example-hotline-worker.js），用于快速验证 Responder 功能是否正常"
          >
            添加示例
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />添加
          </Button>
        </div>
      </div>

      <Card className="border-dashed bg-muted/30">
        <CardContent className="pt-3 pb-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">添加示例</span> — 会插入一个官方内置的示例 Hotline（运行 <code className="font-mono bg-muted px-1 rounded">example-hotline-worker.js</code>），可用于快速测试 Responder 是否正常工作。示例不会影响生产 Hotline。
          </p>
        </CardContent>
      </Card>

      <Card className={platformEnabled ? "border-violet-500/30 bg-violet-500/5" : "border-blue-500/30 bg-blue-500/5"}>
        <CardContent className="pt-3 pb-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">{platformEnabled ? "平台发布已开启" : "当前为本地模式"}</span>
            {platformEnabled
              ? " — Hotline 会先生成本地草稿，再由你决定是否提交到平台 catalog。"
              : " — 你现在看到的是热线的本地配置与草稿视图。本地模式下无需平台审批，也可以先直接调试本地 Hotline。"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          {loading ? (
            <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : hotlines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">暂无 Hotline，点击「添加」或「添加示例」</p>
          ) : (
            hotlines.map((h) => (
              <HotlineRow
                key={h.hotline_id}
                hotline={h}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onShowDraft={handleShowDraft}
              />
            ))
          )}
        </CardContent>
      </Card>

      <AddHotlineDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={load} />

      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent className="h-[88vh] w-[96vw] max-w-none overflow-hidden px-8 sm:max-w-[96vw] xl:max-w-[1600px]">
          <DialogHeader>
            <DialogTitle>注册草稿</DialogTitle>
          </DialogHeader>
          {draftLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-[360px] w-full" />
            </div>
          ) : selectedDraft ? (
            <ScrollArea className="h-[calc(88vh-180px)] pr-4">
              <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{selectedDraft.hotline_id}</Badge>
                <Badge variant="outline">{selectedDraft.draft_ready ? "本地草稿已生成" : "草稿待生成"}</Badge>
                <Badge variant={selectedDraft.submitted_for_review ? "outline" : "secondary"} className="text-[10px]">
                  {selectedDraft.submitted_for_review ? "已提交" : "未提交"}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {selectedDraft.review_status ?? "local_only"}
                </Badge>
              </div>
              <Alert>
                <p className="text-sm">
                  {selectedDraft.platform_enabled
                    ? "这是本地草稿与平台发布共用的配置视图。先确认本地草稿，再决定是否提交到平台。"
                    : "这是本地 Hotline 的主配置草稿视图。在本地模式下，你可以直接基于这份草稿调试，不需要先提交平台审核。"}
                </p>
              </Alert>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Draft File</p>
                <div className="mt-1 overflow-x-auto">
                  <p className="font-mono text-xs text-foreground whitespace-nowrap">{selectedDraft.draft_file}</p>
                </div>
              </div>
              {draftDoc && (
                <>
                  <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="w-full justify-start overflow-x-auto">
                      <TabsTrigger value="overview">概览</TabsTrigger>
                      <TabsTrigger value="contract">契约</TabsTrigger>
                      <TabsTrigger value="examples">示例</TabsTrigger>
                      <TabsTrigger value="guidance">使用建议</TabsTrigger>
                      <TabsTrigger value="raw">原始</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-3 pt-2">
                      <div className="grid gap-3 2xl:grid-cols-2">
                        <DraftSection title="Display">
                          <div className="space-y-2 text-sm">
                            <div>
                              <p className="text-muted-foreground">显示名称</p>
                              <p className="font-medium">{draftDoc.display_name ?? "—"}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">摘要说明</p>
                              <p>{draftDoc.summary ?? "—"}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">详细描述</p>
                              <p>{draftDoc.description ?? "—"}</p>
                            </div>
                          </div>
                        </DraftSection>
                        <DraftSection title="Binding">
                          <div className="space-y-2 text-sm">
                            <div>
                              <p className="text-muted-foreground">Template Ref</p>
                              <p className="break-all font-mono text-xs">{draftDoc.template_ref ?? "—"}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Task Types</p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(draftDoc.task_types || []).map((item) => (
                                  <Badge key={item} variant="secondary" className="text-[10px]">{item}</Badge>
                                ))}
                                {(!draftDoc.task_types || draftDoc.task_types.length === 0) && <span>—</span>}
                              </div>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Capabilities</p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(draftDoc.capabilities || []).map((item) => (
                                  <Badge key={item} variant="outline" className="text-[10px]">{item}</Badge>
                                ))}
                                {(!draftDoc.capabilities || draftDoc.capabilities.length === 0) && <span>—</span>}
                              </div>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Tags</p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(draftDoc.tags || []).map((item) => (
                                  <Badge key={item} variant="outline" className="text-[10px]">{item}</Badge>
                                ))}
                                {(!draftDoc.tags || draftDoc.tags.length === 0) && <span>—</span>}
                              </div>
                            </div>
                          </div>
                        </DraftSection>
                      </div>

                      <div className="grid gap-3 2xl:grid-cols-2">
                        <DraftSection title="Input Summary">
                          <p className="text-sm text-muted-foreground">{draftDoc.input_summary ?? "—"}</p>
                        </DraftSection>
                        <DraftSection title="Output Summary">
                          <p className="text-sm text-muted-foreground">{draftDoc.output_summary ?? "—"}</p>
                        </DraftSection>
                      </div>

                      <DraftSection title="Contacts">
                        <div className="grid gap-3 md:grid-cols-2 text-sm">
                          <div>
                            <p className="text-muted-foreground">Contact Email</p>
                            <p>{draftDoc.contact_email ?? "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Support Email</p>
                            <p>{draftDoc.support_email ?? "—"}</p>
                          </div>
                        </div>
                      </DraftSection>
                    </TabsContent>

                    <TabsContent value="contract" className="space-y-3 pt-2">
                      <div className="grid gap-3 2xl:grid-cols-2">
                        <DraftSection title="Input Contract">
                          <SchemaFieldList schema={draftDoc.input_schema} guidanceLabel="填写说明" />
                        </DraftSection>
                        <DraftSection title="Output Contract">
                          <SchemaFieldList schema={draftDoc.output_schema} guidanceLabel="返回字段说明" />
                        </DraftSection>
                      </div>
                    </TabsContent>

                    <TabsContent value="examples" className="space-y-3 pt-2">
                      <div className="grid gap-3 md:grid-cols-2">
                        <DraftSection title="Input Examples">
                          <ValueTree value={draftDoc.input_examples ?? []} />
                        </DraftSection>
                        <DraftSection title="Output Examples">
                          <ValueTree value={draftDoc.output_examples ?? []} />
                        </DraftSection>
                      </div>
                    </TabsContent>

                    <TabsContent value="guidance" className="space-y-3 pt-2">
                      <div className="grid gap-3 2xl:grid-cols-3">
                        <DraftSection title="Recommended For">
                          <ValueTree value={draftDoc.recommended_for ?? []} />
                        </DraftSection>
                        <DraftSection title="Not Recommended">
                          <ValueTree value={draftDoc.not_recommended_for ?? []} />
                        </DraftSection>
                        <DraftSection title="Limitations">
                          <ValueTree value={draftDoc.limitations ?? []} />
                        </DraftSection>
                      </div>
                    </TabsContent>

                    <TabsContent value="raw" className="space-y-3 pt-2">
                      <DraftSection title="Raw JSON">
                        <JsonPreview value={selectedDraft.draft} />
                      </DraftSection>
                    </TabsContent>
                  </Tabs>
                </>
              )}
              </div>
            </ScrollArea>
          ) : (
            <Alert variant="destructive">
              <p className="text-sm">未能读取该 Hotline 的注册草稿。</p>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraftOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
