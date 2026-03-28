import { useEffect, useState } from "react"
import { useStatus } from "@/hooks/useStatus"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Activity, Server, Wifi, Zap, Globe } from "lucide-react"

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
}: {
  name: string
  ok: boolean | undefined | null
  label: string
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <div className="flex items-center gap-2.5">
        <HealthDot ok={ok} />
        <span className="text-sm font-medium">{name}</span>
      </div>
      <Badge variant={ok ? "outline" : "destructive"} className="text-xs font-mono">
        {label}
      </Badge>
    </div>
  )
}

export function DashboardPage() {
  const status = useStatus(8000)
  const [platformOk, setPlatformOk] = useState<boolean | null>(null)

  const callerHealth = status?.runtime?.caller?.health?.body?.ok
  const responderHealth = status?.runtime?.responder?.health?.body?.ok
  const relayHealth = status?.runtime?.relay?.health?.body?.ok
  const callerRegistered =
    (status?.config as { caller?: { api_key_configured?: boolean } } | undefined)?.caller
      ?.api_key_configured ?? false
  const responderEnabled = status?.responder?.enabled ?? false

  const platformUrl =
    (status?.config as { platform?: { base_url?: string } } | undefined)?.platform?.base_url ??
    "http://127.0.0.1:8080"

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

      {platformOk === false && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-yellow-700 leading-relaxed">
              <span className="font-semibold">Platform API 不可达</span>（<code className="font-mono bg-yellow-100/50 px-1 rounded">{platformUrl}</code>）—
              Caller Controller 会持续产生 <code className="font-mono bg-yellow-100/50 px-1 rounded">inbox poll failed</code> 日志。
              请启动平台服务，或在 Transport 配置中确认正确的 Platform URL。
            </p>
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
            label={callerRegistered ? "已注册" : "未注册"}
          />
          <ServiceRow
            name="responder-controller"
            ok={responderEnabled ? responderHealth : null}
            label={responderEnabled ? "enabled" : "disabled"}
          />
          <ServiceRow
            name="transport-relay"
            ok={relayHealth}
            label={relayHealth === undefined ? "–" : relayHealth ? "ok" : "down"}
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
                <span className="font-semibold">{status.responder.pending_review_count}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
