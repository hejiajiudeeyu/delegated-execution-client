/** @vitest-environment happy-dom */

import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { HelpPage } from "../../apps/ops-console/src/pages/help/HelpPage"

class IntersectionObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

function renderHelp() {
  return render(
    <MemoryRouter initialEntries={["/help#deployability"]}>
      <HelpPage />
    </MemoryRouter>
  )
}

describe("HelpPage deployability chapter", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("explains deployment profiles and management commands", () => {
    renderHelp()

    expect(screen.getAllByText("部署与管理").length).toBeGreaterThan(0)
    expect(screen.getByText("platform")).toBeTruthy()
    expect(screen.getByText("public-stack")).toBeTruthy()
    expect(screen.getByText("all-in-one")).toBeTruthy()
    expect(screen.getAllByText("selfhost:init").length).toBeGreaterThan(0)
    expect(screen.getAllByText("selfhost:preflight").length).toBeGreaterThan(0)
    expect(screen.getAllByText("selfhost:smoke").length).toBeGreaterThan(0)
    expect(screen.getByText(/不会输出 secret 值/)).toBeTruthy()
  })
})
