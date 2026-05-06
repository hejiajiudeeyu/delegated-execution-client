/** @vitest-environment happy-dom */

import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { NextUpCard } from "../../apps/ops-console/src/components/dashboard/NextUpCard"

interface RequestStub {
  request_id: string
  status?: string
  created_at?: string
  updated_at?: string
}

interface ApprovalStub {
  status: "pending" | "approved" | "rejected" | "expired"
}

interface MockBackend {
  requests: RequestStub[]
  pendingApprovals: ApprovalStub[]
}

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    async text() {
      return JSON.stringify(body)
    },
  } as unknown as Response
}

function installFetch(state: MockBackend) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url === "/auth/session") {
      return jsonResponse({ recoverable_session: { token: "tok-test" } })
    }
    if (url === "/requests") {
      return jsonResponse({ items: state.requests })
    }
    if (url === "/caller/approvals?status=pending") {
      return jsonResponse({ items: state.pendingApprovals })
    }
    return jsonResponse({}, 404)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function renderCard(props: {
  callerRegistered: boolean
  platformEnabled: boolean
  hotlineCount: number
}) {
  return render(
    <MemoryRouter>
      <NextUpCard {...props} />
    </MemoryRouter>
  )
}

describe("NextUpCard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function expectState(stateName: string) {
    await waitFor(() => {
      const card = screen.queryByTestId("nextup-card")
      expect(card).toBeTruthy()
      expect(card?.getAttribute("data-state")).toBe(stateName)
    })
  }

  it("renders needs_caller_register when caller is not registered (highest priority)", async () => {
    installFetch({
      requests: [{ request_id: "r1", status: "FAILED", created_at: new Date().toISOString() }],
      pendingApprovals: [{ status: "pending" }],
    })
    renderCard({ callerRegistered: false, platformEnabled: false, hotlineCount: 0 })
    await expectState("needs_caller_register")
    expect(screen.getByText("先把 Caller 注册了")).toBeTruthy()
    expect(screen.getByText("立即注册")).toBeTruthy()
  })

  it("renders has_pending_approvals when caller registered and pending approvals > 0", async () => {
    installFetch({
      requests: [],
      pendingApprovals: [{ status: "pending" }, { status: "pending" }, { status: "pending" }],
    })
    renderCard({ callerRegistered: true, platformEnabled: true, hotlineCount: 1 })
    await expectState("has_pending_approvals")
    expect(screen.getByText(/3 个调用等审批/)).toBeTruthy()
    expect(screen.getByText("去审批")).toBeTruthy()
  })

  it("renders has_recent_failures when 1h-window failed > 0 and no pending", async () => {
    installFetch({
      requests: [
        { request_id: "r1", status: "FAILED", updated_at: new Date().toISOString() },
        { request_id: "r2", status: "TIMED_OUT", updated_at: new Date().toISOString() },
      ],
      pendingApprovals: [],
    })
    renderCard({ callerRegistered: true, platformEnabled: true, hotlineCount: 1 })
    await expectState("has_recent_failures")
    expect(screen.getByText(/最近 1 小时有 2 次调用失败/)).toBeTruthy()
    expect(screen.getByText("查看失败")).toBeTruthy()
  })

  it("does not count failed-but-stale requests as recent_failures", async () => {
    const stale = new Date(Date.now() - 90 * 60 * 1000).toISOString()
    installFetch({
      requests: [{ request_id: "r1", status: "FAILED", updated_at: stale }],
      pendingApprovals: [],
    })
    renderCard({ callerRegistered: true, platformEnabled: true, hotlineCount: 1 })
    await expectState("all_normal")
  })

  it("renders needs_first_hotline when caller registered, hotline_count=0, platform off", async () => {
    installFetch({ requests: [], pendingApprovals: [] })
    renderCard({ callerRegistered: true, platformEnabled: false, hotlineCount: 0 })
    await expectState("needs_first_hotline")
    expect(screen.getByText("你还没有任何 Hotline 可调")).toBeTruthy()
    expect(screen.getByText("去 Catalog")).toBeTruthy()
  })

  it("does NOT render needs_first_hotline when platform is enabled (community catalog available)", async () => {
    installFetch({ requests: [], pendingApprovals: [] })
    renderCard({ callerRegistered: true, platformEnabled: true, hotlineCount: 0 })
    await expectState("all_normal")
  })

  it("renders needs_first_call when hotline_count > 0 and requests = 0", async () => {
    installFetch({ requests: [], pendingApprovals: [] })
    renderCard({ callerRegistered: true, platformEnabled: true, hotlineCount: 2 })
    await expectState("needs_first_call")
    expect(screen.getByText("试拨一次跑通端到端")).toBeTruthy()
    expect(screen.getByText("打开 Catalog")).toBeTruthy()
  })

  it("renders all_normal with today count and last activity when nothing else applies", async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    installFetch({
      requests: [
        { request_id: "r1", status: "SUCCEEDED", updated_at: recent },
        { request_id: "r2", status: "SUCCEEDED", updated_at: recent },
      ],
      pendingApprovals: [],
    })
    renderCard({ callerRegistered: true, platformEnabled: true, hotlineCount: 1 })
    await expectState("all_normal")
    expect(screen.getByText("一切正常 ✓")).toBeTruthy()
    expect(screen.getByText(/今日已完成调用 2/)).toBeTruthy()
  })

  it("respects priority order: pending approvals beat recent failures", async () => {
    installFetch({
      requests: [{ request_id: "r1", status: "FAILED", updated_at: new Date().toISOString() }],
      pendingApprovals: [{ status: "pending" }],
    })
    renderCard({ callerRegistered: true, platformEnabled: true, hotlineCount: 1 })
    await expectState("has_pending_approvals")
  })
})
