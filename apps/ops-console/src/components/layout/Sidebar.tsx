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
  PlayCircle,
  MessageSquareWarning,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/components/ui/utils"
import { useAuth } from "@/hooks/useAuth"
import { apiCall } from "@/lib/api"
import { isCallerRegistered } from "@/lib/status"

type TabCtx = "general" | "caller" | "responder"

interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  locked?: boolean
  badge?: number
}

interface NavGroupSpec {
  ctx: TabCtx
  label: string
  description: string
  items: NavItem[]
  emptyHint?: string
}

const GENERAL_NAV: NavItem[] = [
  { label: "工作台", path: "/general", icon: LayoutDashboard },
  { label: "传输层", path: "/general/transport", icon: Wifi },
  { label: "运行时", path: "/general/runtime", icon: Terminal },
]

const RESPONDER_NAV_LOCKED: NavItem[] = [
  { label: "启用 Responder", path: "/responder/activate", icon: LockKeyhole, locked: true },
]

const RESPONDER_NAV: NavItem[] = [
  { label: "概览", path: "/responder", icon: Server },
  { label: "Hotline 管理", path: "/responder/hotlines", icon: BookOpen },
  { label: "平台发布", path: "/responder/review", icon: FileCheck },
]

/* ── Sidebar ────────────────────────────────────────────────────────── */

export function ConsoleSidebar({ currentTab: _currentTab }: { currentTab: TabCtx }) {
  const { status } = useAuth()
  const responderEnabled = status?.responder?.enabled ?? false
  const callerRegistered = isCallerRegistered(status)

  const [pendingApprovals, setPendingApprovals] = useState(0)

  useEffect(() => {
    if (!callerRegistered) return
    let active = true
    async function fetchPending() {
      const res = await apiCall<{ pendingCount: number }>(
        "/caller/approvals?status=pending",
        { silent: true },
      )
      if (active && res.ok && res.data?.pendingCount != null) {
        setPendingApprovals(res.data.pendingCount)
      }
    }
    fetchPending()
    const timer = setInterval(fetchPending, 10000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [callerRegistered])

  const callerNav: NavItem[] = [
    { label: "概览", path: "/caller", icon: Activity },
    { label: "热线目录", path: "/caller/catalog", icon: BookOpen },
    { label: "调用记录", path: "/caller/calls", icon: Zap },
    { label: "审批中心", path: "/caller/approvals", icon: ShieldCheck, badge: pendingApprovals },
    { label: "名单管理", path: "/caller/lists", icon: FileCheck },
    { label: "偏好", path: "/caller/preferences", icon: Settings },
  ]

  const groups: NavGroupSpec[] = [
    {
      ctx: "general",
      label: "概览",
      description: "本机健康、传输与运行时",
      items: GENERAL_NAV,
    },
    {
      ctx: "caller",
      label: "调用方",
      description: "让 Agent 帮你调用 Hotline",
      items: callerNav,
      emptyHint: callerRegistered ? undefined : "未注册",
    },
    {
      ctx: "responder",
      label: "响应方",
      description: "把你写的能力发布成 Hotline",
      items: responderEnabled ? RESPONDER_NAV : RESPONDER_NAV_LOCKED,
      emptyHint: responderEnabled ? undefined : "未启用",
    },
  ]

  return (
    <div className="flex flex-col h-full">
      <nav className="flex-1 py-3">
        {groups.map((group, gi) => (
          <SidebarGroup key={group.ctx} group={group} divided={gi > 0} />
        ))}
      </nav>
      <SidebarHelpFooter />
    </div>
  )
}

/* ── Sidebar group ──────────────────────────────────────────────────── */

const ROLE_DOT_CLASS: Record<TabCtx, string> = {
  general: "bg-[var(--brand-blue)]",
  caller: "bg-[var(--brand-teal)]",
  responder: "bg-[var(--brand-orange)]",
}

function SidebarGroup({ group, divided }: { group: NavGroupSpec; divided: boolean }) {
  return (
    <div
      className={cn(
        "px-3 pb-3",
        divided && "mt-1 pt-3 border-t",
      )}
      style={divided ? { borderColor: "var(--sidebar-border)" } : undefined}
    >
      <div className="px-2 pb-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 rounded-full", ROLE_DOT_CLASS[group.ctx])} />
          <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[var(--ink)]">
            {group.label}
          </p>
          {group.emptyHint && (
            <span className="ml-1 text-[10px] text-[var(--brand-muted)]">{group.emptyHint}</span>
          )}
        </div>
        {group.description && (
          <p className="text-[10.5px] text-[var(--brand-muted)]/85 mt-0.5">{group.description}</p>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {group.items.map((item) => (
          <SidebarItem key={item.path} item={item} />
        ))}
      </div>
    </div>
  )
}

/* ── Sidebar item (light brutalist active state) ────────────────────── */

function SidebarItem({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.path.split("/").length <= 2}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
          isActive
            ? "bg-white text-[var(--ink)] c-ink-border c-shadow-1"
            : "text-[var(--ink)]/75 hover:text-[var(--ink)] hover:bg-[var(--brand-secondary)]/40",
          item.locked && "opacity-70",
        )
      }
      style={{ borderRadius: "var(--c-radius-sm)" }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
      <span className="truncate">{item.label}</span>
      {item.locked && <LockKeyhole className="h-3 w-3 ml-auto text-[var(--brand-muted)]" />}
      {item.badge != null && item.badge > 0 && (
        <span
          className="ml-auto inline-flex h-4 min-w-4 items-center justify-center px-1 text-[10px] font-bold text-white bg-[var(--brand-orange)] c-ink-border"
          style={{ borderRadius: "999px" }}
        >
          {item.badge}
        </span>
      )}
    </NavLink>
  )
}

/* ── Help footer (spec §0.5) ────────────────────────────────────────── */

const HELP_LINKS: { href: string; label: string; icon: LucideIcon; tone: "primary" | "muted" }[] = [
  { href: "/help", label: "使用指南", icon: BookOpen, tone: "primary" },
  { href: "/help#first-call", label: "示例 Hotline 速跑", icon: PlayCircle, tone: "muted" },
  { href: "/help#feedback", label: "报告问题", icon: MessageSquareWarning, tone: "muted" },
]

function SidebarHelpFooter() {
  return (
    <div
      className="border-t px-3 py-3 mt-1"
      style={{ borderColor: "var(--sidebar-border)" }}
    >
      <p className="px-2 mb-2 text-[10px] font-semibold tracking-[0.14em] uppercase text-[var(--brand-muted)]">
        上手 & 帮助
      </p>
      <div className="flex flex-col gap-0.5">
        {HELP_LINKS.map((link) => {
          const Icon = link.icon
          return (
            <NavLink
              key={link.href}
              to={link.href}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 px-2.5 py-1.5 text-[12px] transition-colors",
                  isActive
                    ? "bg-white text-[var(--ink)] c-ink-border"
                    : link.tone === "primary"
                      ? "text-[var(--ink)] hover:bg-[var(--brand-secondary)]/40"
                      : "text-[var(--brand-muted)] hover:text-[var(--ink)] hover:bg-[var(--brand-secondary)]/40",
                )
              }
              style={{ borderRadius: "var(--c-radius-sm)" }}
            >
              <Icon className="h-3 w-3 shrink-0" strokeWidth={2.25} />
              <span className="truncate">{link.label}</span>
            </NavLink>
          )
        })}
      </div>
    </div>
  )
}

/* ── Tab context router helper ──────────────────────────────────────── */

export function useCurrentTab(): TabCtx {
  const { pathname } = useLocation()
  if (pathname.startsWith("/caller")) return "caller"
  if (pathname.startsWith("/responder")) return "responder"
  return "general"
}
