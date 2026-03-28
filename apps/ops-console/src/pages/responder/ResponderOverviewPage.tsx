import { useNavigate } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Server, Activity, FileCheck, LockKeyhole, ArrowRight } from "lucide-react"

export function ResponderOverviewPage() {
  const { status } = useAuth()
  const navigate = useNavigate()
  const responder = status?.responder

  if (!responder) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        Responder 数据加载中…
      </div>
    )
  }

  if (!responder.enabled) {
    return (
      <div className="max-w-md space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/10 border-2 border-orange-500/30">
            <LockKeyhole className="h-4 w-4 text-orange-500" />
          </div>
          <div>
            <h1 className="text-base font-bold">Responder 未启用</h1>
            <p className="text-xs text-muted-foreground">当前账号仅持有 Caller 身份</p>
          </div>
        </div>

        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              启用 Responder 后，你可以发布 Hotline、接收任务调用，成为可被 Caller 发现的执行方。
            </p>
            <Button
              onClick={() => navigate("/responder/activate")}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white"
            >
              申请 Responder 身份
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-bold">Responder 概览</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Responder 身份与运行摘要</p>
      </div>

      {responder.pending_review_count > 0 && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-orange-700">
                {responder.pending_review_count} 个 Hotline 未提交审核
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                向平台提交审核后，Caller 才能发现并调用你的 Hotline
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => navigate("/responder/review")}
              className="shrink-0 bg-orange-500 hover:bg-orange-600 text-white"
            >
              前往提交审核
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <Server className="h-3 w-3" /> Responder ID
            </p>
            <p className="text-sm font-mono truncate">{responder.responder_id ?? "–"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <Activity className="h-3 w-3" /> Hotline 总数
            </p>
            <p className="text-xl font-bold">{responder.hotline_count}</p>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:border-orange-500/40 transition-colors"
          onClick={() => navigate("/responder/review")}
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <FileCheck className="h-3 w-3" /> 待审核
            </p>
            <p className={`text-xl font-bold ${responder.pending_review_count > 0 ? "text-orange-600" : ""}`}>
              {responder.pending_review_count}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">运行状态</p>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${responder.enabled ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-muted-foreground/40"}`} />
            <span className="text-sm font-medium">{responder.enabled ? "已启用" : "未启用"}</span>
            <Badge variant="outline" className="text-xs ml-auto">{responder.responder_id}</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
