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
    expect(screen.getByText("selfhost:smoke")).toBeTruthy()
    expect(screen.getByText("selfhost:rotate-plan")).toBeTruthy()
    expect(screen.getByText(/不会显示 secret 值/)).toBeTruthy()
  })
})
