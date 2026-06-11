/** @vitest-environment happy-dom */

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { DashboardPage } from "../../apps/ops-console/src/pages/general/DashboardPage"

const refreshMock = vi.fn()

vi.mock("../../apps/ops-console/src/hooks/useStatus", () => ({
  useStatus: () => ({
    data: {
      caller: { registered: false },
      responder: { enabled: false, hotline_count: 0 },
      runtime: {
        caller: { health: { body: { ok: true } } },
        responder: { health: { body: { ok: false } } },
        relay: { health: { body: { ok: true } } },
      },
      config: { platform: { enabled: false, base_url: "http://127.0.0.1:8080" } },
    },
    refresh: refreshMock,
  }),
}))

describe("DashboardPage local-first copy", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("frames Caller registration around the local loop before platform discovery", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 0 } as Response)))
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText("注册 Caller，解锁本机 Hotline 调用能力")).toBeTruthy()
    })
    expect(screen.getByText(/本机 Caller 身份/)).toBeTruthy()
    expect(screen.queryByText(/平台上的 Remote Hotline/)).toBeNull()
  })
})
