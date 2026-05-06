import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import { apiCall } from "@/lib/api"
import { usePoll } from "@/hooks/usePoll"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  PackageSearch,
  ShieldAlert,
  Sparkles,
  UserPlus,
} from "lucide-react"

interface RequestItem {
  request_id: string
  status?: string
  created_at?: string
  updated_at?: string
}

interface ApprovalRecord {
  status: "pending" | "approved" | "rejected" | "expired"
}

export type NextUpState =
  | "needs_caller_register"
  | "has_pending_approvals"
  | "has_recent_failures"
  | "needs_first_hotline"
  | "needs_first_call"
  | "all_normal"
  | "loading"

interface NextUpCardProps {
  callerRegistered: boolean
  platformEnabled: boolean
  hotlineCount: number
}

interface DerivedStats {
  pendingApprovals: number
  recentFailures: number
  todayCount: number
  totalRequests: number
  lastActivityIso: string | null
}

const TERMINAL_FAILED = new Set(["FAILED", "ERROR", "UNVERIFIED", "TIMED_OUT"])

function isFailureStatus(status?: string): boolean {
  if (!status) return false
  return TERMINAL_FAILED.has(status.toUpperCase())
}

function withinLastHour(iso?: string): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return false
  return Date.now() - t < 60 * 60 * 1000
}

function isToday(iso?: string): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function formatRelative(iso: string | null): string {
  if (!iso) return "暂无活动"
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return "暂无活动"
  const diff = Math.max(0, Date.now() - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
}

export function determineState(
  props: NextUpCardProps,
  stats: DerivedStats | null,
): NextUpState {
  if (stats === null) return "loading"
  if (!props.callerRegistered) return "needs_caller_register"
  if (stats.pendingApprovals > 0) return "has_pending_approvals"
  if (stats.recentFailures > 0) return "has_recent_failures"
  if (props.callerRegistered && props.hotlineCount === 0 && !props.platformEnabled) {
    return "needs_first_hotline"
  }
  if (props.hotlineCount > 0 && stats.totalRequests === 0) return "needs_first_call"
  return "all_normal"
}

interface StateView {
  icon: React.ReactNode
  rail: string
  title: string
  body: string
  cta?: { label: string; to: string }
  secondary?: { label: string; to: string }
}

function buildView(
  state: NextUpState,
  props: NextUpCardProps,
  stats: DerivedStats | null,
): StateView | null {
  switch (state) {
    case "loading":
      return null
    case "needs_caller_register":
      return {
        icon: <UserPlus className="h-4 w-4" />,
        rail: "var(--c-status-error-fg, #dc2626)",
        title: "先把 Caller 注册了",
        body: "注册之后才能搜 Hotline、试拨、收审批。30 秒搞定。",
        cta: { label: "立即注册", to: "/caller/register?from=dashboard-nextup" },
        secondary: { label: "了解 Caller 是什么", to: "/help#what-is-caller" },
      }
    case "has_pending_approvals":
      return {
        icon: <ShieldAlert className="h-4 w-4" />,
        rail: "var(--brand-yellow, #f59e0b)",
        title: `你有 ${stats?.pendingApprovals ?? 0} 个调用等审批`,
        body: "这些是 Agent 帮你发起的调用；审批后 Responder 才会执行。",
        cta: { label: "去审批", to: "/caller/approvals?from=dashboard-nextup" },
        secondary: { label: "换成自动放行模式", to: "/caller/preferences" },
      }
    case "has_recent_failures":
      return {
        icon: <AlertCircle className="h-4 w-4" />,
        rail: "var(--c-status-error-fg, #dc2626)",
        title: `最近 1 小时有 ${stats?.recentFailures ?? 0} 次调用失败`,
        body: "看看哪一条出了问题。常见原因：Responder 离线 / 上游超时 / 鉴权过期。",
        cta: { label: "查看失败", to: "/caller/calls?filter=failed&from=dashboard-nextup" },
        secondary: { label: "Runtime 日志", to: "/general/runtime" },
      }
    case "needs_first_hotline":
      return {
        icon: <PackageSearch className="h-4 w-4" />,
        rail: "var(--brand-teal, #14b8a6)",
        title: "你还没有任何 Hotline 可调",
        body: "两条路：让你的 Responder 发布一个，或者开启平台模式浏览社区已发布的。",
        cta: { label: "去 Catalog", to: "/caller/catalog?from=dashboard-nextup" },
        secondary: { label: "开启平台模式", to: "/general" },
      }
    case "needs_first_call":
      return {
        icon: <Sparkles className="h-4 w-4" />,
        rail: "var(--brand-teal, #14b8a6)",
        title: "试拨一次跑通端到端",
        body: "从 Catalog 选一个，5 秒内能看到第一条记录。",
        cta: { label: "打开 Catalog", to: "/caller/catalog?from=dashboard-nextup" },
        secondary: { label: "什么是 Hotline", to: "/help#what-is-hotline" },
      }
    case "all_normal": {
      const last = formatRelative(stats?.lastActivityIso ?? null)
      const today = stats?.todayCount ?? 0
      return {
        icon: <CheckCircle2 className="h-4 w-4" />,
        rail: "var(--c-status-success-fg, #16a34a)",
        title: "一切正常 ✓",
        body: `上次活动 ${last} · 今日已完成调用 ${today} · 没有待审批`,
        secondary: { label: "查看最近调用", to: "/caller/calls" },
      }
    }
    default:
      return null
  }
}

export function NextUpCard(props: NextUpCardProps) {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DerivedStats | null>(null)

  const loadData = useCallback(async () => {
    if (!props.callerRegistered) {
      setStats({ pendingApprovals: 0, recentFailures: 0, todayCount: 0, totalRequests: 0, lastActivityIso: null })
      return
    }
    const [requestsRes, approvalsRes] = await Promise.all([
      apiCall<{ items?: RequestItem[]; requests?: RequestItem[] }>("/requests", { silent: true }),
      apiCall<{ items?: ApprovalRecord[] }>("/caller/approvals?status=pending", { silent: true }),
    ])
    const requestItems = requestsRes.ok ? requestsRes.data?.items ?? requestsRes.data?.requests ?? [] : []
    const approvalItems = approvalsRes.ok ? approvalsRes.data?.items ?? [] : []
    const requests = Array.isArray(requestItems) ? requestItems : []
    const approvals = Array.isArray(approvalItems) ? approvalItems : []

    let recentFailures = 0
    let todayCount = 0
    let lastActivityIso: string | null = null
    for (const r of requests) {
      const ts = r.updated_at ?? r.created_at
      if (isFailureStatus(r.status) && withinLastHour(ts)) recentFailures += 1
      if (ts && isToday(ts)) todayCount += 1
      if (ts && (!lastActivityIso || Date.parse(ts) > Date.parse(lastActivityIso))) lastActivityIso = ts
    }

    setStats({
      pendingApprovals: approvals.filter((a) => a.status === "pending").length,
      recentFailures,
      todayCount,
      totalRequests: requests.length,
      lastActivityIso,
    })
  }, [props.callerRegistered])

  usePoll(loadData, { intervalMs: 5000 })

  const state = determineState(props, stats)
  const view = buildView(state, props, stats)

  if (state === "loading" || view === null) {
    return (
      <Card data-testid="nextup-card-loading">
        <CardContent className="p-4">
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      data-testid="nextup-card"
      data-state={state}
      className="overflow-hidden"
      style={{ borderLeft: `3px solid ${view.rail}` }}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{ background: view.rail, color: "white" }}
            >
              {view.icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{view.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{view.body}</p>
              {view.secondary && (
                <a
                  href={view.secondary.to}
                  onClick={(e) => {
                    if (view.secondary!.to.startsWith("/")) {
                      e.preventDefault()
                      navigate(view.secondary!.to)
                    }
                  }}
                  className="mt-1.5 inline-block text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  {view.secondary.label} →
                </a>
              )}
            </div>
          </div>
          {view.cta && (
            <div className="shrink-0">
              <Button size="sm" onClick={() => navigate(view.cta!.to)}>
                {view.cta.label}
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
