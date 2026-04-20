import { useCallback, useEffect, useMemo, useState } from "react"
import { apiCall } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ListChecks, Plus, ShieldBan, ShieldCheck, Trash2 } from "lucide-react"
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

const LIST_META: Record<ListKey, {
  label: string
  title: string
  description: string
  placeholder: string
  addLabel: string
  emptyText: string
  icon: typeof ShieldCheck
  iconClass: string
}> = {
  responderWhitelist: {
    label: "Responder 白名单",
    title: "Responder 白名单",
    description: "来自这些 Responder 的调用可在白名单模式下自动放行。",
    placeholder: "my-company-bot",
    addLabel: "加入 Responder",
    emptyText: "暂无 Responder 白名单",
    icon: ShieldCheck,
    iconClass: "text-cyan-500",
  },
  hotlineWhitelist: {
    label: "Hotline 白名单",
    title: "Hotline 白名单",
    description: "指定 Hotline 可在白名单模式下自动放行，不受 Responder 限制。",
    placeholder: "local.delegated-execution.workspace-summary.v1",
    addLabel: "加入 Hotline",
    emptyText: "暂无 Hotline 白名单",
    icon: ShieldCheck,
    iconClass: "text-cyan-500",
  },
  blocklist: {
    label: "黑名单",
    title: "黑名单 / Blocklist",
    description: "这里的 Hotline 会被强制拒绝，无论当前审批模式如何。",
    placeholder: "输入需要阻止的 hotline_id",
    addLabel: "加入黑名单",
    emptyText: "暂无黑名单",
    icon: ShieldBan,
    iconClass: "text-red-500",
  },
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
        className="h-9 text-xs font-mono"
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
      <Button size="sm" variant="outline" className="h-9" disabled={disabled} onClick={() => void submit()}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        {buttonLabel}
      </Button>
    </div>
  )
}

function ListPanel({
  title,
  description,
  items,
  emptyText,
  placeholder,
  addLabel,
  saving,
  onAdd,
  onRemove,
}: {
  title: string
  description: string
  items: string[]
  emptyText: string
  placeholder: string
  addLabel: string
  saving: boolean
  onAdd: (value: string) => Promise<void>
  onRemove: (value: string) => Promise<void>
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{description}</p>

        <AddRow
          placeholder={placeholder}
          buttonLabel={saving ? "保存中…" : addLabel}
          disabled={saving}
          onAdd={onAdd}
        />

        {items.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{item}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 border-red-300 text-red-600 hover:bg-red-50"
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

  const isAllowListedMode = policy?.mode === "allow_listed"

  const modeBadge = useMemo(() => {
    if (!policy) return null
    if (policy.mode === "allow_listed") return { label: "白名单自动放行", className: "bg-cyan-100 text-cyan-700" }
    if (policy.mode === "allow_all") return { label: "全部自动放行", className: "bg-rose-100 text-rose-700" }
    return { label: "全部手动审批", className: "bg-amber-100 text-amber-700" }
  }, [policy])

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
      toast.info("该条目已存在")
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
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
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

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-bold">名单管理</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            用 tab 切换不同名单，并在列表中直接完成新增和移除。审批页里的“加入白名单”也会沉淀到这里。
          </p>
        </div>
        {modeBadge && (
          <Badge className={modeBadge.className}>{modeBadge.label}</Badge>
        )}
      </div>

      {!isAllowListedMode && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <p className="ml-2 text-xs">
            当前审批模式不是 <code className="rounded bg-muted px-1">allow_listed</code>，
            所以白名单已保存，但不会自动放行，除非你在「偏好设置」里切换策略。
          </p>
        </Alert>
      )}

      <Tabs defaultValue="responderWhitelist" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          {(Object.keys(LIST_META) as ListKey[]).map((key) => {
            const meta = LIST_META[key]
            const Icon = meta.icon
            const count = policy[key].length
            return (
              <TabsTrigger key={key} value={key} className="gap-2 text-xs">
                <Icon className={`h-3.5 w-3.5 ${meta.iconClass}`} />
                <span>{meta.label}</span>
                <Badge variant="outline" className="text-[10px]">{count}</Badge>
              </TabsTrigger>
            )
          })}
        </TabsList>

        {(Object.keys(LIST_META) as ListKey[]).map((key) => {
          const meta = LIST_META[key]
          return (
            <TabsContent key={key} value={key}>
              <ListPanel
                title={meta.title}
                description={meta.description}
                items={policy[key]}
                emptyText={meta.emptyText}
                placeholder={meta.placeholder}
                addLabel={meta.addLabel}
                saving={saving}
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
