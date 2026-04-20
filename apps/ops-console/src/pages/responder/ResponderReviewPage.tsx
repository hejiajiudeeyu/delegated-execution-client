import { useEffect, useState } from "react"
import { apiCall } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert } from "@/components/ui/alert"
import { CheckCircle2, FileCheck, Clock, XCircle } from "lucide-react"
import { toast } from "sonner"

interface Hotline {
  hotline_id: string
  display_name?: string
  review_status?: string
  submitted_for_review?: boolean
  enabled?: boolean
}

interface VerificationSummary {
  ok?: boolean
  catalog_visible?: boolean
  template_ref_matches?: boolean
  template_bundle_available?: boolean
}

interface SubmitResponse {
  submitted?: number
  results?: Array<{
    hotline_id: string
    draft_file?: string
    verification?: VerificationSummary
  }>
}

function StatusIcon({ status }: { status?: string }) {
  if (status === "approved") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
  if (status === "rejected") return <XCircle className="h-3.5 w-3.5 text-red-500" />
  return <Clock className="h-3.5 w-3.5 text-yellow-500" />
}

export function ResponderReviewPage() {
  const [hotlines, setHotlines] = useState<Hotline[]>([])
  const [platformEnabled, setPlatformEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submittingHotlineId, setSubmittingHotlineId] = useState<string | null>(null)
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [lastVerification, setLastVerification] = useState<Record<string, VerificationSummary>>({})

  const load = async () => {
    const res = await apiCall<{ items: Hotline[]; platform_enabled?: boolean }>("/responder/hotlines")
    if (res.ok && res.data) {
      setHotlines(res.data.items ?? [])
      setPlatformEnabled(res.data.platform_enabled === true)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmitReview = async () => {
    setSubmitting(true); setSubmitResult(null)
    const res = await apiCall<SubmitResponse>("/responder/submit-review", { method: "POST", silent: true })
    setSubmitting(false)
    if (res.ok) {
      setSubmitResult({ ok: true, message: `已提交 ${res.data?.submitted ?? 0} 个 Hotline 审核` })
      const nextVerification = Object.fromEntries(
        (res.data?.results || [])
          .filter((item) => item.hotline_id && item.verification)
          .map((item) => [item.hotline_id, item.verification as VerificationSummary])
      )
      if (Object.keys(nextVerification).length > 0) {
        setLastVerification((current) => ({ ...current, ...nextVerification }))
      }
      load()
    } else {
      setSubmitResult({ ok: false, message: res.error.message })
    }
  }

  const handleSubmitSingleDraft = async (hotlineId: string) => {
    setSubmittingHotlineId(hotlineId)
    const res = await apiCall<SubmitResponse>(`/responder/hotlines/${encodeURIComponent(hotlineId)}/submit-review`, {
      method: "POST",
      silent: true,
    })
    setSubmittingHotlineId(null)
    if (res.ok) {
      const result = res.data?.results?.[0]
      if (result?.verification) {
        setLastVerification((current) => ({ ...current, [hotlineId]: result.verification as VerificationSummary }))
      }
      toast.success("草稿已提交", {
        description: result?.verification?.ok ? "catalog 与 template bundle 校验已通过" : "已提交，请继续检查校验结果",
      })
      load()
      return
    }
    toast.error("提交草稿失败", { description: res.error.message })
  }

  const pendingCount = hotlines.filter((h) => !h.submitted_for_review).length
  const allHotlines = hotlines.filter((h) => h.enabled !== false)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-bold">平台发布</h1>
        <p className="text-xs text-muted-foreground mt-0.5">将本地草稿提交至平台 catalog。未开启平台发布时，本页不是必需步骤。</p>
      </div>

      {!platformEnabled && (
        <Alert>
          <p className="text-sm">当前为本地模式。你的 Hotline 已可在本地查看草稿并调试，不需要提交平台审核。若要让其他 Caller 从平台 Catalog 发现它们，请先在 Dashboard 中开启平台发布功能。</p>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <FileCheck className="h-4 w-4" />
            平台发布状态
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
                  <div className="flex flex-1 items-start gap-2">
                    <StatusIcon status={h.review_status} />
                    <div className="min-w-0">
                      <span className="text-sm font-semibold">{h.display_name ?? h.hotline_id}</span>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{h.hotline_id}</p>
                      {lastVerification[h.hotline_id] && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant={lastVerification[h.hotline_id].catalog_visible ? "outline" : "secondary"} className="text-[10px]">
                            catalog
                          </Badge>
                          <Badge variant={lastVerification[h.hotline_id].template_ref_matches ? "outline" : "secondary"} className="text-[10px]">
                            template_ref
                          </Badge>
                          <Badge variant={lastVerification[h.hotline_id].template_bundle_available ? "outline" : "secondary"} className="text-[10px]">
                            template_bundle
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={h.submitted_for_review ? "outline" : "secondary"} className="text-[10px]">
                      {h.submitted_for_review ? "已提交" : "未提交"}
                    </Badge>
                    <Badge variant={h.review_status === "approved" ? "outline" : h.review_status === "rejected" ? "destructive" : "secondary"} className="text-[10px]">
                      {h.review_status ?? "local_only"}
                    </Badge>
                    {platformEnabled && !h.submitted_for_review && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => handleSubmitSingleDraft(h.hotline_id)}
                        disabled={submittingHotlineId === h.hotline_id || submitting}
                      >
                        {submittingHotlineId === h.hotline_id ? "提交中…" : "提交草稿"}
                      </Button>
                    )}
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
          {Object.keys(lastVerification).length > 0 && (
            <Alert>
              <p className="text-sm">
                单条草稿提交后会自动验证 catalog 可见性、`template_ref` 一致性和 template bundle 可拉取性。
              </p>
            </Alert>
          )}
          <Button
            size="sm" onClick={handleSubmitReview}
            disabled={!platformEnabled || submitting || pendingCount === 0}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {submitting ? "提交中…" : platformEnabled ? `提交 ${pendingCount} 个待发布 Hotline` : "请先开启平台发布"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
