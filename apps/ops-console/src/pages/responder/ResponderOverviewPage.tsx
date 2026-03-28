import { useAuth } from "@/hooks/useAuth"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Server, Activity, FileCheck } from "lucide-react"

export function ResponderOverviewPage() {
  const { status } = useAuth()
  const responder = status?.responder

  if (!responder) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        Responder 数据加载中…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-bold">Responder 概览</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Responder 身份与运行摘要</p>
      </div>

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
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <FileCheck className="h-3 w-3" /> 待审核
            </p>
            <p className="text-xl font-bold text-orange-600">{responder.pending_review_count}</p>
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
