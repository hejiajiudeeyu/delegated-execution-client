import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { apiCall } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/components/ui/utils"
import {
  Plus,
  Settings,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

type ApprovalMode = "manual" | "allow_listed" | "allow_all"
type ListKey = "responderWhitelist" | "hotlineWhitelist" | "blocklist"

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

interface ListMeta {
  label: string
  title: string
  description: string
  emptyTitle: string
  emptyHint: string
  placeholder: string
  addLabel: string
  icon: typeof ShieldCheck
  iconClass: string
}

const LIST_META: Record<ListKey, ListMeta> = {
  responderWhitelist: {
    label: "Responder",
    title: "Responder 白名单",
    description: "命中名单的 Responder 在「白名单自动放行」模式下会被免审批。",
    emptyTitle: "暂无 Responder 白名单",
    emptyHint: "粘贴 responder_id（如 my-company-bot），或在审批中心点「加入白名单」沉淀过来。",
    placeholder: "responder_id，例如 my-company-bot",
    addLabel: "加入名单",
    icon: ShieldCheck,
    iconClass: "text-cyan-500",
  },
  hotlineWhitelist: {
    label: "Hotline",
    title: "Hotline 白名单",
    description: "命中名单的 Hotline 在「白名单自动放行」模式下会被免审批，不论 Responder 是否在白名单里。",
    emptyTitle: "暂无 Hotline 白名单",
    emptyHint: "粘贴 hotline_id（如 local.delegated-execution.workspace-summary.v1）即可。",
    placeholder: "hotline_id，例如 local.delegated-execution.workspace-summary.v1",
    addLabel: "加入名单",
    icon: ShieldCheck,
    iconClass: "text-cyan-500",
  },
  blocklist: {
    label: "黑名单",
    title: "Blocklist",
    description: "命中名单的 Hotline 一律拒绝，无论当前审批模式如何，也无视白名单。",
    emptyTitle: "暂无封锁项",
    emptyHint: "添加后，所有 Caller 调用这个 Hotline 都会被拒。",
    placeholder: "需要封锁的 hotline_id",
    addLabel: "加入黑名单",
    icon: ShieldBan,
    iconClass: "text-red-500",
  },
}

interface ModeStatus {
  badgeText: string
  badgeClass: string
  alertTone: "amber" | "cyan" | "rose"
  title: string
  message: string
  icon: typeof ShieldCheck
}

function getModeStatus(mode: ApprovalMode): ModeStatus {
  if (mode === "allow_listed") {
    return {
      badgeText: "白名单自动放行",
      badgeClass: "border-cyan-300 bg-cyan-50 text-cyan-700",
      alertTone: "cyan",
      title: "审批模式：白名单自动放行（生效中）",
      message: "命中下方任一白名单的请求会自动放行；其余请求继续走审批中心人工批准。Blocklist 永远生效。",
      icon: ShieldCheck,
    }
  }
  if (mode === "allow_all") {
    return {
      badgeText: "全部自动放行",
      badgeClass: "border-rose-300 bg-rose-50 text-rose-700",
      alertTone: "rose",
      title: "审批模式：全部自动放行",
      message: "所有 Hotline 调用直接执行，无需审批。下方白名单不会被特殊使用，但 Blocklist 仍然会拒绝命中项。",
      icon: ShieldOff,
    }
  }
  return {
    badgeText: "全部手动审批",
    badgeClass: "border-amber-300 bg-amber-50 text-amber-700",
    alertTone: "amber",
    title: "审批模式：全部手动审批",
    message: "下方白名单已保存但当前不会自动放行；切到「白名单自动放行」后才生效。Blocklist 永远生效。",
    icon: ShieldAlert,
  }
}

const ALERT_TONE_CLASS: Record<ModeStatus["alertTone"], string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/20 dark:text-cyan-100",
  rose: "border-rose-200 bg-rose-50 text-rose-900 dark:bg-rose-950/20 dark:text-rose-100",
}

function ModeStatusCard({ mode }: { mode: ApprovalMode }) {
  const status = getModeStatus(mode)
  const Icon = status.icon
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        ALERT_TONE_CLASS[status.alertTone],
      )}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{status.title}</p>
        <p className="mt-1 text-xs opacity-90">{status.message}</p>
      </div>
      <Button
        asChild
        size="sm"
        variant="outline"
        className="shrink-0 bg-background/80 hover:bg-background"
      >
        <Link to="/caller/preferences">
          <Settings className="mr-1.5 h-3.5 w-3.5" />
          切换模式
        </Link>
      </Button>
    </div>
  )
}

function AddRow({
  placeholder,
  buttonLabel,
  onAdd,
  disabled,
}: {
  placeholder: string
  buttonLabel: string
  onAdd: (value: string) => Promise<void> | void
  disabled?: boolean
}) {
  const [value, setValue] = useState("")

  async function submit() {
    const next = value.trim()
    if (!next || disabled) return
    await onAdd(next)
    setValue("")
  }

  return (
    <div className="flex gap-2">
      <Input
        className="h-9 text-xs font-mono placeholder:font-sans placeholder:text-muted-foreground/60"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <Button
        size="sm"
        className="h-9 shrink-0"
        disabled={disabled || !value.trim()}
        onClick={() => void submit()}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        {buttonLabel}
      </Button>
    </div>
  )
}

function ListPanel({
  meta,
  items,
  saving,
  active,
  onAdd,
  onRemove,
}: {
  meta: ListMeta
  items: string[]
  saving: boolean
  active: boolean
  onAdd: (value: string) => Promise<void>
  onRemove: (value: string) => Promise<void>
}) {
  const Icon = meta.icon
  const count = items.length

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className={cn("h-4 w-4", meta.iconClass)} />
            {meta.title}
            <span className="ml-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {count}
            </span>
            {!active && count > 0 && (
              <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                未生效
              </span>
            )}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{meta.description}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {count === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center">
            <Icon className={cn("h-5 w-5 opacity-40", meta.iconClass)} />
            <p className="text-xs font-medium text-foreground">{meta.emptyTitle}</p>
            <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">{meta.emptyHint}</p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-md border bg-background">
            {items.map((item) => (
              <div
                key={item}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <p className="truncate font-mono text-xs">{item}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={saving}
                  onClick={() => void onRemove(item)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  移除
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1.5 border-t border-border pt-3">
          <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            添加新条目
          </Label>
          <AddRow
            placeholder={meta.placeholder}
            buttonLabel={saving ? "保存中…" : meta.addLabel}
            disabled={saving}
            onAdd={onAdd}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function AccessListsPage() {
  const [policy, setPolicy] = useState<GlobalPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await apiCall<GlobalPolicy>("/caller/global-policy")
    if (res.ok && res.data) setPolicy(normalizePolicy(res.data))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(next: GlobalPolicy, successText: string) {
    setSaving(true)
    const res = await apiCall<GlobalPolicy>("/caller/global-policy", {
      method: "PUT",
      body: next,
    })
    setSaving(false)
    if (res.ok && res.data) {
      setPolicy(normalizePolicy(res.data))
      toast.success(successText)
    }
  }

  async function addToList(key: ListKey, value: string) {
    if (!policy) return
    const list = policy[key]
    if (list.includes(value)) {
      toast.info("该条目已在名单中")
      return
    }
    await save({ ...policy, [key]: [...list, value] }, "名单已更新")
  }

  async function removeFromList(key: ListKey, value: string) {
    if (!policy) return
    await save({ ...policy, [key]: policy[key].filter((item) => item !== value) }, "名单已更新")
  }

  if (loading) {
    return (
      <div className="max-w-4xl space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-60 w-full" />
      </div>
    )
  }

  if (!policy) {
    return (
      <Alert variant="destructive">
        <p className="text-sm">无法加载名单策略，请刷新后重试。</p>
      </Alert>
    )
  }

  const isAllowListedMode = policy.mode === "allow_listed"

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold">名单管理</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          维护 Responder / Hotline 白名单与 Blocklist。审批中心的「加入白名单」也会沉淀到这里。
        </p>
      </div>

      <ModeStatusCard mode={policy.mode} />

      <Tabs defaultValue="responderWhitelist" className="space-y-4">
        <TabsList>
          {(Object.keys(LIST_META) as ListKey[]).map((key) => {
            const meta = LIST_META[key]
            const Icon = meta.icon
            const count = policy[key].length
            return (
              <TabsTrigger key={key} value={key} className="gap-1.5 px-3 text-xs">
                <Icon className={cn("h-3.5 w-3.5", meta.iconClass)} />
                <span>{meta.label}</span>
                <span className="ml-0.5 rounded bg-muted px-1.5 py-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {count}
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>

        {(Object.keys(LIST_META) as ListKey[]).map((key) => {
          const meta = LIST_META[key]
          const isWhitelist = key !== "blocklist"
          const active = isWhitelist ? isAllowListedMode : true
          return (
            <TabsContent key={key} value={key}>
              <ListPanel
                meta={meta}
                items={policy[key]}
                saving={saving}
                active={active}
                onAdd={(value) => addToList(key, value)}
                onRemove={(value) => removeFromList(key, value)}
              />
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
