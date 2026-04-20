import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { apiCall } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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

interface ModeOption {
  value: ApprovalMode
  label: string
  desc: string
  icon: React.ElementType
  color: string
}

const MODE_OPTIONS: ModeOption[] = [
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

const MODE_LABEL: Record<ApprovalMode, string> = {
  manual: "全部手动审批",
  allow_listed: "白名单自动放行",
  allow_all: "全部自动放行",
}

interface ModeChangeImpact {
  destructive: boolean
  title: string
  summary: string
  bullets: { tone: "neutral" | "good" | "warn" | "danger"; text: string }[]
  confirmLabel: string
}

function describeModeChange(from: ApprovalMode, to: ApprovalMode, policy: GlobalPolicy): ModeChangeImpact {
  const wlR = policy.responderWhitelist.length
  const wlH = policy.hotlineWhitelist.length
  const bl = policy.blocklist.length
  const hasLists = wlR + wlH + bl > 0

  if (to === "allow_all") {
    return {
      destructive: true,
      title: "切换到「全部自动放行」",
      summary: `将从「${MODE_LABEL[from]}」切到「${MODE_LABEL[to]}」。后续 Agent 发起的所有 Hotline 调用都会立即执行，不再人工审核。`,
      bullets: [
        { tone: "danger", text: "所有 Hotline / Responder 调用直接放行（含未在白名单中的项）" },
        { tone: "warn", text: "Blocklist 仍然生效，但白名单将不再被特殊使用" },
        hasLists
          ? { tone: "neutral", text: `已有 ${wlR} 项 Responder 白名单 / ${wlH} 项 Hotline 白名单 / ${bl} 项 Blocklist —— 名单内容保留，未删除` }
          : { tone: "neutral", text: "当前没有任何白名单/黑名单" },
        { tone: "warn", text: "建议仅在隔离环境或调试时使用" },
      ],
      confirmLabel: "我已确认风险，切换到 allow_all",
    }
  }

  if (to === "allow_listed") {
    return {
      destructive: false,
      title: "切换到「白名单自动放行」",
      summary: `将从「${MODE_LABEL[from]}」切到「${MODE_LABEL[to]}」。命中白名单的请求会自动放行，其余仍需人工审批。`,
      bullets: [
        wlR > 0
          ? { tone: "good", text: `${wlR} 项 Responder 白名单 → 命中后自动放行` }
          : { tone: "neutral", text: "Responder 白名单：空（暂时无 Responder 自动放行）" },
        wlH > 0
          ? { tone: "good", text: `${wlH} 项 Hotline 白名单 → 命中后自动放行` }
          : { tone: "neutral", text: "Hotline 白名单：空（暂时无 Hotline 自动放行）" },
        bl > 0
          ? { tone: "good", text: `${bl} 项 Blocklist → 命中后直接拒绝` }
          : { tone: "neutral", text: "Blocklist：空" },
        from === "allow_all"
          ? { tone: "good", text: "未命中白名单的请求将重新需要在「审批中心」人工批准" }
          : { tone: "neutral", text: "未命中白名单的请求仍需在「审批中心」人工批准" },
      ],
      confirmLabel: "切换到 allow_listed",
    }
  }

  return {
    destructive: false,
    title: "切换到「全部手动审批」",
    summary: `将从「${MODE_LABEL[from]}」切到「${MODE_LABEL[to]}」。所有 Hotline 调用都需要在审批中心人工批准。`,
    bullets: [
      from === "allow_all"
        ? { tone: "good", text: "Agent 不再自动放行任何调用，全部回到人工审批" }
        : { tone: "good", text: "白名单不再用于自动放行；命中白名单的请求也需人工审批" },
      hasLists
        ? { tone: "neutral", text: `白名单 ${wlR + wlH} 项 / Blocklist ${bl} 项 —— 名单内容保留，可在「名单管理」中维护` }
        : { tone: "neutral", text: "当前没有任何白名单/黑名单" },
      { tone: "good", text: "Blocklist 在所有模式下都生效，命中即拒绝" },
    ],
    confirmLabel: "切换到 manual",
  }
}

function GlobalPolicyCard() {
  const [policy, setPolicy] = useState<GlobalPolicy | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingMode, setPendingMode] = useState<ApprovalMode | null>(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const res = await apiCall<GlobalPolicy>("/caller/global-policy", { silent: true })
    if (res.ok && res.data) setPolicy(normalizePolicy(res.data))
  }, [])

  useEffect(() => { void load() }, [load])

  const persist = async (updated: GlobalPolicy) => {
    setSaving(true)
    const res = await apiCall<GlobalPolicy>("/caller/global-policy", {
      method: "PUT",
      silent: true,
      body: updated,
    })
    setSaving(false)
    if (res.ok && res.data) {
      setPolicy(normalizePolicy(res.data))
      toast.success("审批策略已保存")
    } else {
      toast.error("保存失败，请重试", { description: res.ok ? undefined : res.error.message })
    }
  }

  const handleSelectMode = (next: ApprovalMode) => {
    if (!policy || policy.mode === next) return
    setPendingMode(next)
  }

  const confirmModeChange = async () => {
    if (!policy || !pendingMode) return
    const target = pendingMode
    setPendingMode(null)
    await persist({ ...policy, mode: target })
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

  const impact = pendingMode ? describeModeChange(policy.mode, pendingMode, policy) : null

  return (
    <>
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
          <div className="space-y-2">
            {MODE_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const active = policy.mode === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => handleSelectMode(opt.value)}
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

      <AlertDialog open={pendingMode !== null} onOpenChange={(open) => { if (!open) setPendingMode(null) }}>
        <AlertDialogContent>
          {impact && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className={cn("flex items-center gap-2", impact.destructive && "text-destructive")}>
                  {impact.destructive
                    ? <ShieldOff className="h-4 w-4" />
                    : <ShieldCheck className="h-4 w-4 text-cyan-500" />}
                  {impact.title}
                </AlertDialogTitle>
                <AlertDialogDescription>{impact.summary}</AlertDialogDescription>
              </AlertDialogHeader>

              <ul className="space-y-1.5 text-xs my-2">
                {impact.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                        b.tone === "danger" && "bg-destructive",
                        b.tone === "warn" && "bg-amber-500",
                        b.tone === "good" && "bg-emerald-500",
                        b.tone === "neutral" && "bg-muted-foreground/50",
                      )}
                    />
                    <span className={cn(b.tone === "neutral" && "text-muted-foreground")}>{b.text}</span>
                  </li>
                ))}
              </ul>

              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmModeChange}
                  className={cn(
                    impact.destructive &&
                      "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/40",
                  )}
                >
                  {impact.confirmLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function PreferencesPage() {
  const [prefs, setPrefs] = useState<TaskTypePreference[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({ task_type: "", hotline_id: "" })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const res = await apiCall<{ items: TaskTypePreference[] }>("/preferences/task-types", { silent: true })
    if (res.ok && res.data?.items) setPrefs(res.data.items)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const handleSave = async () => {
    if (!editing.task_type || !editing.hotline_id) return
    setSaving(true)
    const res = await apiCall(`/preferences/task-types/${encodeURIComponent(editing.task_type)}/hotline`, {
      method: "PUT", body: { hotline_id: editing.hotline_id }, silent: true,
    })
    setSaving(false)
    if (!res.ok) {
      toast.error("保存失败", { description: res.error.message })
      return
    }
    setEditing({ task_type: "", hotline_id: "" })
    toast.success("路由规则已保存")
    load()
  }

  const handleDelete = async (taskType: string) => {
    const res = await apiCall(`/preferences/task-types/${encodeURIComponent(taskType)}/hotline`, {
      method: "PUT", body: { hotline_id: null }, silent: true,
    })
    if (!res.ok) {
      toast.error("删除失败", { description: res.error.message })
      return
    }
    load()
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <h1 className="text-base font-bold">偏好设置</h1>
        <p className="text-xs text-muted-foreground mt-0.5">审批策略与自动路由规则</p>
      </div>

      <GlobalPolicyCard />

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
