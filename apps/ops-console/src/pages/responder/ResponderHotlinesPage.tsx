import { useEffect, useState } from "react"
import { requestJson } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Trash2 } from "lucide-react"

interface Hotline {
  hotline_id: string
  display_name?: string
  enabled?: boolean
  adapter_type?: string
  review_status?: string
  submitted_for_review?: boolean
  task_types?: string[]
  capabilities?: string[]
  tags?: string[]
  adapter?: Record<string, unknown>
  timeouts?: { soft_timeout_s?: number; hard_timeout_s?: number }
}

function ReviewBadge({ status }: { status?: string }) {
  const v = status === "approved" ? "outline" : status === "rejected" ? "destructive" : "secondary"
  return <Badge variant={v} className="text-[10px] shrink-0">{status ?? "local_only"}</Badge>
}

function HotlineRow({
  hotline, onToggle, onDelete,
}: {
  hotline: Hotline
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{hotline.display_name ?? hotline.hotline_id}</span>
          <ReviewBadge status={hotline.review_status} />
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
    const res = await requestJson("/responder/hotlines", {
      method: "POST",
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
    if (res.status === 201 || res.status === 200) {
      onAdded(); onClose()
      setForm({ hotline_id: "", display_name: "", adapter_type: "process", cmd: "", url: "", task_types: "", capabilities: "", tags: "", soft_timeout_s: "60", hard_timeout_s: "180" })
    } else {
      const err = res.body as { error?: { message?: string } } | null
      setError(err?.error?.message ?? "添加失败")
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
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  const load = async () => {
    const res = await requestJson<{ items: Hotline[] }>("/responder/hotlines")
    if (res.body?.items) setHotlines(res.body.items)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleToggle = async (id: string, enabled: boolean) => {
    await requestJson(`/responder/hotlines/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, { method: "POST" })
    load()
  }

  const handleDelete = async (id: string) => {
    await requestJson(`/responder/hotlines/${encodeURIComponent(id)}`, { method: "DELETE" })
    load()
  }

  const handleAddExample = async () => {
    await requestJson("/responder/hotlines/example", { method: "POST" })
    load()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold">Hotline 管理</h1>
          <p className="text-xs text-muted-foreground mt-0.5">添加、配置和管理你的 Hotline</p>
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

      <Card>
        <CardContent className="pt-5">
          {loading ? (
            <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : hotlines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">暂无 Hotline，点击「添加」或「添加示例」</p>
          ) : (
            hotlines.map((h) => (
              <HotlineRow key={h.hotline_id} hotline={h} onToggle={handleToggle} onDelete={handleDelete} />
            ))
          )}
        </CardContent>
      </Card>

      <AddHotlineDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={load} />
    </div>
  )
}
