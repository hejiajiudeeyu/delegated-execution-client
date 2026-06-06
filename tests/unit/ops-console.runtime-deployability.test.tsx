/** @vitest-environment happy-dom */

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"

import { RuntimePage } from "../../apps/ops-console/src/pages/general/RuntimePage"

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    async text() {
      return JSON.stringify(body)
    },
  } as unknown as Response
}

function installRuntimeFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url === "/auth/session") {
      return jsonResponse({ recoverable_session: { token: "tok-test" } })
    }
    if (url.startsWith("/runtime/logs")) {
      return jsonResponse({ service: "caller", file: "caller.log", logs: [] })
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
}

describe("RuntimePage deployability guidance", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows deployability readiness profiles and self-host commands", async () => {
    installRuntimeFetch()
    render(<RuntimePage />)

    await waitFor(() => {
      expect(screen.getByText("部署与管理就绪度")).toBeTruthy()
    })

    expect(screen.getByText("platform")).toBeTruthy()
    expect(screen.getByText("public-stack")).toBeTruthy()
    expect(screen.getByText("all-in-one")).toBeTruthy()
    expect(screen.getByText("selfhost:init")).toBeTruthy()
    expect(screen.getByText("selfhost:preflight")).toBeTruthy()
    expect(screen.getByText("selfhost:smoke")).toBeTruthy()
    expect(screen.getByText("selfhost:rotate-plan")).toBeTruthy()
    expect(screen.getByText(/不会显示 secret 值/)).toBeTruthy()
  })

  it("makes billing readiness explicit instead of implied ready", async () => {
    installRuntimeFetch()
    render(<RuntimePage />)

    await waitFor(() => {
      expect(screen.getByText("Billing readiness")).toBeTruthy()
    })

    expect(screen.getByText("P-1 M1.1 基础")).toBeTruthy()
    expect(screen.getByText(/不等于生产默认可用/)).toBeTruthy()
    expect(screen.getByText(/API、读模型、client-facing surface/)).toBeTruthy()
  })

  it("shows skill and MCP adapter runtime cards from supervisor status", async () => {
    installRuntimeFetch()
    render(<RuntimePage />)

    await waitFor(() => {
      expect(screen.getByText("Skill Adapter")).toBeTruthy()
      expect(screen.getByText("MCP Adapter")).toBeTruthy()
    })

    expect(screen.getByText("PID: 404")).toBeTruthy()
    expect(screen.getByText("PID: 505")).toBeTruthy()
  })
})
