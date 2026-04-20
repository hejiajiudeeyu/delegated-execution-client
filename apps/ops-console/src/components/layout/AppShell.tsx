import { Outlet } from "react-router-dom"
import { BrandBackdrop } from "./BrandBackdrop"
import { Header } from "./Header"
import { ConsoleSidebar, useCurrentTab } from "./Sidebar"

export function AppShell() {
  const currentTab = useCurrentTab()

  return (
    <div className="isolate relative flex h-screen flex-col overflow-hidden" data-tab-ctx={currentTab}>
      <BrandBackdrop variant="workspace" />
      <div className="relative z-10 flex h-full flex-col overflow-hidden">
        <Header currentTab={currentTab} />
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-52 shrink-0 border-r border-border overflow-y-auto bg-sidebar/95">
            <ConsoleSidebar currentTab={currentTab} />
          </aside>
          <main className="flex-1 overflow-y-auto bg-background/85 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
