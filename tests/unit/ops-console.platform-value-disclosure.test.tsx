/** @vitest-environment happy-dom */

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { PlatformValueDisclosure } from "../../apps/ops-console/src/components/dashboard/PlatformValueDisclosure"

const SESSION_DISMISS_KEY = "dashboard.platform-value-table.dismissed"

function renderCard(onEnable = vi.fn(), toggling = false) {
  return render(
    <MemoryRouter>
      <PlatformValueDisclosure
        onEnable={onEnable}
        toggling={toggling}
        platformUrl="http://127.0.0.1:8080"
      />
    </MemoryRouter>
  )
}

describe("PlatformValueDisclosure", () => {
  afterEach(() => {
    cleanup()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it("renders the trigger and stays collapsed by default", () => {
    renderCard()
    expect(screen.getByText("了解平台模式可以多做什么")).toBeTruthy()
    expect(screen.queryByText(/Catalog 来源/)).toBeNull()
  })

  it("expands the value table when the trigger is clicked", () => {
    renderCard()
    fireEvent.click(screen.getByText("了解平台模式可以多做什么"))
    expect(screen.getByText(/Catalog 来源/)).toBeTruthy()
    expect(screen.getByText(/Hotline 可见性/)).toBeTruthy()
    expect(screen.getByText(/隐私边界/)).toBeTruthy()
    expect(screen.getByText(/需要的网络/)).toBeTruthy()
    expect(screen.getByText(/适合/)).toBeTruthy()
  })

  it("invokes onEnable when the user clicks 开启平台模式", () => {
    const onEnable = vi.fn()
    renderCard(onEnable)
    fireEvent.click(screen.getByText("了解平台模式可以多做什么"))
    fireEvent.click(screen.getByText("开启平台模式"))
    expect(onEnable).toHaveBeenCalledTimes(1)
  })

  it("dismisses for the session and persists via sessionStorage", () => {
    const { container, unmount } = renderCard()
    expect(container.querySelector('[aria-label="本会话不再显示"]')).toBeTruthy()
    fireEvent.click(container.querySelector('[aria-label="本会话不再显示"]') as HTMLElement)
    expect(sessionStorage.getItem(SESSION_DISMISS_KEY)).toBe("1")
    expect(screen.queryByText("了解平台模式可以多做什么")).toBeNull()
    unmount()

    renderCard()
    expect(screen.queryByText("了解平台模式可以多做什么")).toBeNull()
  })

  it("disables 开启平台模式 button while toggling", () => {
    renderCard(vi.fn(), true)
    fireEvent.click(screen.getByText("了解平台模式可以多做什么"))
    const button = screen.getByText("切换中…").closest("button") as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
