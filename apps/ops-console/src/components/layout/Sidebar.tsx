import React from "react"
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
} from "lucide-react"
import { cn } from "@/components/ui/utils"
import { useAuth } from "@/hooks/useAuth"

type TabCtx = "general" | "caller" | "responder"

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
  locked?: boolean
}

const GENERAL_NAV: NavItem[] = [
  { label: "Dashboard", path: "/general", icon: Activity },
  { label: "Transport", path: "/general/transport", icon: Wifi },
  { label: "Runtime", path: "/general/runtime", icon: Terminal },
]

const CALLER_NAV: NavItem[] = [
  { label: "概览", path: "/caller", icon: LayoutDashboard },
  { label: "Catalog", path: "/caller/catalog", icon: BookOpen },
  { label: "Call 请求", path: "/caller/calls", icon: Zap },
  { label: "偏好设置", path: "/caller/preferences", icon: Settings },
]

const RESPONDER_NAV_LOCKED: NavItem[] = [
  { label: "启用 Responder", path: "/responder/activate", icon: LockKeyhole, locked: true },
]

const RESPONDER_NAV: NavItem[] = [
  { label: "概览", path: "/responder", icon: Server },
  { label: "Hotline 管理", path: "/responder/hotlines", icon: BookOpen },
  { label: "提交审核", path: "/responder/review", icon: FileCheck },
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
          </NavLink>
        )
      })}
    </nav>
  )
}

export function ConsoleSidebar({ currentTab }: { currentTab: TabCtx }) {
  const { status } = useAuth()
  const responderEnabled = status?.responder?.enabled ?? false
  const callerRegistered = status?.config
    ? (status.config as { caller?: { api_key_configured?: boolean } }).caller?.api_key_configured === true
    : false

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

  const items =
    currentTab === "general"
      ? GENERAL_NAV
      : currentTab === "caller"
      ? CALLER_NAV
      : responderEnabled
      ? RESPONDER_NAV
      : RESPONDER_NAV_LOCKED

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <p className={cn("text-xs font-bold uppercase tracking-widest", sectionColors[currentTab])}>
          {labels[currentTab]}
        </p>
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
