import { Link, useNavigate } from "react-router-dom"
import { LogOut, RefreshCw, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/components/ui/utils"

type TabCtx = "general" | "caller" | "responder"

interface HeaderProps {
  currentTab: TabCtx
}

const tabMeta: Record<TabCtx, { label: string; color: string; href: string }> = {
  general: { label: "通用", color: "bg-blue-500", href: "/general" },
  caller: { label: "Caller", color: "bg-teal-500", href: "/caller/catalog" },
  responder: { label: "Responder", color: "bg-orange-500", href: "/responder" },
}

export function Header({ currentTab }: HeaderProps) {
  const { logout, refresh } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate("/auth/unlock")
  }

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-card px-4 shrink-0">
      <div className="flex items-center gap-3">
        <Terminal className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold tracking-tight">Ops Console</span>
        <span className="text-muted-foreground/40">·</span>
        {(["general", "caller", "responder"] as TabCtx[]).map((tab) => {
          const meta = tabMeta[tab]
          const isActive = tab === currentTab
          return (
            <Link
              key={tab}
              to={meta.href}
              className={cn(
                "relative flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", meta.color)} />
              {meta.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
              )}
            </Link>
          )
        })}
      </div>
      <div className="flex items-center gap-1">
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
