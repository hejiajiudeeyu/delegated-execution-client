import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { requestJson } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert } from "@/components/ui/alert"
import {
  Settings,
  Save,
  Trash2,
  Info,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ListChecks,
} from "lucide-react"
import { cn } from "@/components/ui/utils"
import { toast } from "sonner"

// ─── Types ───────────────────────────────────────────────────────────────────
type ApprovalMode = "manual" | "allow_listed" | "allow_all"

interface GlobalPolicy {
  mode: ApprovalMode
  responderWhitelist: string[]
  hotlineWhitelist: string[]
  blocklist: string[]
}

function normalizePolicy(input: Partial<GlobalPolicy> | null | undefined): GlobalPolicy {
  return {
    mode: input?.mode ?? "manual",
    responderWhitelist: Array.isArray(input?.responderWhitelist) ? input!.responderWhitelist : [],
    hotlineWhitelist: Array.isArray(input?.hotlineWhitelist) ? input!.hotlineWhitelist : [],
    blocklist: Array.isArray(input?.blocklist) ? input!.blocklist : [],
  }
}

interface TaskTypePreference {
  task_type: string
  hotline_id?: string
  responder_id?: string
}

const MODE_OPTIONS: {
  value: ApprovalMode
  label: string
  desc: string
  icon: React.ElementType
  color: string
}[] = [
  {
    value: "manual",
    label: "全部手动审批",
    desc: "每次调用都需要在审批中心手动批准（推荐，最安全）",
    icon: ShieldAlert,
    color: "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  },
  {
    value: "allow_listed",
    label: "白名单自动放行",
    desc: "白名单内的 Responder 或 Hotline 自动批准；其余仍需手动审批",
    icon: ShieldCheck,
    color: "border-cyan-400 bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-400",
  },
  {
    value: "allow_all",
    label: "全部自动放行",
    desc: "所有调用直接执行，无需审批（不建议在生产环境使用）",
    icon: ShieldOff,
    color: "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400",
  },
]

function GlobalPolicyCard() {
  const [policy, setPolicy] = useState<GlobalPolicy | null>(null)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const res = await requestJson<GlobalPolicy>("/caller/global-policy")
    if (res.status === 200 && res.body) setPolicy(normalizePolicy(res.body))
  }, [])

  useEffect(() => { load() }, [load])

  const save = async (updated: GlobalPolicy) => {
    setSaving(true)
    const res = await requestJson<GlobalPolicy>("/caller/global-policy", {
      method: "PUT",
      body: updated,
    })
    setSaving(false)
    if (res.status === 200 && res.body) {
      setPolicy(normalizePolicy(res.body))
      toast.success("审批策略已保存")
    } else {
      toast.error("保存失败，请重试")
    }
  }

  const patch = (partial: Partial<GlobalPolicy>) => {
    if (!policy) return
    const updated = { ...policy, ...partial }
    setPolicy(updated)
    save(updated)
  }

  if (!policy) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-cyan-500" />
          安全审批策略
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          控制 Agent 发起 Hotline 调用时是否需要人工审批
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode selector */}
        <div className="space-y-2">
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const active = policy.mode === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => !active && patch({ mode: opt.value })}
                className={cn(
                  "w-full flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-all",
                  active ? opt.color : "border-border bg-background hover:bg-muted/50"
                )}
              >
                <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", active ? "" : "text-muted-foreground")} />
                <div>
                  <p className={cn("text-sm font-semibold", !active && "text-foreground")}>{opt.label}</p>
                  <p className={cn("text-xs mt-0.5", active ? "opacity-80" : "text-muted-foreground")}>{opt.desc}</p>
                </div>
                {active && saving && <span className="ml-auto text-[10px] opacity-60">保存中…</span>}
              </button>
            )
          })}
        </div>

        <div className="space-y-2 pt-2 border-t border-border">
          <div>
            <Label className="text-xs font-semibold">名单策略说明</Label>
            <p className="text-[11px] text-muted-foreground">
              白名单、黑名单和封锁策略已拆到独立的「名单管理」页面，便于从审批中心或 Catalog 长期维护。
            </p>
          </div>
          <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              Responder 白名单：<span className="font-mono text-foreground">{policy.responderWhitelist.length}</span>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              Hotline 白名单：<span className="font-mono text-foreground">{policy.hotlineWhitelist.length}</span>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              Blocklist：<span className="font-mono text-foreground">{policy.blocklist.length}</span>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate("/caller/lists")}>
            <ListChecks className="mr-1.5 h-3.5 w-3.5" />
            打开名单管理
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export function PreferencesPage() {
  const [prefs, setPrefs] = useState<TaskTypePreference[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({ task_type: "", hotline_id: "" })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const res = await requestJson<{ items: TaskTypePreference[] }>("/preferences/task-types")
    if (res.body?.items) setPrefs(res.body.items)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSave = async () => {
    if (!editing.task_type || !editing.hotline_id) return
    setSaving(true)
    await requestJson(`/preferences/task-types/${encodeURIComponent(editing.task_type)}/hotline`, {
      method: "PUT", body: { hotline_id: editing.hotline_id },
    })
    setSaving(false)
    setEditing({ task_type: "", hotline_id: "" })
    load()
  }

  const handleDelete = async (taskType: string) => {
    await requestJson(`/preferences/task-types/${encodeURIComponent(taskType)}/hotline`, {
      method: "PUT", body: { hotline_id: null },
    })
    load()
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <h1 className="text-base font-bold">偏好设置</h1>
        <p className="text-xs text-muted-foreground mt-0.5">审批策略与自动路由规则</p>
      </div>

      {/* Security policy */}
      <GlobalPolicyCard />

      {/* Routing preferences */}
      <div className="pt-2">
        <h2 className="text-sm font-semibold">自动路由偏好</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          当 Agent 发起指定 task_type 请求时，自动路由到首选 Hotline
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <p className="text-xs ml-2">
          为常用任务类型（如 <code className="bg-muted px-1 rounded">text_summarize</code>）指定默认 Hotline，
          Caller 会自动选择对应的 Hotline 而无需手动指定。
        </p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Settings className="h-4 w-4" /> 添加路由规则
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Task Type</Label>
            <Input
              placeholder="text_summarize"
              value={editing.task_type}
              onChange={(e) => setEditing({ ...editing, task_type: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>首选 Hotline ID</Label>
            <Input
              placeholder="从 Catalog 中选取 Hotline ID"
              value={editing.hotline_id}
              onChange={(e) => setEditing({ ...editing, hotline_id: e.target.value })}
            />
          </div>
          <Button
            size="sm" onClick={handleSave}
            disabled={saving || !editing.task_type || !editing.hotline_id}
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "保存中…" : "保存"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>当前路由规则</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : prefs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">暂无规则，所有请求需手动指定 Hotline</p>
          ) : (
            <div className="space-y-2">
              {prefs.map((pref) => (
                <div key={pref.task_type} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">{pref.task_type}</Badge>
                    <span className="text-muted-foreground text-xs">→</span>
                    <span className="text-xs font-mono">{pref.hotline_id ?? "–"}</span>
                  </div>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(pref.task_type)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
