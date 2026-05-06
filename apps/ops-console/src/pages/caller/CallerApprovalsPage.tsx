import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { apiCall } from "@/lib/api"
import { usePoll } from "@/hooks/usePoll"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CheckCircle, XCircle, Clock, ShieldAlert, ShieldCheck, Info,
  Loader2, AlertTriangle, FileText, User, Zap, X,
} from "lucide-react"
import { cn } from "@/components/ui/utils"
import { toast } from "sonner"

type ApprovalStatus = "pending" | "approved" | "rejected" | "expired"
type ExecStatus = "running" | "succeeded" | "failed" | "timed_out" | "unknown"

interface RiskFactor {
  factor: string
  description: string
  severity: "high" | "medium" | "low" | "info"
}

interface OutputDisplayHints {
  primary_field?: string
  field_display_order?: string[]
  field_labels?: Record<string, string>
  field_descriptions?: Record<string, string>
}

interface ExecutionState {
  requestId: string | null
  status: ExecStatus
  responder: { responderId: string; hotlineId: string } | null
  result: Record<string, unknown> | null
  humanSummary: string | null
  usage: Record<string, unknown> | null
  error: { code: string; message: string } | null
  timing: { accepted_at?: string; finished_at?: string; elapsed_ms?: number } | null
  startedAt: string | null
  completedAt: string | null
}

interface ApprovalRecord {
  id: string
  hotlineId: string
  purpose: string | null
  agentSessionId: string | null
  inputSummary: string | null
  hotlineInfo: {
    displayName: string
    responderId: string
    description: string | null
    reviewStatus: string | null
    outputDisplayHints?: OutputDisplayHints | null
  } | null
  riskFactors: RiskFactor[]
  overallRisk: "high" | "medium" | "low" | "info"
  status: ApprovalStatus
  createdAt: string
  expiresAt: string
  decidedAt: string | null
  execution: ExecutionState | null
}

type ApprovalMode = "manual" | "allow_listed" | "allow_all"

interface GlobalPolicy {
  mode: ApprovalMode
  responderWhitelist: string[]
  hotlineWhitelist: string[]
  blocklist: string[]
}

const SEVERITY_COLORS: Record<string, string> = {
  high: "text-red-600 bg-red-50 border-red-200",
  medium: "text-amber-600 bg-amber-50 border-amber-200",
  low: "text-blue-600 bg-blue-50 border-blue-200",
  info: "text-slate-600 bg-slate-50 border-slate-200",
}

const RISK_ICONS: Record<string, React.ElementType> = {
  high: ShieldAlert,
  medium: ShieldAlert,
  low: ShieldCheck,
  info: Info,
}

function RiskBadge({ severity }: { severity: string }) {
  const labels: Record<string, string> = {
    high: "高风险",
    medium: "中风险",
    low: "低风险",
    info: "提示",
  }
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info)}>
      {labels[severity] ?? severity}
    </span>
  )
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const map: Record<ApprovalStatus, { label: string; className: string }> = {
    pending: { label: "待审批", className: "bg-amber-100 text-amber-700 border-amber-300" },
    approved: { label: "已批准", className: "bg-green-100 text-green-700 border-green-300" },
    rejected: { label: "已拒绝", className: "bg-red-100 text-red-700 border-red-300" },
    expired: { label: "已过期", className: "bg-slate-100 text-slate-500 border-slate-300" },
  }
  const { label, className } = map[status] ?? map.expired
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", className)}>{label}</span>
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s 前`
  if (diff < 3600) return `${Math.floor(diff / 60)}min 前`
  return `${Math.floor(diff / 3600)}h 前`
}

function expiresIn(iso: string): string {
  const diff = Math.floor((new Date(iso).getTime() - Date.now()) / 1000)
  if (diff <= 0) return "已过期"
  if (diff < 60) return `${diff}s 后过期`
  return `${Math.floor(diff / 60)}min 后过期`
}

interface ResultRow {
  key: string
  label: string
  value: string
  isPrimary: boolean
}

function buildResultRows(
  result: Record<string, unknown>,
  hints: OutputDisplayHints | null | undefined
): ResultRow[] {
  const primaryField = hints?.primary_field
  const labels = hints?.field_labels ?? {}
  const order = hints?.field_display_order

  // Flatten one level: nested objects become "parent.child" keys
  const flat: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(result)) {
    if (v === null || v === undefined) continue
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
        if (subV !== null && subV !== undefined) {
          flat[`${k}.${subK}`] = subV
        }
      }
    } else {
      flat[k] = v
    }
  }

  const allKeys = order
    ? [...order.filter((k) => k in flat), ...Object.keys(flat).filter((k) => !order.includes(k))]
    : Object.keys(flat)

  return allKeys.map((key) => ({
    key,
    label: labels[key] ?? key,
    value: Array.isArray(flat[key]) ? JSON.stringify(flat[key], null, 2) : String(flat[key]),
    isPrimary: key === primaryField,
  }))
}

function ExecutionBlock({
  execution,
  hints,
}: {
  execution: ExecutionState
  hints?: OutputDisplayHints | null
}) {
  const isRunning = execution.status === "running"
  const isSucceeded = execution.status === "succeeded"
  const isFailed = execution.status === "failed" || execution.status === "timed_out"

  const resultRows = execution.result ? buildResultRows(execution.result, hints) : null

  return (
    <div className={cn(
      "mt-1 rounded-md border p-3 space-y-2 text-xs",
      isRunning   && "border-blue-200 bg-blue-50/60",
      isSucceeded && "border-green-200 bg-green-50/60",
      isFailed    && "border-red-200 bg-red-50/60",
    )}>
      {/* Status header */}
      <div className="flex items-center gap-1.5 font-medium">
        {isRunning   && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
        {isSucceeded && <CheckCircle className="h-3.5 w-3.5 text-green-600" />}
        {isFailed    && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
        <span className={cn(
          isRunning   && "text-blue-700",
          isSucceeded && "text-green-700",
          isFailed    && "text-red-700",
        )}>
          {isRunning   && "Agent 正在执行调用…"}
          {isSucceeded && "执行成功"}
          {isFailed    && (execution.status === "timed_out" ? "执行超时" : "执行失败")}
        </span>
        {execution.requestId && (
          <span className="ml-auto font-mono text-muted-foreground opacity-60 select-all">
            {execution.requestId.slice(0, 18)}…
          </span>
        )}
      </div>

      {/* Responder info */}
      {execution.responder?.responderId && (
        <div className="flex items-center gap-1 text-muted-foreground">
          <User className="h-3 w-3" />
          <span>由 <span className="font-mono text-foreground">{execution.responder.responderId}</span> 处理</span>
        </div>
      )}

      {/* human_summary — one-line result preview */}
      {isSucceeded && execution.humanSummary && (
        <p className={cn(
          "rounded px-2 py-1 font-medium",
          "bg-green-100/80 text-green-800"
        )}>
          {execution.humanSummary}
        </p>
      )}

      {/* Structured output fields */}
      {isSucceeded && resultRows && resultRows.length > 0 && (
        <div className="space-y-1.5 border-t border-green-200 pt-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <FileText className="h-3 w-3" /> 返回结果
          </div>
          <dl className="space-y-2">
            {resultRows.map(({ key, label, value, isPrimary }) => (
              <div key={key}>
                <dt className={cn(
                  "text-muted-foreground",
                  isPrimary ? "font-semibold text-foreground" : "font-mono opacity-70"
                )}>
                  {label}
                </dt>
                <dd className={cn(
                  "leading-relaxed whitespace-pre-wrap break-words pl-2 border-l-2 mt-0.5",
                  isPrimary
                    ? "text-foreground font-medium border-green-400"
                    : "text-foreground border-green-200"
                )}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Error detail */}
      {isFailed && execution.error && (
        <div className="border-t border-red-200 pt-2 space-y-0.5">
          <p className="font-mono text-red-700 font-medium">{execution.error.code}</p>
          <p className="text-red-600">{execution.error.message}</p>
        </div>
      )}

      {/* Footer: timing + usage */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground opacity-70 pt-0.5">
        {execution.completedAt && (
          <span>{timeAgo(execution.completedAt)} 完成</span>
        )}
        {execution.timing?.elapsed_ms != null && (
          <span>· 耗时 {execution.timing.elapsed_ms} ms</span>
        )}
        {execution.usage && Object.keys(execution.usage).length > 0 && (
          <span className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" />
            {Object.entries(execution.usage)
              .map(([k, v]) => `${k}: ${v}`)
              .join("  ")}
          </span>
        )}
      </div>
    </div>
  )
}

// ───────────────── M6 · whitelist education popover ─────────────────

const WHITELIST_POPOVER_COUNT_KEY = "whitelist-popover-shown-count"
const WHITELIST_POPOVER_LIMIT = 3

const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  manual: "全部手动审批",
  allow_listed: "白名单自动放行",
  allow_all: "全部自动放行",
}

function readPopoverShownCount(): number {
  try {
    return Number(window.sessionStorage.getItem(WHITELIST_POPOVER_COUNT_KEY) ?? "0") || 0
  } catch {
    return 0
  }
}

function bumpPopoverShownCount(): number {
  try {
    const next = readPopoverShownCount() + 1
    window.sessionStorage.setItem(WHITELIST_POPOVER_COUNT_KEY, String(next))
    return next
  } catch {
    return 0
  }
}

interface WhitelistPopoverProps {
  hotlineDisplayName: string
  mode: ApprovalMode
  onClose: () => void
  onNavigatePreferences: () => void
  onNavigateAccessLists: () => void
}

function WhitelistEducationPopover({
  hotlineDisplayName,
  mode,
  onClose,
  onNavigatePreferences,
  onNavigateAccessLists,
}: WhitelistPopoverProps) {
  // 8s auto-dismiss; mouse hover pauses the timer, leaving fully resets it
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    if (hovered) return
    const t = window.setTimeout(onClose, 8000)
    return () => window.clearTimeout(t)
  }, [hovered, onClose])

  const isAllowListed = mode === "allow_listed"
  const currentModeLabel = APPROVAL_MODE_LABELS[mode]

  return (
    <div
      role="dialog"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "absolute right-0 top-[calc(100%+6px)] z-20 w-[320px] rounded-md border bg-popover p-3 shadow-lg",
        "text-xs",
        isAllowListed
          ? "border-green-300 bg-green-50/80"
          : "border-amber-300 bg-amber-50/80",
      )}
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute right-1.5 top-1.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
      {isAllowListed ? (
        <>
          <p className="font-semibold text-green-800 mb-1">已加入白名单 ✓</p>
          <p className="text-foreground leading-relaxed mb-2">
            后续 <span className="font-medium">{hotlineDisplayName}</span> 的调用会自动放行，不再来打扰你。
          </p>
          <button
            type="button"
            onClick={onNavigateAccessLists}
            className="text-cyan-700 hover:underline"
          >
            查看 / 管理白名单 →
          </button>
        </>
      ) : (
        <>
          <p className="font-semibold text-amber-800 mb-1">已加入白名单 ✓ · 但当前模式不会自动放行</p>
          <p className="text-foreground leading-relaxed mb-2">
            你现在是「{currentModeLabel}」模式 — 名单不生效。切到「白名单自动放行」才会按白名单走。
          </p>
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white h-7 text-xs"
              onClick={onNavigatePreferences}
            >
              切换到白名单自动放行 →
            </Button>
            <button
              type="button"
              onClick={onNavigateAccessLists}
              className="text-cyan-700 hover:underline self-start"
            >
              保留当前模式，先看名单 →
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ───────────────── M7 · approval-fatigue banner ─────────────────

const TIRED_BANNER_DISMISS_KEY = "approvals.tired-banner.dismissed-at"
const TIRED_BANNER_COOLDOWN_MS = 24 * 60 * 60 * 1000

type TiredCondition =
  | { kind: "hotline_high_freq"; hotlineId: string; displayName: string; count: number }
  | { kind: "monthly_volume"; count: number }
  | { kind: "queue_backlog"; count: number }

function readBannerDismissedAt(): number {
  try {
    const raw = window.localStorage.getItem(TIRED_BANNER_DISMISS_KEY)
    if (!raw) return 0
    const t = new Date(raw).getTime()
    return Number.isFinite(t) ? t : 0
  } catch {
    return 0
  }
}

function persistBannerDismissedAt(): void {
  try {
    window.localStorage.setItem(TIRED_BANNER_DISMISS_KEY, new Date().toISOString())
  } catch {
    // ignore — best-effort persistence
  }
}

// Pick the most actionable trigger first: per-hotline > monthly > backlog.
function evaluateTiredCondition(
  items: ApprovalRecord[],
  mode: ApprovalMode | null,
  now: number,
): TiredCondition | null {
  const sevenDays = now - 7 * 24 * 60 * 60 * 1000
  const thirtyDays = now - 30 * 24 * 60 * 60 * 1000

  const approvedManual = items.filter(
    (i) => i.status === "approved" && i.decidedAt !== null,
  )

  // 1) Same hotline manually approved >= 5 times within 7 days
  const perHotline = new Map<string, { count: number; displayName: string }>()
  for (const item of approvedManual) {
    if (!item.decidedAt) continue
    const t = new Date(item.decidedAt).getTime()
    if (!Number.isFinite(t) || t < sevenDays) continue
    const cur = perHotline.get(item.hotlineId) ?? {
      count: 0,
      displayName: item.hotlineInfo?.displayName ?? item.hotlineId,
    }
    cur.count += 1
    perHotline.set(item.hotlineId, cur)
  }
  let topHotline: { hotlineId: string; count: number; displayName: string } | null = null
  for (const [hotlineId, info] of perHotline) {
    if (info.count >= 5 && (!topHotline || info.count > topHotline.count)) {
      topHotline = { hotlineId, count: info.count, displayName: info.displayName }
    }
  }
  if (topHotline) {
    return {
      kind: "hotline_high_freq",
      hotlineId: topHotline.hotlineId,
      displayName: topHotline.displayName,
      count: topHotline.count,
    }
  }

  // 2) Manual mode + >=20 manual approvals in last 30 days
  if (mode === "manual") {
    const monthly = approvedManual.filter((i) => {
      const t = new Date(i.decidedAt!).getTime()
      return Number.isFinite(t) && t >= thirtyDays
    }).length
    if (monthly >= 20) {
      return { kind: "monthly_volume", count: monthly }
    }
  }

  // 3) Queue backlog: >=5 pending right now
  const pending = items.filter((i) => i.status === "pending").length
  if (pending >= 5) {
    return { kind: "queue_backlog", count: pending }
  }

  return null
}

interface TiredBannerProps {
  condition: TiredCondition
  onDismiss: () => void
  onAddHotlineToWhitelist: (hotlineId: string, displayName: string) => Promise<void>
  onFocusBacklog: () => void
}

function TiredBanner({
  condition,
  onDismiss,
  onAddHotlineToWhitelist,
  onFocusBacklog,
}: TiredBannerProps) {
  const navigate = useNavigate()
  const [acting, setActing] = useState(false)

  let title = ""
  let primary: { label: string; onClick: () => void | Promise<void> } | null = null
  let secondary: { label: string; href: string } | null = null

  switch (condition.kind) {
    case "monthly_volume":
      title = `过去 30 天你手动批准了 ${condition.count} 次 — 切换到「白名单自动放行」可以省下大部分手动操作。`
      primary = {
        label: "去切换模式 →",
        onClick: () =>
          navigate("/caller/preferences?from=approvals-tired-banner"),
      }
      secondary = { label: "了解三种模式 →", href: "/help#approvals" }
      break
    case "hotline_high_freq":
      title = `你已经在 7 天内手动批准了 ${condition.count} 次 ${condition.displayName} — 加它到白名单后未来调用自动放行。`
      primary = {
        label: "加入 Hotline 白名单 →",
        onClick: async () => {
          setActing(true)
          try {
            await onAddHotlineToWhitelist(condition.hotlineId, condition.displayName)
          } finally {
            setActing(false)
          }
        },
      }
      secondary = { label: "了解白名单 →", href: "/help#approvals" }
      break
    case "queue_backlog":
      title = `当前有 ${condition.count} 条待审批 — 一次性批准信任的 hotline 后，剩下的会显著少。`
      primary = {
        label: "批量批准信任的 →",
        onClick: () => onFocusBacklog(),
      }
      secondary = { label: "了解审批策略 →", href: "/help#approvals" }
      break
  }

  return (
    <div
      role="alert"
      className="relative flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs"
      style={{ borderLeftWidth: 3, borderLeftColor: "#f59e0b" }}
    >
      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-amber-900 leading-relaxed">{title}</p>
        <div className="flex items-center gap-3">
          {primary && (
            <Button
              size="sm"
              className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
              disabled={acting}
              onClick={() => void primary!.onClick()}
            >
              {acting ? "处理中…" : primary.label}
            </Button>
          )}
          {secondary && (
            <a
              href={secondary.href}
              className="text-amber-800 hover:underline"
            >
              {secondary.label}
            </a>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label="关闭"
        onClick={onDismiss}
        className="absolute right-1.5 top-1.5 text-amber-700/70 hover:text-amber-900"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

interface ApprovalCardProps {
  item: ApprovalRecord
  onDecide: (id: string, action: "approve" | "reject") => Promise<void>
  onAllowHotline: (item: ApprovalRecord) => Promise<{ added: boolean }>
  globalMode: ApprovalMode | null
}

function ApprovalCard({ item, onDecide, onAllowHotline, globalMode }: ApprovalCardProps) {
  const [deciding, setDeciding] = useState<"approve" | "reject" | "whitelist" | null>(null)
  const [showPopover, setShowPopover] = useState(false)
  const navigate = useNavigate()
  const RiskIcon = RISK_ICONS[item.overallRisk] ?? Info
  const isPending = item.status === "pending"

  async function handleDecide(action: "approve" | "reject") {
    setDeciding(action)
    await onDecide(item.id, action)
    setDeciding(null)
  }

  async function handleAllowHotline() {
    setDeciding("whitelist")
    const res = await onAllowHotline(item)
    setDeciding(null)
    if (!res.added) return
    // Up to WHITELIST_POPOVER_LIMIT popovers per session — afterwards
    // the toast alone carries the receipt.
    if (readPopoverShownCount() >= WHITELIST_POPOVER_LIMIT) return
    bumpPopoverShownCount()
    setShowPopover(true)
  }

  return (
    <Card className={cn("transition-all", isPending && "border-amber-300/60 shadow-sm")}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <RiskIcon className={cn("h-4 w-4 shrink-0", item.overallRisk === "high" ? "text-red-500" : item.overallRisk === "medium" ? "text-amber-500" : "text-blue-400")} />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{item.hotlineInfo?.displayName ?? item.hotlineId}</p>
              <p className="text-xs text-muted-foreground">{item.hotlineId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <RiskBadge severity={item.overallRisk} />
            <StatusBadge status={item.status} />
          </div>
        </div>

        {/* Context */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {item.purpose && (
            <div className="col-span-2">
              <span className="font-medium text-foreground">调用目的：</span>{item.purpose}
            </div>
          )}
          {item.agentSessionId && (
            <div>
              <span className="font-medium text-foreground">Agent Session：</span>
              <span className="font-mono">{item.agentSessionId}</span>
            </div>
          )}
          {item.inputSummary && (
            <div className="col-span-2">
              <span className="font-medium text-foreground">输入摘要：</span>{item.inputSummary}
            </div>
          )}
          <div>
            <span className="font-medium text-foreground">发起时间：</span>{timeAgo(item.createdAt)}
          </div>
          {isPending && (
            <div>
              <Clock className="inline h-3 w-3 mr-0.5 text-amber-500" />
              {expiresIn(item.expiresAt)}
            </div>
          )}
        </div>

        {/* Risk factors */}
        {item.riskFactors.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">风险因素</p>
            <div className="flex flex-wrap gap-1.5">
              {item.riskFactors.map((f, i) => (
                <span
                  key={i}
                  title={f.description}
                  className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs border", SEVERITY_COLORS[f.severity] ?? SEVERITY_COLORS.info)}
                >
                  {f.description}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {isPending && (
          <div className="relative flex items-center gap-2 pt-1 border-t border-border">
            <Button
              size="sm"
              className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              disabled={deciding !== null}
              onClick={() => handleDecide("approve")}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              {deciding === "approve" ? "批准中…" : "批准"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={deciding !== null}
              onClick={handleAllowHotline}
            >
              {deciding === "whitelist" ? "加入中…" : "加入白名单"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-red-300 text-red-600 hover:bg-red-50"
              disabled={deciding !== null}
              onClick={() => handleDecide("reject")}
            >
              <XCircle className="h-3.5 w-3.5" />
              {deciding === "reject" ? "拒绝中…" : "拒绝"}
            </Button>
            <p className="ml-auto text-xs text-muted-foreground">批准后 Agent 可继续执行调用</p>

            {showPopover && globalMode && (
              <WhitelistEducationPopover
                hotlineDisplayName={item.hotlineInfo?.displayName ?? item.hotlineId}
                mode={globalMode}
                onClose={() => setShowPopover(false)}
                onNavigatePreferences={() => {
                  setShowPopover(false)
                  navigate("/caller/preferences?from=approvals-add-whitelist")
                }}
                onNavigateAccessLists={() => {
                  setShowPopover(false)
                  navigate("/caller/access-lists?from=approvals-add-whitelist")
                }}
              />
            )}
          </div>
        )}

        {/* Execution state (shown after approval, while agent invokes) */}
        {!isPending && item.execution && (
          <ExecutionBlock
            execution={item.execution}
            hints={item.hotlineInfo?.outputDisplayHints}
          />
        )}
      </CardContent>
    </Card>
  )
}

export function CallerApprovalsPage() {
  const [items, setItems] = useState<ApprovalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ApprovalStatus | "all">("pending")
  // Mode is needed by the whitelist popover wording AND by the M7 banner trigger.
  const [globalMode, setGlobalMode] = useState<ApprovalMode | null>(null)
  const [bannerDismissedAt, setBannerDismissedAt] = useState<number>(() =>
    readBannerDismissedAt(),
  )
  // M7 evaluates against the **full** approval set, not just the current tab,
  // because per-hotline / 30-day stats span beyond `pending`.
  const [allItemsForStats, setAllItemsForStats] = useState<ApprovalRecord[]>([])

  const load = useCallback(async () => {
    const qs = filter !== "all" ? `?status=${filter}` : ""
    const res = await apiCall<{ items: ApprovalRecord[] }>(`/caller/approvals${qs}`, { silent: true })
    if (res.ok && res.data?.items) setItems(res.data.items)
    setLoading(false)
  }, [filter])

  // Stats source — refreshed alongside `load` but isolates "all" from the active tab.
  const loadStats = useCallback(async () => {
    const res = await apiCall<{ items: ApprovalRecord[] }>("/caller/approvals", { silent: true })
    if (res.ok && res.data?.items) setAllItemsForStats(res.data.items)
  }, [])

  const loadGlobalMode = useCallback(async () => {
    const res = await apiCall<GlobalPolicy>("/caller/global-policy", { silent: true })
    if (res.ok && res.data) setGlobalMode(res.data.mode)
  }, [])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    void loadStats()
    void loadGlobalMode()
  }, [loadStats, loadGlobalMode])

  // Poll the list. Tighten to 2s while any approved record is mid-execution
  // so the UI shows running -> succeeded transitions promptly.
  usePoll(
    useCallback(async () => {
      await Promise.all([load(), loadStats()])
    }, [load, loadStats]),
    {
      intervalMs: 5000,
      fastIntervalMs: 2000,
      fastWhen: () =>
        items.some((i) => i.status === "approved" && i.execution?.status === "running"),
      skipInitial: true,
    },
  )

  const pendingCount = items.filter((i) => i.status === "pending").length

  async function handleDecide(id: string, action: "approve" | "reject") {
    const res = await apiCall(`/caller/approvals/${id}/${action}`, { method: "POST", silent: true })
    if (res.ok) {
      toast.success(action === "approve" ? "已批准，Agent 可继续执行" : "已拒绝调用请求")
      load()
      void loadStats()
    } else {
      toast.error("操作失败，请刷新后重试", { description: res.error.message })
    }
  }

  // Internal helper used by both the per-card whitelist button and the M7 banner
  // shortcut. Returns whether the hotline was newly added so the popover can
  // be triggered only on the actual write.
  const addHotlineToWhitelist = useCallback(
    async (hotlineId: string): Promise<{ added: boolean; mode: ApprovalMode | null }> => {
      const policyRes = await apiCall<GlobalPolicy>("/caller/global-policy", { silent: true })
      if (!policyRes.ok || !policyRes.data) {
        toast.error("无法读取当前策略", {
          description: policyRes.ok ? undefined : policyRes.error.message,
        })
        return { added: false, mode: null }
      }
      const policy = policyRes.data
      if (policy.hotlineWhitelist.includes(hotlineId)) {
        toast.info("该 Hotline 已在白名单中")
        return { added: false, mode: policy.mode }
      }
      const saveRes = await apiCall<GlobalPolicy>("/caller/global-policy", {
        method: "PUT",
        silent: true,
        body: {
          ...policy,
          hotlineWhitelist: [...policy.hotlineWhitelist, hotlineId],
        },
      })
      if (saveRes.ok && saveRes.data) {
        toast.success(
          policy.mode === "allow_listed"
            ? "已加入 Hotline 白名单，后续可自动放行"
            : "已加入 Hotline 白名单；切换到白名单模式后才会自动放行",
        )
        setGlobalMode(saveRes.data.mode)
        return { added: true, mode: saveRes.data.mode }
      }
      toast.error("加入白名单失败，请重试", {
        description: saveRes.ok ? undefined : saveRes.error.message,
      })
      return { added: false, mode: policy.mode }
    },
    [],
  )

  async function handleAllowHotline(item: ApprovalRecord): Promise<{ added: boolean }> {
    const { added } = await addHotlineToWhitelist(item.hotlineId)
    return { added }
  }

  // ── M7 banner ──
  const tiredCondition = useMemo(() => {
    if (Date.now() - bannerDismissedAt < TIRED_BANNER_COOLDOWN_MS) return null
    return evaluateTiredCondition(allItemsForStats, globalMode, Date.now())
  }, [allItemsForStats, globalMode, bannerDismissedAt])

  const pendingListRef = useRef<HTMLDivElement | null>(null)

  function handleDismissBanner() {
    persistBannerDismissedAt()
    setBannerDismissedAt(Date.now())
  }

  function handleFocusBacklog() {
    setFilter("pending")
    pendingListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const FILTERS: { value: ApprovalStatus | "all"; label: string }[] = [
    { value: "pending", label: "待审批" },
    { value: "approved", label: "已批准" },
    { value: "rejected", label: "已拒绝" },
    { value: "expired", label: "已过期" },
    { value: "all", label: "全部" },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            Hotline 调用审批
            {pendingCount > 0 && (
              <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0">
                {pendingCount}
              </Badge>
            )}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Agent 发起的 Hotline 调用需要您手动审批后才能执行
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load}>刷新</Button>
      </div>

      {/* M7 · approval-fatigue banner */}
      {tiredCondition && (
        <TiredBanner
          condition={tiredCondition}
          onDismiss={handleDismissBanner}
          onAddHotlineToWhitelist={async (hotlineId) => {
            await addHotlineToWhitelist(hotlineId)
          }}
          onFocusBacklog={handleFocusBacklog}
        />
      )}

      {/* Filter tabs */}
      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-3 py-1 text-xs rounded-md font-medium transition-colors",
              filter === f.value
                ? "bg-cyan-600 text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {filter === "pending" ? "暂无待审批请求" : "暂无记录"}
        </div>
      ) : (
        <div ref={pendingListRef} className="space-y-3">
          {items.map((item) => (
            <ApprovalCard
              key={item.id}
              item={item}
              onDecide={handleDecide}
              onAllowHotline={handleAllowHotline}
              globalMode={globalMode}
            />
          ))}
        </div>
      )}
    </div>
  )
}
