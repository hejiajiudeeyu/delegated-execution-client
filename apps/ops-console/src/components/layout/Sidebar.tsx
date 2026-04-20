import React, { useEffect, useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import {
  Activity,
  Wifi,
  Terminal,
  LayoutDashboard,
  BookOpen,
  Zap,
  Settings,
  Server,
  LockKeyhole,
  FileCheck,
  ShieldCheck,
} from "lucide-react"
import { cn } from "@/components/ui/utils"
import { useAuth } from "@/hooks/useAuth"
import { apiCall } from "@/lib/api"
import { isCallerRegistered } from "@/lib/status"

type TabCtx = "general" | "caller" | "responder"

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
  locked?: boolean
  badge?: number
}

const GENERAL_NAV: NavItem[] = [
  { label: "Dashboard", path: "/general", icon: Activity },
  { label: "Transport", path: "/general/transport", icon: Wifi },
  { label: "Runtime", path: "/general/runtime", icon: Terminal },
]

const RESPONDER_NAV_LOCKED: NavItem[] = [
  { label: "启用 Responder", path: "/responder/activate", icon: LockKeyhole, locked: true },
]

const RESPONDER_NAV: NavItem[] = [
  { label: "概览", path: "/responder", icon: Server },
  { label: "Hotline 管理", path: "/responder/hotlines", icon: BookOpen },
  { label: "平台发布", path: "/responder/review", icon: FileCheck },
]

function NavGroup({
  items,
  ctx,
}: {
  items: NavItem[]
  ctx: TabCtx
}) {
  const accentColor: Record<TabCtx, string> = {
    general: "text-blue-500",
    caller: "text-cyan-500",
    responder: "text-orange-500",
  }
  const activeBg: Record<TabCtx, string> = {
    general: "bg-blue-500/10 text-blue-700",
    caller: "bg-cyan-500/10 text-cyan-700",
    responder: "bg-orange-500/10 text-orange-700",
  }

  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path.split("/").length <= 2}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? activeBg[ctx]
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
                item.locked && "opacity-70"
              )
            }
          >
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                accentColor[ctx]
              )}
            />
            {item.label}
            {item.locked && <LockKeyhole className="h-3 w-3 ml-auto text-muted-foreground" />}
            {item.badge != null && item.badge > 0 && (
              <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {item.badge}
              </span>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

export function ConsoleSidebar({ currentTab }: { currentTab: TabCtx }) {
  const { status } = useAuth()
  const responderEnabled = status?.responder?.enabled ?? false
  const callerRegistered = isCallerRegistered(status)

  const [pendingApprovals, setPendingApprovals] = useState(0)

  useEffect(() => {
    if (!callerRegistered) return
    let active = true
    async function fetchPending() {
      const res = await apiCall<{ pendingCount: number }>("/caller/approvals?status=pending", { silent: true })
      if (active && res.ok && res.data?.pendingCount != null) {
        setPendingApprovals(res.data.pendingCount)
      }
    }
    fetchPending()
    const timer = setInterval(fetchPending, 10000)
    return () => { active = false; clearInterval(timer) }
  }, [callerRegistered])

  const callerNav: NavItem[] = [
    { label: "概览", path: "/caller", icon: LayoutDashboard },
    { label: "热线目录", path: "/caller/catalog", icon: BookOpen },
    { label: "调用记录", path: "/caller/calls", icon: Zap },
    { label: "审批中心", path: "/caller/approvals", icon: ShieldCheck, badge: pendingApprovals },
    { label: "偏好设置", path: "/caller/preferences", icon: Settings },
    { label: "名单管理", path: "/caller/lists", icon: FileCheck },
  ]

  const labels: Record<TabCtx, string> = {
    general: "通用",
    caller: "Caller",
    responder: "Responder",
  }
  const sectionColors: Record<TabCtx, string> = {
    general: "text-blue-600",
    caller: "text-cyan-600",
    responder: "text-orange-600",
  }
  const sectionDots: Record<TabCtx, string> = {
    general: "bg-blue-500",
    caller: "bg-cyan-500",
    responder: "bg-orange-500",
  }

  const items =
    currentTab === "general"
      ? GENERAL_NAV
      : currentTab === "caller"
      ? callerNav
      : responderEnabled
      ? RESPONDER_NAV
      : RESPONDER_NAV_LOCKED

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 rounded-full", sectionDots[currentTab])} />
          <p className={cn("text-xs font-semibold", sectionColors[currentTab])}>
            {labels[currentTab]}
          </p>
        </div>
        {currentTab === "caller" && !callerRegistered && (
          <p className="text-[11px] text-muted-foreground mt-1">未注册</p>
        )}
        {currentTab === "responder" && !responderEnabled && (
          <p className="text-[11px] text-muted-foreground mt-1">未启用</p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        <NavGroup items={items} ctx={currentTab} />
      </div>
    </div>
  )
}

export function useCurrentTab(): TabCtx {
  const { pathname } = useLocation()
  if (pathname.startsWith("/caller")) return "caller"
  if (pathname.startsWith("/responder")) return "responder"
  return "general"
}
