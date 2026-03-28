import { useEffect, useState } from "react"
import { requestJson } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { CheckCircle2, FileCheck, Clock, XCircle } from "lucide-react"

interface Hotline {
  hotline_id: string
  display_name?: string
  review_status?: string
  submitted_for_review?: boolean
  enabled?: boolean
}

function StatusIcon({ status }: { status?: string }) {
  if (status === "approved") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
  if (status === "rejected") return <XCircle className="h-3.5 w-3.5 text-red-500" />
  return <Clock className="h-3.5 w-3.5 text-yellow-500" />
}

export function ResponderReviewPage() {
  const [hotlines, setHotlines] = useState<Hotline[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; message: string } | null>(null)

  const load = async () => {
    const res = await requestJson<{ items: Hotline[] }>("/responder/hotlines")
    if (res.body?.items) setHotlines(res.body.items)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmitReview = async () => {
    setSubmitting(true); setSubmitResult(null)
    const res = await requestJson<{ submitted: number }>("/responder/submit-review", { method: "POST" })
    setSubmitting(false)
    if (res.status === 200 || res.status === 201) {
      setSubmitResult({ ok: true, message: `已提交 ${res.body?.submitted ?? 0} 个 Hotline 审核` })
      load()
    } else {
      const err = res.body as { error?: { message?: string } } | null
      setSubmitResult({ ok: false, message: err?.error?.message ?? "提交失败" })
    }
  }

  const pendingCount = hotlines.filter((h) => !h.submitted_for_review).length
  const allHotlines = hotlines.filter((h) => h.enabled !== false)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-bold">提交审核</h1>
        <p className="text-xs text-muted-foreground mt-0.5">将 Hotline 提交至平台审核，审核通过后才能被 Caller 发现</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <FileCheck className="h-4 w-4" />
            审核状态
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : allHotlines.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">暂无 Hotline，请先在「Hotline 管理」中添加</p>
          ) : (
            <div className="space-y-1">
              {allHotlines.map((h) => (
                <div key={h.hotline_id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={h.review_status} />
                    <span className="text-sm font-semibold">{h.display_name ?? h.hotline_id}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={h.submitted_for_review ? "outline" : "secondary"} className="text-[10px]">
                      {h.submitted_for_review ? "已提交" : "未提交"}
                    </Badge>
                    <Badge variant={h.review_status === "approved" ? "outline" : h.review_status === "rejected" ? "destructive" : "secondary"} className="text-[10px]">
                      {h.review_status ?? "local_only"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 space-y-3">
          <p className="text-xs text-muted-foreground">
            待提交：<span className="font-semibold text-orange-600">{pendingCount}</span> 个 Hotline
          </p>
          {submitResult && (
            <div className={`flex items-center gap-2 text-sm ${submitResult.ok ? "text-green-700" : "text-red-600"}`}>
              {submitResult.ok
                ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                : <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              }
              {submitResult.message}
            </div>
          )}
          <Button
            size="sm" onClick={handleSubmitReview}
            disabled={submitting || pendingCount === 0}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {submitting ? "提交中…" : `提交 ${pendingCount} 个待审核 Hotline`}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
