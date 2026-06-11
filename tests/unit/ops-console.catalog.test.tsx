/** @vitest-environment happy-dom */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { CatalogPage } from "../../apps/ops-console/src/pages/caller/CatalogPage";

interface ToastCall {
  level: "success" | "error" | "info";
  message: string;
}
const toastCalls: ToastCall[] = [];
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => toastCalls.push({ level: "success", message }),
    error: (message: string) => toastCalls.push({ level: "error", message }),
    info: (message: string) => toastCalls.push({ level: "info", message })
  }
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    }
  } as unknown as Response;
}

interface RenderOpts {
  initialEntries?: string[];
}

function renderPage({ initialEntries = ["/caller/catalog"] }: RenderOpts = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <CatalogPage />
    </MemoryRouter>
  );
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function hotline(overrides: Record<string, unknown> = {}) {
  return {
    hotline_id: "foxlab.text.classifier.v1",
    display_name: "Foxlab Text Classifier",
    responder_id: "responder_foxlab",
    description: "Lightweight text classifier for the OPC examples.",
    review_status: "approved",
    task_types: ["classify"],
    tags: ["text"],
    input_schema: {
      required: ["text"],
      properties: {
        text: {
          type: "string",
          description: "Body of text to classify",
        },
      },
    },
    output_schema: {
      properties: {
        category: { type: "string" },
      },
    },
    ...overrides,
  };
}

function watchConsoleWarnings() {
  const messages: string[] = [];
  const capture = (...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(" "));
  };
  const errorSpy = vi.spyOn(console, "error").mockImplementation(capture);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(capture);
  return {
    expectClean() {
      const unexpected = messages.filter((message) =>
        /validateDOMNesting|Function components cannot be given refs|Missing `Description`|aria-describedby/.test(message)
      );
      expect(unexpected).toEqual([]);
    },
    restore() {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
}

describe("CatalogPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    toastCalls.length = 0;
    try {
      window.sessionStorage.clear();
      window.localStorage.clear();
    } catch {
      // happy-dom edge case — not test-critical
    }
  });

  it("renders a local-first zero-hotlines empty state when the catalog is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/auth/session") return jsonResponse({ recoverable_session: { token: "tok" } });
        if (url.startsWith("/catalog/hotlines")) return jsonResponse({ items: [] });
        return jsonResponse({}, 404);
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.queryByText("你的 Catalog 是空的")).toBeTruthy();
    });
    expect(screen.queryByText(/先添加一个本地 Hotline/)).toBeTruthy();
    expect(screen.queryByText(/添加本地示例/)).toBeTruthy();
    expect(screen.queryByText(/自己添加 Hotline/)).toBeTruthy();
    expect(screen.queryByText(/启用平台模式/)).toBeNull();
  });

  it("auto-selects the first hotline and loads its detail", async () => {
    const consoleWatch = watchConsoleWarnings();
    const item = hotline();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/auth/session") return jsonResponse({ recoverable_session: { token: "tok" } });
        if (url.startsWith("/catalog/hotlines/")) return jsonResponse(item);
        if (url.startsWith("/catalog/hotlines")) return jsonResponse({ items: [item] });
        return jsonResponse({}, 404);
      }),
    );

    renderPage();

    await waitFor(() => {
      // Display name appears at least once (in list); detail panel adds a second occurrence
      expect(screen.queryAllByText("Foxlab Text Classifier").length).toBeGreaterThanOrEqual(1);
    });
    // Title bar's "试拨当前 Hotline" button must be enabled now that a hotline is active
    const tryNowBtn = screen.getByText(/试拨当前 Hotline/).closest("button")!;
    await waitFor(() => {
      expect(tryNowBtn.hasAttribute("disabled")).toBe(false);
    });
    consoleWatch.expectClean();
    consoleWatch.restore();
  });

  it("auto-opens the Try-Call drawer when arriving with ?hotline_id=", async () => {
    const consoleWatch = watchConsoleWarnings();
    const item = hotline();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/auth/session") return jsonResponse({ recoverable_session: { token: "tok" } });
        if (url.startsWith("/catalog/hotlines/")) return jsonResponse(item);
        if (url.startsWith("/catalog/hotlines")) return jsonResponse({ items: [item] });
        return jsonResponse({}, 404);
      }),
    );

    renderPage({ initialEntries: ["/caller/catalog?hotline_id=foxlab.text.classifier.v1"] });

    // Drawer title only shows once the drawer opens (Sheet portal renders into the document body)
    await waitFor(() => {
      expect(screen.queryByText(/试拨 · Foxlab Text Classifier/)).toBeTruthy();
    });
    // The drawer's submit button is the unique "发送调用" label
    expect(screen.queryByText("发送调用")).toBeTruthy();
    consoleWatch.expectClean();
    consoleWatch.restore();
  });
});
