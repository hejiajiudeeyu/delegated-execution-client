/** @vitest-environment happy-dom */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ErrorBoundary } from "../../apps/ops-console/src/components/ErrorBoundary";

describe("ops-console ErrorBoundary", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders children when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <span data-testid="ok">child rendered</span>
      </ErrorBoundary>
    );

    expect(screen.getByTestId("ok").textContent).toBe("child rendered");
  });

  it("captures render errors and shows the fallback UI with stack info", () => {
    // Suppress React's intentional console.error for the thrown render error
    // so the test output stays clean while still asserting on our own log line.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Boom(): React.ReactElement {
      throw new Error("boom-from-render");
    }

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText("页面渲染失败")).toBeTruthy();
    expect(screen.getByText("刷新页面")).toBeTruthy();

    const stackBlock = document.querySelector("pre");
    expect(stackBlock?.textContent ?? "").toContain("boom-from-render");

    const opsLog = errorSpy.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("[ops-console] render error")
    );
    expect(opsLog).toBeTruthy();
  });

  it("reload button is wired to window.location.reload", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    function Boom(): React.ReactElement {
      throw new Error("boom-reload");
    }

    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload }
    });

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    const button = screen.getByText("刷新页面").closest("button");
    expect(button).toBeTruthy();
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
