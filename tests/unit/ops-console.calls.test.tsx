/** @vitest-environment happy-dom */

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { CallsPage } from "../../apps/ops-console/src/pages/caller/CallsPage"

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    async text() {
      return JSON.stringify(body)
    },
  } as unknown as Response
}

function renderPage(initialEntry = "/caller/calls") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CallsPage />
    </MemoryRouter>
  )
}

describe("CallsPage", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it("opens the requested call detail from ?selected=", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString()
        if (url === "/requests") {
          return jsonResponse({
            items: [
              {
                request_id: "req-alpha",
                hotline_id: "local.example.alpha.v1",
                status: "SUCCEEDED",
                input: { text: "Alpha request" },
              },
              {
                request_id: "req-deep-link",
                hotline_id: "local.example.summary.v1",
                status: "FAILED",
                input: { text: "Deep link request body" },
              },
            ],
          })
        }
        if (url === "/caller/approvals") return jsonResponse({ items: [] })
        if (url === "/requests/req-deep-link") {
          return jsonResponse({
            request_id: "req-deep-link",
            hotline_id: "local.example.summary.v1",
            responder_id: "responder_local",
            status: "FAILED",
            created_at: "2026-06-11T00:00:00.000Z",
            input: { text: "Deep link request body" },
          })
        }
        if (url === "/requests/req-deep-link/result") {
          return jsonResponse({
            available: true,
            result_package: {
              status: "error",
              error: { code: "LOCAL_FAIL", message: "Responder failed locally", retryable: true },
            },
          })
        }
        return jsonResponse({}, 404)
      })
    )

    renderPage("/caller/calls?selected=req-deep-link")

    await waitFor(() => {
      expect(screen.getByText("通话详情")).toBeTruthy()
    })
    expect(screen.getAllByText(/Deep link request body/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Responder failed locally").length).toBeGreaterThanOrEqual(1)
  })
})
