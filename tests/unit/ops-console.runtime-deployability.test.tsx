/** @vitest-environment happy-dom */

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { RuntimePage } from "../../apps/ops-console/src/pages/general/RuntimePage"

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    async text() {
      return JSON.stringify(body)
    },
  } as unknown as Response
}

function installRuntimeFetch(logs: string[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url === "/auth/session") {
      return jsonResponse({ recoverable_session: { token: "tok-test" } })
    }
    if (url.startsWith("/runtime/logs")) {
      return jsonResponse({ service: "caller", file: "caller.log", logs })
    }
    if (url.startsWith("/runtime/alerts")) {
      return jsonResponse({ service: "caller", alerts: [] })
    }
    if (url === "/status") {
      return jsonResponse({
        runtime: {
          caller: { running: true, pid: 101, health: { status: 200, body: { ok: true } } },
          responder: { running: false, pid: null, health: { status: 503, body: { ok: false } } },
          relay: { running: true, pid: 303, health: { status: 200, body: { ok: true } } },
          skill_adapter: { running: true, pid: 404, health: { status: 200, body: { ok: true } } },
          mcp_adapter: { running: true, pid: 505, health: { status: 200, body: { ok: true } } },
        },
      })
    }
    if (url === "/debug/snapshot") {
      return jsonResponse({ transport: { mode: "relay_http" } })
    }
    return jsonResponse({}, 404)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function renderPage(initialEntry = "/general/runtime") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RuntimePage />
    </MemoryRouter>
  )
}

describe("RuntimePage local debugging guidance", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows local agent loop debugging commands before self-host commands", async () => {
    installRuntimeFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText("本机调试路径")).toBeTruthy()
    })

    expect(screen.getByText("delexec-ops bootstrap --open-ui")).toBeTruthy()
    expect(screen.getByText("delexec-ops status")).toBeTruthy()
    expect(screen.getByText("delexec-ops run-example")).toBeTruthy()
    expect(screen.getByText("delexec-ops debug-snapshot")).toBeTruthy()
    expect(screen.getByText(/先在本机跑通 Caller、Responder、Relay/)).toBeTruthy()
    expect(screen.getByText(/公网或 self-host 是后续发布路径/)).toBeTruthy()
  })

  it("keeps publishing and self-host outside the local debug prerequisite path", async () => {
    installRuntimeFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText("发布边界")).toBeTruthy()
    })

    expect(screen.getByText(/本机调试通过后，才考虑平台发布/)).toBeTruthy()
    expect(screen.getByText(/不把 self-host 当成本机闭环的前置步骤/)).toBeTruthy()
    expect(screen.queryByText("Billing readiness")).toBeNull()
  })

  it("shows skill and MCP adapter runtime cards from supervisor status", async () => {
    installRuntimeFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText("Skill Adapter")).toBeTruthy()
      expect(screen.getByText("MCP Adapter")).toBeTruthy()
    })

    expect(screen.getByText("PID: 404")).toBeTruthy()
    expect(screen.getByText("PID: 505")).toBeTruthy()
  })

  it("opens the requested service and log filter from query params", async () => {
    const fetchMock = installRuntimeFetch(["responder completed req-deep-link with status SUCCEEDED"])
    renderPage("/general/runtime?service=responder&filter=req-deep-link")

    await waitFor(() => {
      expect(screen.getByDisplayValue("req-deep-link")).toBeTruthy()
    })

    expect(screen.getByText("日志 — responder")).toBeTruthy()
    expect(screen.getByTestId("log-filter-match").textContent).toBe("req-deep-link")
    expect(fetchMock).toHaveBeenCalledWith(
      "/runtime/logs?service=responder&max_lines=500",
      expect.any(Object)
    )
  })
})
