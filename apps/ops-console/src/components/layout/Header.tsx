import { useNavigate } from "react-router-dom"
import { LogOut, RefreshCw, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/components/ui/utils"

type TabCtx = "general" | "caller" | "responder"

interface HeaderProps {
  currentTab: TabCtx
}

const ROLE_DOT_CLASS: Record<TabCtx, string> = {
  general: "bg-[var(--brand-blue)]",
  caller: "bg-[var(--brand-teal)]",
  responder: "bg-[var(--brand-orange)]",
}

const ROLE_LABEL: Record<TabCtx, string> = {
  general: "通用 / 概览",
  caller: "调用方",
  responder: "响应方",
}

/**
 * Top app header for the authenticated console.
 *
 * Light-brutalist treatment matching the prototype:
 *   - left: brand kicker + active role chip
 *   - right: session pill + actions
 *
 * Per-tab navigation moved entirely into the sidebar (groups always visible
 * for discoverability). The header chip just shows where you are now.
 */
export function Header({ currentTab }: HeaderProps) {
  const { logout, refresh, status } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate("/auth/unlock")
  }

  const sessionDetail = describeSession(status)

  return (
    <header
      className="flex h-14 items-center justify-between border-b px-5 shrink-0"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in oklab, var(--card) 92%, transparent)",
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div
            className="h-7 w-7 flex items-center justify-center bg-[var(--brand-ink)] text-white"
            style={{ borderRadius: "var(--c-radius-sm)" }}
          >
            <Terminal className="h-3.5 w-3.5" strokeWidth={2.5} />
          </div>
          <span className="text-[13.5px] font-semibold tracking-tight text-[var(--ink)]">
            Ops Console
          </span>
        </div>
        <span className="text-[var(--brand-muted)]/40">·</span>
        <div
          className="inline-flex items-center gap-2 px-2.5 py-1 bg-white c-ink-border"
          style={{ borderRadius: "var(--c-radius-pill)" }}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", ROLE_DOT_CLASS[currentTab])} />
          <span className="text-[11.5px] font-semibold text-[var(--ink)]">
            {ROLE_LABEL[currentTab]}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {sessionDetail && (
          <div
            className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-[var(--brand-muted)] bg-[var(--brand-secondary)]/40"
            style={{ borderRadius: "var(--c-radius-pill)" }}
            title={sessionDetail.title}
          >
            <span className="c-dot" style={{ background: sessionDetail.tone === "ok" ? "var(--c-status-success-fg)" : "var(--c-status-warn-fg)" }} />
            <span className="font-medium text-[var(--ink)]">{sessionDetail.label}</span>
            {sessionDetail.detail && (
              <span className="text-[10.5px]">{sessionDetail.detail}</span>
            )}
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={refresh} title="刷新状态">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleLogout} title="退出登录">
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </div>
    </header>
  )
}

/* ── Session info shaping ───────────────────────────────────────────── */

function describeSession(status: ReturnType<typeof useAuth>["status"]) {
  if (!status) return null
  const auth = status.auth
  if (auth?.locked) {
    return { label: "已锁定", tone: "warn" as const, detail: "", title: "会话已锁定" }
  }
  if (auth?.setup_required) {
    return { label: "未初始化", tone: "warn" as const, detail: "", title: "尚未完成首次设置" }
  }
  return { label: "会话已解锁", tone: "ok" as const, detail: "", title: "已认证" }
}
