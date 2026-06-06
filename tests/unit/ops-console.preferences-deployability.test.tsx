/** @vitest-environment happy-dom */

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { PreferencesPage } from "../../apps/ops-console/src/pages/caller/PreferencesPage"

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    async text() {
      return JSON.stringify(body)
    },
  } as unknown as Response
}

function installPreferencesFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString()
    const method = (init.method || "GET").toUpperCase()

    if (url === "/auth/session") {
      return jsonResponse({ recoverable_session: { token: "tok-test" } })
    }
    if (url === "/caller/global-policy" && method === "GET") {
      return jsonResponse({
        mode: "allow_listed",
        responderWhitelist: ["responder.ops"],
        hotlineWhitelist: ["local.workspace-summary.v1", "public.billing.v1"],
        blocklist: ["unsafe.demo.v1"],
      })
    }
    if (url === "/preferences/task-types" && method === "GET") {
      return jsonResponse({ items: [] })
    }

    return jsonResponse({}, 404)
  })
  vi.stubGlobal("fetch", fetchMock)
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PreferencesPage />
    </MemoryRouter>
  )
}

describe("PreferencesPage deployability guidance", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("summarizes local/public approval policy posture for operators", async () => {
    installPreferencesFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText("部署策略摘要")).toBeTruthy()
    })

    expect(screen.getAllByText("当前模式").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("白名单自动放行").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Responder 白名单：1 项/)).toBeTruthy()
    expect(screen.getByText(/Hotline 白名单：2 项/)).toBeTruthy()
    expect(screen.getByText(/Blocklist：1 项/)).toBeTruthy()
    expect(screen.getByText(/本地模式/)).toBeTruthy()
    expect(screen.getByText(/公开或团队部署/)).toBeTruthy()
    expect(screen.getByText(/allow_all/)).toBeTruthy()
  })
})
