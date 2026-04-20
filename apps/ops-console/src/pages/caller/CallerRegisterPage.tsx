import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { apiCall } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert } from "@/components/ui/alert"
import { CheckCircle2, UserPlus } from "lucide-react"
import { callerRegistrationMode, isCallerRegistered } from "@/lib/status"

export function CallerRegisterPage() {
  const { refresh, status } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  const callerRegistered = isCallerRegistered(status)
  const registrationMode = callerRegistrationMode(status)

  if (callerRegistered) {
    return (
      <div className="max-w-md space-y-4">
        <div>
          <h1 className="text-base font-bold">Caller 注册</h1>
        </div>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-teal-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold">已完成注册</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {registrationMode === "local_only" ? "已完成本地 Caller 注册，可以直接在本机发起 Call。" : "Caller API Key 已配置，可以发起 Call 了"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Button onClick={() => navigate("/caller/catalog")} size="sm">
          浏览 Hotline Catalog
        </Button>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setError("")
    const res = await apiCall("/auth/register-caller", {
      method: "POST",
      body: { contact_email: email, mode: "local_only" },
      silent: true,
    })
    setLoading(false)
    if (res.ok) {
      setSuccess(true)
      await refresh()
      setTimeout(() => navigate("/caller/catalog"), 1500)
    } else {
      setError(res.error.message)
    }
  }

  return (
    <div className="max-w-md space-y-5">
      <div>
        <h1 className="text-base font-bold">注册 Caller</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          本地模式下只需要填写联系邮箱，即可注册本地 Caller 身份并解锁 Catalog 和 Call 功能
        </p>
      </div>

      {success ? (
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-teal-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold">注册成功！</p>
                <p className="text-xs text-muted-foreground mt-0.5">正在跳转到 Catalog…</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>注册信息</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <p className="text-sm">{error}</p>
                </Alert>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">联系邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={loading || !email} className="w-full">
                <UserPlus className="h-4 w-4 mr-2" />
                {loading ? "注册中…" : "注册 Caller"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
