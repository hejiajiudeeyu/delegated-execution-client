import { Outlet } from "react-router-dom"
import { BrandBackdrop } from "./BrandBackdrop"
import { Header } from "./Header"
import { ConsoleSidebar, useCurrentTab } from "./Sidebar"
import { FromContextChip } from "./FromContextChip"

/**
 * Application shell for the authenticated ops-console.
 *
 * Activates `.console-mode` on the entire authenticated subtree so the
 * scoped design tokens (paper bg, ink text, 4px radius, brutalist accents)
 * take effect. See `src/styles/console-mode.css` and the canonical mirror
 * `call-anything-brand-site/src/design-system/shells/console-shell.tsx`.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────┐
 *   │ Header (logo · tab nav · session/env · actions)     │  56px
 *   ├──────────┬──────────────────────────────────────────┤
 *   │ Sidebar  │ Main (max-w-6xl, paper bg)               │
 *   │ 224px    │ ?from chip (if any) → page <Outlet />    │
 *   │ rail     │                                          │
 *   └──────────┴──────────────────────────────────────────┘
 */
export function AppShell() {
  const currentTab = useCurrentTab()

  return (
    <div
      className="console-mode isolate relative flex h-screen flex-col overflow-hidden"
      data-tab-ctx={currentTab}
    >
      <BrandBackdrop variant="workspace" />
      <div className="relative z-10 flex h-full flex-col overflow-hidden">
        <Header currentTab={currentTab} />
        <div className="flex flex-1 overflow-hidden">
          <aside
            className="w-56 shrink-0 border-r overflow-y-auto"
            style={{
              borderColor: "var(--sidebar-border)",
              background: "color-mix(in oklab, var(--sidebar) 92%, transparent)",
            }}
          >
            <ConsoleSidebar currentTab={currentTab} />
          </aside>
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto px-8 py-8">
              <FromContextChip />
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
