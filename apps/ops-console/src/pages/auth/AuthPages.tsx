import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Terminal, UserPlus, CheckCircle2, ChevronRight, SkipForward, LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert } from "@/components/ui/alert"
import { useAuth } from "@/hooks/useAuth"
import { requestJson } from "@/lib/api"
import { cn } from "@/components/ui/utils"

type Step = "passphrase" | "register" | "done"

const STEPS: { id: Step; label: string }[] = [
  { id: "passphrase", label: "设置口令" },
  { id: "register", label: "注册 Caller" },
  { id: "done", label: "完成" },
]

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current)
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((step, i) => {
        const done = i < idx
        const active = i === idx
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
                  done
                    ? "border-primary bg-primary text-primary-foreground"
                    : active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground"
                )}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium whitespace-nowrap",
                  active ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "h-0.5 w-12 mx-1 mb-4 transition-colors",
                  done ? "bg-primary" : "bg-border"
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SetupPage() {
  const { setup, refresh } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>("passphrase")

  // Step 1 state
  const [passphrase, setPassphrase] = useState("")
  const [confirm, setConfirm] = useState("")
  const [passphraseError, setPassphraseError] = useState("")
  const [passphraseLoading, setPassphraseLoading] = useState(false)

  // Step 2 state
  const [email, setEmail] = useState("")
  const [registerLoading, setRegisterLoading] = useState(false)
  const [registerError, setRegisterError] = useState("")
  const [registerDone, setRegisterDone] = useState(false)

  const handlePassphraseSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (passphrase !== confirm) { setPassphraseError("两次输入不一致"); return }
    if (passphrase.length < 6) { setPassphraseError("口令至少 6 个字符"); return }
    setPassphraseLoading(true)
    const result = await setup(passphrase)
    setPassphraseLoading(false)
    if (result.ok) {
      setStep("register")
    } else {
      setPassphraseError(result.error ?? "Setup 失败")
    }
  }

  const handleRegister = async () => {
    if (!email) return
    setRegisterLoading(true)
    setRegisterError("")
    const res = await requestJson("/auth/register-caller", {
      method: "POST",
      body: { contact_email: email },
    })
    setRegisterLoading(false)
    if (res.status === 201) {
      await refresh()
      setRegisterDone(true)
      setTimeout(() => setStep("done"), 800)
    } else {
      const err = res.body as { error?: { message?: string } } | null
      setRegisterError(err?.error?.message ?? "注册失败，请检查平台连接")
    }
  }

  const handleSkipRegister = () => setStep("done")

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 text-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary bg-primary/10">
            <Terminal className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-lg font-bold">初始化 Ops Console</h1>
        </div>

        <StepIndicator current={step} />

        {step === "passphrase" && (
          <form onSubmit={handlePassphraseSubmit} className="space-y-4">
            <div className="text-center mb-4">
              <p className="text-sm text-muted-foreground">
                设置一个口令来加密本地密钥存储
              </p>
            </div>
            {passphraseError && (
              <Alert variant="destructive">
                <p className="text-sm">{passphraseError}</p>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="passphrase">口令</Label>
              <Input
                id="passphrase"
                type="password"
                placeholder="至少 6 个字符"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">确认口令</Label>
              <Input
                id="confirm"
                type="password"
                placeholder="再次输入口令"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={passphraseLoading}>
              {passphraseLoading ? "初始化中…" : (
                <span className="flex items-center gap-1.5">
                  下一步 <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>
        )}

        {step === "register" && (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <p className="text-sm text-muted-foreground">
                向平台注册以获取 API Key，解锁 Catalog 和 Call 功能
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                （可跳过，稍后在 Caller 控制台内注册）
              </p>
            </div>
            {registerDone ? (
              <div className="flex items-center justify-center gap-2 py-6 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-semibold">注册成功！</span>
              </div>
            ) : (
              <>
                {registerError && (
                  <Alert variant="destructive">
                    <p className="text-sm">{registerError}</p>
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
                <Button
                  className="w-full"
                  onClick={handleRegister}
                  disabled={registerLoading || !email}
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  {registerLoading ? "注册中…" : "注册 Caller"}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={handleSkipRegister}
                >
                  <SkipForward className="h-4 w-4 mr-2" />
                  跳过，稍后再注册
                </Button>
              </>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="space-y-5 text-center">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 border-2 border-primary">
                <CheckCircle2 className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="text-base font-bold">初始化完成</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Ops Console 已准备就绪
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-left space-y-1.5 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide mb-2">下一步</p>
              <p>· 在 <span className="font-medium text-teal-600">Caller</span> Tab 浏览 Hotline Catalog</p>
              <p>· 在 <span className="font-medium text-teal-600">Caller</span> Tab 发起你的第一个 Call</p>
              <p>· 在 <span className="font-medium text-orange-600">Responder</span> Tab 启用 Responder（可选）</p>
            </div>
            <Button className="w-full" onClick={() => navigate("/general")}>
              开始使用
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export function UnlockPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [passphrase, setPassphrase] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const result = await login(passphrase)
    setLoading(false)
    if (result.ok) {
      navigate("/general")
    } else {
      setError(result.error ?? "口令错误")
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary bg-primary/10">
            <LockKeyhole className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-lg font-bold">解锁 Ops Console</h1>
          <p className="text-sm text-muted-foreground">输入口令以解锁</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <p className="text-sm">{error}</p>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="passphrase">口令</Label>
            <Input
              id="passphrase"
              type="password"
              placeholder="输入口令"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "解锁中…" : "解锁"}
          </Button>
        </form>
      </div>
    </div>
  )
}
