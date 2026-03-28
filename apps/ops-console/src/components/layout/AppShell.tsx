import { Outlet } from "react-router-dom"
import { Header } from "./Header"
import { ConsoleSidebar, useCurrentTab } from "./Sidebar"

export function AppShell() {
  const currentTab = useCurrentTab()

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background" data-tab-ctx={currentTab}>
      <Header currentTab={currentTab} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-52 shrink-0 border-r border-border overflow-y-auto bg-sidebar">
          <ConsoleSidebar currentTab={currentTab} />
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
