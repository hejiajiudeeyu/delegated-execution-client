import { useNavigate } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, UserPlus, BookOpen, Zap, AlertCircle } from "lucide-react"
import { callerRegistrationMode, isCallerRegistered } from "@/lib/status"

type CallerConfig = {
  api_key_configured?: boolean
  contact_email?: string
  caller_id?: string
}

export function CallerOverviewPage() {
  const { status } = useAuth()
  const navigate = useNavigate()

  const callerConfig = ((status?.config as { caller?: CallerConfig } | undefined)?.caller ?? status?.caller) as CallerConfig | undefined
  const registered = isCallerRegistered(status)
  const registrationMode = callerRegistrationMode(status)
  const email = callerConfig?.contact_email
  const callerId = callerConfig?.caller_id

  if (!registered) {
    return (
      <div className="max-w-lg space-y-5">
        <div>
          <h1 className="text-base font-bold">Caller 概览</h1>
          <p className="text-xs text-muted-foreground mt-0.5">管理 Caller 身份与调用能力</p>
        </div>

        <Card className="border-dashed border-cyan-500/40 bg-cyan-500/5">
          <CardContent className="pt-5">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-cyan-500 shrink-0 mt-0.5" />
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold">尚未注册 Caller</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    注册后可浏览 Hotline Catalog、发起 Call 请求并设置路由偏好。本地模式下只需提供联系邮箱，不要求平台 API Key。
                  </p>
                </div>
                <Button
                  size="sm"
                  className="bg-cyan-500 hover:bg-cyan-600 text-white"
                  onClick={() => navigate("/caller/register")}
                >
                  <UserPlus className="h-4 w-4 mr-1.5" />
                  前往注册
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h1 className="text-base font-bold">Caller 概览</h1>
        <p className="text-xs text-muted-foreground mt-0.5">管理 Caller 身份与调用能力</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-cyan-500" />
            Caller 身份
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">注册状态</span>
            <Badge variant="outline" className="text-cyan-600 border-cyan-500/40 bg-cyan-500/10 font-mono text-xs">
              {registrationMode === "local_only" ? "本地已注册" : "已注册"}
            </Badge>
          </div>
          {callerId && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Caller ID</span>
              <span className="font-mono text-xs">{callerId}</span>
            </div>
          )}
          {email && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">联系邮箱</span>
              <span className="font-mono text-xs">{email}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{registrationMode === "local_only" ? "模式" : "API Key"}</span>
            {registrationMode === "local_only" ? (
              <Badge variant="outline" className="text-blue-600 border-blue-500/40 bg-blue-500/10 text-xs">
                local_only
              </Badge>
            ) : (
              <Badge variant="outline" className="text-green-600 border-green-500/40 bg-green-500/10 text-xs">
                已配置
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card
          className="cursor-pointer hover:border-cyan-500/40 transition-colors"
          onClick={() => navigate("/caller/catalog")}
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2.5">
              <BookOpen className="h-4 w-4 text-cyan-500" />
              <div>
                <p className="text-sm font-semibold">Hotline Catalog</p>
                <p className="text-xs text-muted-foreground">浏览可用 Hotline</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:border-cyan-500/40 transition-colors"
          onClick={() => navigate("/caller/calls")}
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2.5">
              <Zap className="h-4 w-4 text-cyan-500" />
              <div>
                <p className="text-sm font-semibold">Call 请求</p>
                <p className="text-xs text-muted-foreground">查看 / 发起请求</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
