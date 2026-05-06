import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useStatus } from "@/hooks/useStatus"
import { usePoll } from "@/hooks/usePoll"
import { apiCall } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Server, Wifi, Zap, Globe, RotateCcw, ArrowRight, UserPlus, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { isCallerRegistered } from "@/lib/status"
import { PlatformValueDisclosure } from "@/components/dashboard/PlatformValueDisclosure"
import { NextUpCard } from "@/components/dashboard/NextUpCard"

interface RequestItem {
  request_id: string
  status?: string
}

function HealthDot({ ok }: { ok: boolean | undefined | null }) {
  if (ok === undefined || ok === null)
    return <span className="h-2 w-2 rounded-full bg-muted-foreground/40 inline-block" />
  return (
    <span
      className={`h-2 w-2 rounded-full inline-block ${ok ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-red-500"}`}
    />
  )
}

function ServiceRow({
  name,
  ok,
  label,
  onRestart,
  restarting,
}: {
  name: string
  ok: boolean | undefined | null
  label: string
  onRestart?: () => void
  restarting?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <div className="flex items-center gap-2.5">
        <HealthDot ok={ok} />
        <span className="text-sm font-medium">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        {onRestart && ok === false && (
          <button
            onClick={onRestart}
            disabled={restarting}
            title="重启服务"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
          >
            <RotateCcw className={`h-3 w-3 ${restarting ? "animate-spin" : ""}`} />
            {restarting ? "重启中" : "重启"}
          </button>
        )}
        <Badge
          variant={ok === false ? "solid" : "outline"}
          tone={ok === false ? "destructive" : undefined}
          className="text-xs font-mono"
        >
          {label}
        </Badge>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { data: status, refresh } = useStatus(8000)
  const navigate = useNavigate()
  const [platformOk, setPlatformOk] = useState<boolean | null>(null)
  const [restarting, setRestarting] = useState<Record<string, boolean>>({})

  const callerHealth = status?.runtime?.caller?.health?.body?.ok
  const responderHealth = status?.runtime?.responder?.health?.body?.ok
  const relayHealth = status?.runtime?.relay?.health?.body?.ok
  const callerRegistered = isCallerRegistered(status)
  const responderEnabled = status?.responder?.enabled ?? false
  const platformEnabled =
    (status?.config as { platform?: { enabled?: boolean } } | undefined)?.platform?.enabled === true

  const platformUrl =
    (status?.config as { platform?: { base_url?: string } } | undefined)?.platform?.base_url ??
    "http://127.0.0.1:8080"
  const [togglingPlatform, setTogglingPlatform] = useState(false)
  const firstHotlineReady = responderEnabled && (status?.responder?.hotline_count ?? 0) > 0

  const [requestsCount, setRequestsCount] = useState<number | null>(null)
  const [onboardingExpanded, setOnboardingExpanded] = useState(false)

  const loadRequestsCount = useCallback(async () => {
    if (!callerRegistered) {
      setRequestsCount(0)
      return
    }
    const res = await apiCall<{ items?: RequestItem[]; requests?: RequestItem[] }>("/requests", { silent: true })
    if (res.ok) {
      const items = res.data?.items ?? res.data?.requests ?? []
      setRequestsCount(Array.isArray(items) ? items.length : 0)
    }
  }, [callerRegistered])

  usePoll(loadRequestsCount, { intervalMs: 15000 })

  const hasFirstCall = (requestsCount ?? 0) > 0

  const onboardingSteps = [
    {
      key: "caller",
      title: "注册 Caller",
      description: "先获取 Caller 身份，解锁搜索和调用 Hotline 的能力。",
      done: callerRegistered,
      action: "前往注册",
      onClick: () => navigate("/caller/register?from=dashboard-onboarding"),
    },
    {
      key: "responder",
      title: "启用本地 Responder",
      description: "本地模式下先启用 Responder Runtime，再添加自己的 Hotline。",
      done: responderEnabled,
      action: "启用 Responder",
      onClick: () => navigate("/responder/activate?from=dashboard-onboarding"),
    },
    {
      key: "hotline",
      title: "添加第一个 Hotline",
      description: "创建本地 Hotline，并生成可检查的配置草稿。",
      done: firstHotlineReady,
      action: "管理 Hotline",
      onClick: () => navigate("/responder/hotlines?from=dashboard-onboarding"),
    },
    {
      key: "draft",
      title: "查看本地草稿",
      description: "确认输入填写说明、输出结构和本地运行配置，再决定是否发布到平台。",
      done: firstHotlineReady,
      action: "查看草稿",
      onClick: () => navigate("/responder/hotlines?from=dashboard-onboarding"),
    },
    {
      key: "first-call",
      title: "试拨第一个 Hotline",
      description: "打开 Catalog，挑一个带 official 标签的 Hotline 点「试拨」就能验证端到端跑通。",
      done: hasFirstCall,
      action: "打开 Catalog",
      onClick: () => navigate("/caller/catalog?from=dashboard-onboarding"),
    },
  ]
  const allOnboardingDone = onboardingSteps.every((step) => step.done)
  const showOnboardingFolded = allOnboardingDone && !onboardingExpanded

  async function handleRestart(service: string) {
    setRestarting((prev) => ({ ...prev, [service]: true }))
    const res = await apiCall(`/runtime/services/${service}/restart`, { method: "POST", silent: true })
    setRestarting((prev) => ({ ...prev, [service]: false }))
    if (res.ok) {
      toast.success(`${service} 重启指令已发送`, { description: "正在等待服务恢复…" })
      for (const delay of [1500, 3000, 5000]) setTimeout(refresh, delay)
    } else {
      toast.error(`${service} 重启失败`, { description: res.error.message })
    }
  }

  async function handlePlatformToggle(nextEnabled: boolean) {
    setTogglingPlatform(true)
    const res = await apiCall("/platform/settings", {
      method: "PUT",
      body: { enabled: nextEnabled },
      silent: true,
    })
    setTogglingPlatform(false)
    if (res.ok) {
      toast.success(nextEnabled ? "已开启平台发布功能" : "已切换为本地模式", {
        description: nextEnabled ? "Responder 与 Hotline 现在可以提交到平台审核。" : "本地 Hotline 仍可继续使用，但不再要求平台审核。",
      })
      await refresh()
    } else {
      toast.error("更新平台设置失败", { description: res.error.message })
    }
  }

  useEffect(() => {
    if (!status) return
    setPlatformOk(null)
    fetch(`${platformUrl}/healthz`, { method: "HEAD", signal: AbortSignal.timeout(3000) })
      .then((r) => setPlatformOk(r.ok || r.status < 500))
      .catch(() => setPlatformOk(false))
  }, [platformUrl, status])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-bold">Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-0.5">系统运行状态概览</p>
      </div>

      {/* Caller registration guide — shown until api_key is configured */}
      {!callerRegistered && (
        <Card className="border-teal-500/40 bg-teal-500/5">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-500/10 border-2 border-teal-500/30">
                  <UserPlus className="h-4 w-4 text-teal-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-teal-800 dark:text-teal-300">注册 Caller，解锁 Hotline 调用能力</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    你还没有注册 Caller 身份。注册后 Agent 可以搜索并调用平台上的 Remote Hotline。只需填写一个联系邮箱即可完成注册。
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                className="shrink-0 bg-teal-600 hover:bg-teal-700 text-white"
                onClick={() => navigate("/caller/register")}
              >
                立即注册
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <NextUpCard
        callerRegistered={callerRegistered}
        platformEnabled={platformEnabled}
        hotlineCount={status?.responder?.hotline_count ?? 0}
      />

      <Card className={platformEnabled ? "border-violet-500/30 bg-violet-500/5" : "border-dashed bg-muted/30"}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">
                {platformEnabled ? "平台发布已开启" : "当前为本地模式"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {platformEnabled
                  ? "当前会同步显示平台审批与 catalog 发布状态。Hotline 仍先在本地创建和查看草稿，再按需提交到平台。"
                  : "默认先完成本地 Caller / Responder / Hotline 配置和草稿确认。本地模式下不需要平台审批，平台发布是后续可选能力。"}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Platform URL: <code className="rounded bg-muted px-1 font-mono">{platformUrl}</code>
              </p>
            </div>
            <div className="shrink-0">
              <Button
                size="sm"
                variant={platformEnabled ? "outline" : "default"}
                disabled={togglingPlatform}
                onClick={() => handlePlatformToggle(!platformEnabled)}
              >
                {togglingPlatform ? "切换中…" : platformEnabled ? "关闭平台发布" : "开启平台发布"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {!platformEnabled && (
        <PlatformValueDisclosure
          onEnable={() => handlePlatformToggle(true)}
          toggling={togglingPlatform}
          platformUrl={platformUrl}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" /> Caller 进程
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1.5">
              <HealthDot ok={callerHealth} />
              <span className="text-sm font-semibold">
                {callerHealth === undefined ? "–" : callerHealth ? "运行中" : "停止"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Responder 进程
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1.5">
              <HealthDot ok={responderEnabled ? responderHealth : null} />
              <span className="text-sm font-semibold">
                {!responderEnabled ? "未启用" : responderHealth === undefined ? "–" : responderHealth ? "运行中" : "停止"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Wifi className="h-3.5 w-3.5" /> Relay
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1.5">
              <HealthDot ok={relayHealth} />
              <span className="text-sm font-semibold">
                {relayHealth === undefined ? "–" : relayHealth ? "运行中" : "停止"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" /> Platform API
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1.5">
              <HealthDot ok={platformOk} />
              <span className="text-sm font-semibold">
                {platformOk === null ? "检测中" : platformOk ? "可达" : "不可达"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {platformEnabled && platformOk === false && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-yellow-700 leading-relaxed">
              <span className="font-semibold">Platform API 不可达</span>（<code className="font-mono bg-yellow-100/50 px-1 rounded">{platformUrl}</code>）—
              当前已开启平台发布，因此 catalog 查询与审核同步会受影响。请启动平台服务，或确认 Platform URL 配置正确。
            </p>
          </CardContent>
        </Card>
      )}

      {showOnboardingFolded ? (
        <Card className="border-green-500/40 bg-green-500/5">
          <CardContent className="flex items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                上手已完成 ✓ {onboardingSteps.length}/{onboardingSteps.length}
              </p>
              <span className="text-xs text-muted-foreground">需要时可以重新展开。</span>
            </div>
            <button
              type="button"
              onClick={() => setOnboardingExpanded(true)}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              重新展开
            </button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>首次上手流程</span>
              <span className="text-xs font-normal text-muted-foreground">
                {onboardingSteps.filter((s) => s.done).length}/{onboardingSteps.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {onboardingSteps.map((step, index) => (
              <div key={step.key} className="flex items-start justify-between gap-3 rounded-md border bg-muted/20 p-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                    step.done ? "border-green-500/40 bg-green-500/10 text-green-600" : "border-border bg-background text-muted-foreground"
                  }`}>
                    {step.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{step.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
                  </div>
                </div>
                <div className="shrink-0">
                  <Button size="sm" variant={step.done ? "outline" : "default"} onClick={step.onClick}>
                    {step.done ? "继续查看" : step.action}
                  </Button>
                </div>
              </div>
            ))}
            <div className={`rounded-md border p-3 text-xs leading-relaxed ${
              platformEnabled ? "border-violet-500/20 bg-violet-500/5 text-muted-foreground" : "border-dashed bg-muted/20 text-muted-foreground"
            }`}>
              <span className="font-semibold text-foreground">{platformEnabled ? "可选后续：发布到平台" : "可选后续：开启平台发布"}</span>
              {platformEnabled
                ? " 现在可以把已经验证过的本地 Hotline 提交到平台 catalog，进入发布与审核流程。"
                : " 当你准备让其他 Caller 从平台 Catalog 发现这些 Hotline 时，再开启平台发布功能即可。"}
            </div>
            {allOnboardingDone && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setOnboardingExpanded(false)}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  收起
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>服务健康度</CardTitle>
        </CardHeader>
        <CardContent>
          <ServiceRow
            name="caller-controller"
            ok={callerHealth}
            label={
              callerHealth === false
                ? "ERROR"
                : callerHealth === true
                ? callerRegistered ? "已注册" : "未注册"
                : "–"
            }
            onRestart={() => handleRestart("caller")}
            restarting={restarting["caller"]}
          />
          <ServiceRow
            name="responder-controller"
            ok={responderEnabled ? responderHealth : null}
            label={
              !responderEnabled
                ? "disabled"
                : responderHealth === true
                ? "ok"
                : responderHealth === false
                ? "error"
                : "enabled"
            }
            onRestart={responderEnabled ? () => handleRestart("responder") : undefined}
            restarting={restarting["responder"]}
          />
          <ServiceRow
            name="transport-relay"
            ok={relayHealth}
            label={relayHealth === undefined ? "–" : relayHealth ? "ok" : "down"}
            onRestart={() => handleRestart("relay")}
            restarting={restarting["relay"]}
          />
          <ServiceRow
            name="platform-api"
            ok={platformOk}
            label={platformOk === null ? "检测中…" : platformOk ? "可达" : "不可达"}
          />
        </CardContent>
      </Card>

      {status?.responder && (
        <Card>
          <CardHeader>
            <CardTitle>Responder 摘要</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Responder ID</span>
                <span className="font-mono text-xs">{status.responder.responder_id ?? "–"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hotline 总数</span>
                <span className="font-semibold">{status.responder.hotline_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">待审核</span>
                <span className="font-semibold">{platformEnabled ? status.responder.pending_review_count : "本地模式"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
