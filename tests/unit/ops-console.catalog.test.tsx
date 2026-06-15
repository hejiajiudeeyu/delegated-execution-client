/** @vitest-environment happy-dom */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    availability_status: "healthy",
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

function localWorkspaceDoctor(overrides: Record<string, unknown> = {}) {
  return hotline({
    hotline_id: "local.delegated-execution.workspace-summary.v1",
    display_name: "Local Workspace Doctor",
    responder_id: "responder_local",
    description: "Read-only local delegated-execution environment diagnostic.",
    review_status: "local_only",
    task_types: ["workspace_diagnose"],
    tags: ["local", "example", "diagnostic"],
    ...overrides,
  });
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

  it("does not list offline platform templates as available hotlines", async () => {
    const offlineTemplate = hotline({
      hotline_id: "starlight.creative.studio.v1",
      display_name: "Starlight AI 创意工坊",
      responder_id: "responder_starlight",
      tags: ["creative", "image"],
      availability_status: "offline",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/auth/session") return jsonResponse({ recoverable_session: { token: "tok" } });
        if (url.startsWith("/catalog/hotlines")) return jsonResponse({ items: [offlineTemplate] });
        return jsonResponse({}, 404);
      }),
    );

    renderPage({ initialEntries: ["/caller/catalog?from=dashboard-nextup"] });

    await waitFor(() => {
      expect(screen.queryByText("没有可用的真实热线")).toBeTruthy();
    });
    expect(screen.queryByText("Starlight AI 创意工坊")).toBeNull();
  });

  it("keeps the local official example visible even when returned with stale platform metadata", async () => {
    const staleLocal = localWorkspaceDoctor({
      display_name: "Delegated Execution Workspace Summary",
      description: "old summary example",
      task_types: ["text_summarize"],
      tags: ["local", "example", "demo"],
      availability_status: "healthy",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/auth/session") return jsonResponse({ recoverable_session: { token: "tok" } });
        if (url.startsWith("/catalog/hotlines/")) return jsonResponse(staleLocal);
        if (url.startsWith("/catalog/hotlines")) return jsonResponse({ items: [staleLocal] });
        return jsonResponse({}, 404);
      }),
    );

    renderPage({ initialEntries: ["/caller/catalog?from=dashboard-nextup"] });

    await waitFor(() => {
      expect(screen.queryAllByText("Local Workspace Doctor").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("workspace_diagnose")).toBeTruthy();
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

  it("prioritizes the local official example when arriving from dashboard next-up", async () => {
    const remoteShowcase = hotline({
      hotline_id: "starlight.creative.studio.v1",
      display_name: "Starlight AI 创意工坊",
      responder_id: "responder_starlight",
      review_status: "approved",
      tags: ["platform", "showcase"],
    });
    const localExample = localWorkspaceDoctor({ availability_status: "healthy" });
    const detailRequests: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/auth/session") return jsonResponse({ recoverable_session: { token: "tok" } });
        if (url.startsWith("/catalog/hotlines/")) {
          detailRequests.push(url);
          if (url.includes(localExample.hotline_id)) return jsonResponse(localExample);
          return jsonResponse(remoteShowcase);
        }
        if (url.startsWith("/catalog/hotlines")) return jsonResponse({ items: [remoteShowcase, localExample] });
        return jsonResponse({}, 404);
      }),
    );

    renderPage({ initialEntries: ["/caller/catalog?from=dashboard-nextup"] });

    await waitFor(() => {
      expect(detailRequests[0]).toBe(`/catalog/hotlines/${encodeURIComponent(localExample.hotline_id)}`);
    });
    expect(screen.queryByText(/试拨本机诊断示例/)).toBeTruthy();
    expect(screen.queryAllByText("Local Workspace Doctor").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("workspace_diagnose")).toBeTruthy();
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

  it("submits logical service calls from the catalog drawer by default", async () => {
    const item = hotline({
      service_id: "mineru.document.parse.v1",
      capabilities: ["document.parse.pdf"],
      task_types: ["document_parse"],
      input_schema: {
        required: ["text"],
        properties: {
          text: {
            type: "string",
            description: "PDF text or URL",
          },
        },
      },
    });
    let confirmBody: Record<string, unknown> | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/auth/session") return jsonResponse({ recoverable_session: { token: "tok" } });
        if (url.startsWith("/catalog/hotlines/")) return jsonResponse(item);
        if (url.startsWith("/catalog/hotlines")) return jsonResponse({ items: [item] });
        if (url === "/calls/confirm" && init?.method === "POST") {
          confirmBody = JSON.parse(String(init.body));
          return jsonResponse({ request_id: "req_service_console_1" }, 201);
        }
        return jsonResponse({}, 404);
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.queryByText(/试拨当前 Hotline/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/试拨当前 Hotline/).closest("button")!);
    await waitFor(() => {
      expect(screen.queryByText(/试拨 · Foxlab Text Classifier/)).toBeTruthy();
    });
    expect(screen.queryByText("池模式")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("PDF text or URL"), { target: { value: "Parse this PDF" } });
    fireEvent.click(screen.getByText("发送调用").closest("button")!);

    await waitFor(() => {
      expect(confirmBody).toMatchObject({
        service_id: "mineru.document.parse.v1",
        capability: "document.parse.pdf",
        task_type: "document_parse",
        input: { text: "Parse this PDF" },
      });
    });
    expect(confirmBody?.responder_id).toBeUndefined();
    expect(confirmBody?.hotline_id).toBeUndefined();
    expect(toastCalls.some((call) => call.level === "success")).toBe(true);
  });
});
