/** @vitest-environment happy-dom */

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { ResponderHotlinesPage } from "../../apps/ops-console/src/pages/responder/ResponderHotlinesPage"

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    async text() {
      return JSON.stringify(body)
    },
  } as unknown as Response
}

function renderPage(initialEntry = "/responder/hotlines") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ResponderHotlinesPage />
    </MemoryRouter>
  )
}

describe("ResponderHotlinesPage", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it("adds the built-in example when opened with ?action=add-example", async () => {
    let exampleAdded = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === "/responder/hotlines/example" && init?.method === "POST") {
        exampleAdded = true
        return jsonResponse({ ok: true })
      }
      if (url === "/responder/hotlines") {
        return jsonResponse({
          platform_enabled: false,
          items: exampleAdded
            ? [
                {
                  hotline_id: "local.example.summary.v1",
                  display_name: "Local Example Summary",
                  enabled: true,
                  review_status: "local_only",
                  runtime_loaded: true,
                  task_types: ["summarize"],
                },
              ]
            : [],
        })
      }
      return jsonResponse({}, 404)
    })
    vi.stubGlobal("fetch", fetchMock)

    renderPage("/responder/hotlines?action=add-example")

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/responder/hotlines/example",
        expect.objectContaining({ method: "POST" })
      )
    })
    await waitFor(() => {
      expect(screen.getByText("Local Example Summary")).toBeTruthy()
    })
  })

  it("keeps the post-add list when the initial load resolves last", async () => {
    let resolveInitialLoad: ((value: Response) => void) | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === "/responder/hotlines/example" && init?.method === "POST") {
        return jsonResponse({ ok: true })
      }
      if (url === "/responder/hotlines" && fetchMock.mock.calls.filter(([calledUrl]) => calledUrl === "/responder/hotlines").length === 1) {
        return new Promise<Response>((resolve) => {
          resolveInitialLoad = resolve
        })
      }
      if (url === "/responder/hotlines") {
        return jsonResponse({
          platform_enabled: false,
          items: [
            {
              hotline_id: "local.example.summary.v1",
              display_name: "Local Example Summary",
              enabled: true,
              review_status: "local_only",
              runtime_loaded: true,
              task_types: ["summarize"],
            },
          ],
        })
      }
      return jsonResponse({}, 404)
    })
    vi.stubGlobal("fetch", fetchMock)

    renderPage("/responder/hotlines?action=add-example")

    await waitFor(() => {
      expect(screen.getByText("Local Example Summary")).toBeTruthy()
    })

    resolveInitialLoad?.(jsonResponse({ platform_enabled: false, items: [] }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText("Local Example Summary")).toBeTruthy()
  })

  it("submits service_id when adding a hotline", async () => {
    let createdBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === "/responder/hotlines" && init?.method === "POST") {
        createdBody = JSON.parse(String(init.body))
        return jsonResponse({ ok: true, ...createdBody }, 201)
      }
      if (url === "/responder/hotlines") {
        return jsonResponse({ platform_enabled: false, items: [] })
      }
      return jsonResponse({}, 404)
    })
    vi.stubGlobal("fetch", fetchMock)

    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "添加" }))
    fireEvent.change(screen.getByPlaceholderText("my-org.my-skill.v1"), { target: { value: "mineru.machine-a.parse.v1" } })
    fireEvent.change(screen.getByPlaceholderText("mineru.document.parse.v1"), { target: { value: "mineru.document.parse.v1" } })
    fireEvent.change(screen.getByPlaceholderText("node ./worker.js"), { target: { value: "node worker.js" } })
    fireEvent.change(screen.getByPlaceholderText("text_summarize, code_review"), { target: { value: "document_parse" } })
    fireEvent.change(screen.getByPlaceholderText("text.summarize, code.review"), { target: { value: "document.parse.pdf" } })
    fireEvent.click(screen.getByRole("button", { name: "添加" }))

    await waitFor(() => {
      expect(createdBody).toMatchObject({
        hotline_id: "mineru.machine-a.parse.v1",
        service_id: "mineru.document.parse.v1",
        task_types: ["document_parse"],
        capabilities: ["document.parse.pdf"]
      })
    })
  })
})
