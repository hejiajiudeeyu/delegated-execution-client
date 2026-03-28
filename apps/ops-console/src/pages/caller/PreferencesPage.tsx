import { useEffect, useState } from "react"
import { requestJson } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert } from "@/components/ui/alert"
import { Settings, Save, Trash2, Info } from "lucide-react"

interface TaskTypePreference {
  task_type: string
  hotline_id?: string
  responder_id?: string
}

export function PreferencesPage() {
  const [prefs, setPrefs] = useState<TaskTypePreference[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({ task_type: "", hotline_id: "" })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const res = await requestJson<{ items: TaskTypePreference[] }>("/preferences/task-types")
    if (res.body?.items) setPrefs(res.body.items)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSave = async () => {
    if (!editing.task_type || !editing.hotline_id) return
    setSaving(true)
    await requestJson(`/preferences/task-types/${encodeURIComponent(editing.task_type)}/hotline`, {
      method: "PUT", body: { hotline_id: editing.hotline_id },
    })
    setSaving(false)
    setEditing({ task_type: "", hotline_id: "" })
    load()
  }

  const handleDelete = async (taskType: string) => {
    await requestJson(`/preferences/task-types/${encodeURIComponent(taskType)}/hotline`, {
      method: "PUT", body: { hotline_id: null },
    })
    load()
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <h1 className="text-base font-bold">自动路由偏好</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          当 Agent 或代码发起指定 task_type 的请求时，自动路由到首选 Hotline
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <p className="text-xs ml-2">
          偏好设置让你可以为常用任务类型（如 <code className="bg-muted px-1 rounded">text_summarize</code>、<code className="bg-muted px-1 rounded">code_review</code>）指定默认的 Hotline。
          当收到匹配 task_type 的请求时，Caller 会自动选择对应的 Hotline 而无需手动指定。
        </p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Settings className="h-4 w-4" /> 添加路由规则
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Task Type</Label>
            <Input
              placeholder="text_summarize"
              value={editing.task_type}
              onChange={(e) => setEditing({ ...editing, task_type: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>首选 Hotline ID</Label>
            <Input
              placeholder="从 Catalog 中选取 Hotline ID"
              value={editing.hotline_id}
              onChange={(e) => setEditing({ ...editing, hotline_id: e.target.value })}
            />
          </div>
          <Button
            size="sm" onClick={handleSave}
            disabled={saving || !editing.task_type || !editing.hotline_id}
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "保存中…" : "保存"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>当前路由规则</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : prefs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">暂无规则，所有请求需手动指定 Hotline</p>
          ) : (
            <div className="space-y-2">
              {prefs.map((pref) => (
                <div key={pref.task_type} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs font-mono">{pref.task_type}</Badge>
                    <span className="text-muted-foreground text-xs">→</span>
                    <span className="text-xs font-mono">{pref.hotline_id ?? "–"}</span>
                  </div>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(pref.task_type)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
