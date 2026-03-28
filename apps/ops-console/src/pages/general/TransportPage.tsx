import { useEffect, useState } from "react"
import { requestJson } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"

type TransportType = "local" | "relay_http" | "email"

interface Transport {
  type: TransportType
  relay_http?: { base_url: string }
  email?: { provider: string; sender: string; receiver: string }
}

export function TransportPage() {
  const [transport, setTransport] = useState<Transport | null>(null)
  const [editing, setEditing] = useState<Transport | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    requestJson<Transport>("/runtime/transport").then((res) => {
      if (res.status === 200 && res.body) {
        setTransport(res.body)
        setEditing(res.body)
      }
    })
  }, [])

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    setError("")
    const res = await requestJson("/runtime/transport", { method: "PUT", body: editing })
    setSaving(false)
    if (res.status === 200) {
      setTransport(editing)
    } else if (res.status === 401) {
      setError("会话已过期，正在跳转到登录页…")
    } else {
      setError("保存失败")
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const res = await requestJson<{ ok: boolean; message?: string }>("/runtime/transport/test", {
      method: "POST",
    })
    setTesting(false)
    if (res.body) setTestResult(res.body)
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h1 className="text-base font-bold">Transport 配置</h1>
        <p className="text-xs text-muted-foreground mt-0.5">配置 Caller 与 Responder 之间的通信方式</p>
      </div>

      <Card className="bg-muted/40 border-dashed">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">通信类型</span>决定了消息在 Caller 和 Responder 之间如何传递：
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            <li className="flex gap-2">
              <Badge variant="outline" className="text-[10px] font-mono shrink-0 h-fit">local</Badge>
              <span>进程内直接通信，无需网络。仅适用于 Caller 和 Responder 运行在同一台机器上的开发/测试场景。</span>
            </li>
            <li className="flex gap-2">
              <Badge variant="outline" className="text-[10px] font-mono shrink-0 h-fit">relay_http</Badge>
              <span>通过 HTTP Relay 服务转发消息。适合跨机器部署，或在防火墙后访问外部平台。需要配置 Relay 服务 URL。</span>
            </li>
            <li className="flex gap-2">
              <Badge variant="outline" className="text-[10px] font-mono shrink-0 h-fit">email</Badge>
              <span>通过电子邮件传输消息。适合低频异步场景，或需要人工审阅中间步骤的工作流。支持 EmailEngine / Gmail。</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <p className="text-sm">{error}</p>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>通信类型</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {(["local", "relay_http", "email"] as TransportType[]).map((t) => (
              <button
                key={t}
                onClick={() => setEditing({ ...editing, type: t })}
                className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                  editing.type === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {editing.type === "relay_http" && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <Label>Relay URL</Label>
                <Input
                  value={editing.relay_http?.base_url ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      relay_http: { base_url: e.target.value },
                    })
                  }
                  placeholder="http://relay.example.com:8090"
                />
              </div>
            </>
          )}

          {editing.type === "email" && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Provider</Label>
                  <div className="flex gap-2">
                    {["emailengine", "gmail"].map((p) => (
                      <button
                        key={p}
                        onClick={() =>
                          setEditing({
                            ...editing,
                            email: { ...editing.email!, provider: p, sender: editing.email?.sender ?? "", receiver: editing.email?.receiver ?? "" },
                          })
                        }
                        className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                          (editing.email?.provider ?? "") === p
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>发件人邮箱</Label>
                  <Input
                    value={editing.email?.sender ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        email: { ...editing.email!, sender: e.target.value },
                      })
                    }
                    placeholder="sender@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>收件人邮箱</Label>
                  <Input
                    value={editing.email?.receiver ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        email: { ...editing.email!, receiver: e.target.value },
                      })
                    }
                    placeholder="receiver@example.com"
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中…" : "保存配置"}
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={testing}>
          {testing ? "测试中…" : "测试连接"}
        </Button>
      </div>

      {testResult && (
        <div className="flex items-center gap-2 text-sm">
          {testResult.ok ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500" />
          )}
          <span>{testResult.ok ? "连接正常" : testResult.message ?? "连接失败"}</span>
        </div>
      )}

      {transport && (
        <Card>
          <CardHeader>
            <CardTitle>当前配置</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{transport.type}</Badge>
              {transport.type === "relay_http" && (
                <span className="text-xs font-mono text-muted-foreground">
                  {transport.relay_http?.base_url}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
