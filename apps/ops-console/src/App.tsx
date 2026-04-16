import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom"
import { Toaster } from "sonner"
import { AuthProvider, useAuth } from "@/hooks/useAuth"
import { getSessionToken } from "@/lib/api"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { AppShell } from "@/components/layout/AppShell"
import { SetupPage, UnlockPage } from "@/pages/auth/AuthPages"
import { DashboardPage } from "@/pages/general/DashboardPage"
import { TransportPage } from "@/pages/general/TransportPage"
import { RuntimePage } from "@/pages/general/RuntimePage"
import { CallerOverviewPage } from "@/pages/caller/CallerOverviewPage"
import { CallerRegisterPage } from "@/pages/caller/CallerRegisterPage"
import { CatalogPage } from "@/pages/caller/CatalogPage"
import { CallsPage } from "@/pages/caller/CallsPage"
import { CallerApprovalsPage } from "@/pages/caller/CallerApprovalsPage"
import { PreferencesPage } from "@/pages/caller/PreferencesPage"
import { AccessListsPage } from "@/pages/caller/AccessListsPage"
import { ResponderLockedPage } from "@/pages/responder/ResponderLockedPage"
import { ResponderOverviewPage } from "@/pages/responder/ResponderOverviewPage"
import { ResponderHotlinesPage } from "@/pages/responder/ResponderHotlinesPage"
import { ResponderReviewPage } from "@/pages/responder/ResponderReviewPage"

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    )
  }

  if (!status) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        读取运行状态中…
      </div>
    )
  }

  const next = `${location.pathname}${location.search}${location.hash}`

  if (status.auth.setup_required) {
    return <Navigate to="/auth/setup" replace state={{ next }} />
  }

  if (status.auth.locked || !getSessionToken()) {
    return <Navigate to="/auth/unlock" replace state={{ next }} />
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth/setup" element={<SetupPage />} />
      <Route path="/auth/unlock" element={<UnlockPage />} />
      <Route
        path="/"
        element={
          <AuthGuard>
            <AppShell />
          </AuthGuard>
        }
      >
        <Route index element={<Navigate to="/general" replace />} />
        <Route path="general" element={<DashboardPage />} />
        <Route path="general/transport" element={<TransportPage />} />
        <Route path="general/runtime" element={<RuntimePage />} />

        <Route path="caller">
          <Route index element={<CallerOverviewPage />} />
          <Route path="register" element={<CallerRegisterPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="calls" element={<CallsPage />} />
          <Route path="calls/new" element={<CallsPage />} />
          <Route path="approvals" element={<CallerApprovalsPage />} />
          <Route path="preferences" element={<PreferencesPage />} />
          <Route path="lists" element={<AccessListsPage />} />
        </Route>

        <Route path="responder">
          <Route index element={<ResponderOverviewPage />} />
          <Route path="activate" element={<ResponderLockedPage />} />
          <Route path="hotlines" element={<ResponderHotlinesPage />} />
          <Route path="review" element={<ResponderReviewPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
        <Toaster position="bottom-right" richColors />
      </AuthProvider>
    </BrowserRouter>
  )
}
