import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { requestJson } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Alert } from "@/components/ui/alert"
import { LockKeyhole, CheckCircle2, UserCheck, BookOpen, FileCheck, KeyRound } from "lucide-react"
import { cn } from "@/components/ui/utils"
import { isCallerRegistered } from "@/lib/status"

const STEPS = [
  {
    icon: UserCheck,
    title: "确保已注册 Caller",
    description: "Responder 注册需要先有 Caller 身份（API Key）",
  },
  {
    icon: KeyRound,
    title: "填写 Responder 身份",
    description: "设置 Responder ID 和显示名称",
  },
  {
    icon: BookOpen,
    title: "添加 Hotline",
    description: "在 Hotline 管理页面添加你要发布的 Hotline",
  },
  {
    icon: FileCheck,
    title: "按需发布到平台",
    description: "只有开启平台发布功能后，才需要提交审核并等待审批",
  },
]

export function ResponderLockedPage() {
  const { refresh, status } = useAuth()
  const navigate = useNavigate()
  const [responderId, setResponderId] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const callerRegistered = isCallerRegistered(status)
  const platformEnabled =
    (status?.config as { platform?: { enabled?: boolean } } | undefined)?.platform?.enabled === true

  const handleEnable = async () => {
    if (!responderId || !displayName) return
    setLoading(true)
    setError("")
    const res = await requestJson("/responder/enable", {
      method: "POST",
      body: { responder_id: responderId, display_name: displayName },
    })
    setLoading(false)
    if (res.status === 200) {
      await refresh()
      navigate("/responder")
    } else {
      const err = res.body as { error?: { message?: string } } | null
      setError(err?.error?.message ?? "启用失败")
    }
  }

  return (
    <div className="max-w-md space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/10 border-2 border-orange-500/30">
          <LockKeyhole className="h-4 w-4 text-orange-500" />
        </div>
        <div>
          <h1 className="text-base font-bold">启用 Responder</h1>
          <p className="text-xs text-muted-foreground">先启用本地 Responder Runtime，再按需发布 Hotline</p>
        </div>
      </div>

      <div className="space-y-2">
        {STEPS.map((step, i) => {
          const Icon = step.icon
          const done = i === 0 ? callerRegistered : false
          return (
            <Card key={i} className={cn("border", done && "border-green-500/30 bg-green-500/5")}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold border-2",
                      done
                        ? "border-green-500 bg-green-500/10 text-green-600"
                        : "border-orange-500/40 bg-orange-500/5 text-orange-500"
                    )}
                  >
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{step.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {!callerRegistered && (
        <Alert>
          <p className="text-sm">请先前往 Caller 页面完成注册。只要完成本地 Caller 注册即可，不要求平台 API Key。</p>
        </Alert>
      )}

      {callerRegistered && !platformEnabled && (
        <Alert>
          <p className="text-sm">当前为本地模式。启用 Responder 后，你可以先添加 Hotline 并查看草稿，不需要平台审批。</p>
        </Alert>
      )}

      {callerRegistered && (
        <Card>
          <CardContent className="pt-5 space-y-4">
            {error && (
              <Alert variant="destructive">
                <p className="text-sm">{error}</p>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label>Responder ID</Label>
              <Input
                placeholder="my-responder-01"
                value={responderId}
                onChange={(e) => setResponderId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>显示名称</Label>
              <Input
                placeholder="我的 Responder"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <Button
              onClick={handleEnable}
              disabled={loading || !responderId || !displayName}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white"
            >
              {loading ? "启用中…" : "启用 Responder"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
