/** @vitest-environment happy-dom */

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { SetupPage } from "../../apps/ops-console/src/pages/auth/AuthPages"

const setupMock = vi.fn()
const refreshMock = vi.fn()

vi.mock("../../apps/ops-console/src/hooks/useAuth", () => ({
  useAuth: () => ({
    setup: setupMock,
    refresh: refreshMock,
  }),
}))

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    setup: setupMock,
    refresh: refreshMock,
  }),
}))

describe("SetupPage local-first copy", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("describes Caller registration as local-only instead of platform API key setup", async () => {
    setupMock.mockResolvedValue({ ok: true })
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    )

    fireEvent.change(screen.getByLabelText("口令"), { target: { value: "local-pass" } })
    fireEvent.change(screen.getByLabelText("确认口令"), { target: { value: "local-pass" } })
    fireEvent.click(screen.getByRole("button", { name: /下一步/ }))

    await waitFor(() => {
      expect(setupMock).toHaveBeenCalledWith("local-pass")
    })

    await waitFor(() => {
      expect(screen.getByText(/在本机注册 Caller 身份/)).toBeTruthy()
    })
    expect(screen.queryByText(/向平台注册/)).toBeNull()
    expect(screen.queryByText(/API Key/)).toBeNull()
  })
})
