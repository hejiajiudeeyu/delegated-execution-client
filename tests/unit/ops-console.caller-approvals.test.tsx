/** @vitest-environment happy-dom */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { CallerApprovalsPage } from "../../apps/ops-console/src/pages/caller/CallerApprovalsPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <CallerApprovalsPage />
    </MemoryRouter>
  );
}

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

function pendingItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "appr_pending_1",
    hotlineId: "foxlab.text.classifier.v1",
    purpose: "Summarize meeting notes",
    agentSessionId: "sess_abc",
    inputSummary: "10 KB transcript",
    hotlineInfo: {
      displayName: "Foxlab Text Classifier",
      responderId: "responder_foxlab",
      description: null,
      reviewStatus: "approved",
      outputDisplayHints: null
    },
    riskFactors: [
      {
        factor: "first_call_from_agent",
        description: "首次来自该 Agent 的调用",
        severity: "medium" as const
      }
    ],
    overallRisk: "medium" as const,
    status: "pending" as const,
    createdAt: new Date(Date.now() - 30_000).toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    decidedAt: null,
    execution: null,
    ...overrides
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CallerApprovalsPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    toastCalls.length = 0;
    // M6/M7 persistence keys leak across tests if left untouched
    try {
      window.sessionStorage.clear();
      window.localStorage.clear();
    } catch {
      // happy-dom edge cases — not test-critical
    }
  });

  it("renders pending approvals with risk + expiry context and triggers approve", async () => {
    const item = pendingItem();
    let approveCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init.method || "GET").toUpperCase();
        if (url === "/auth/session") {
          return jsonResponse({ recoverable_session: { token: "tok" } });
        }
        if (url.startsWith("/caller/approvals?status=pending") && method === "GET") {
          return jsonResponse({ items: [item] });
        }
        if (url === `/caller/approvals/${item.id}/approve` && method === "POST") {
          approveCalls += 1;
          return jsonResponse({ ok: true });
        }
        return jsonResponse({}, 404);
      })
    );

    renderPage();

    await waitFor(() => {
      expect(screen.queryByText("Foxlab Text Classifier")).toBeTruthy();
    });

    expect(screen.queryByText("中风险")).toBeTruthy();
    expect(screen.getAllByText("待审批").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("首次来自该 Agent 的调用")).toBeTruthy();
    expect(screen.queryByText(/min 后过期|s 后过期/)).toBeTruthy();

    const approveButton = screen.getByText("批准").closest("button")!;
    await act(async () => {
      fireEvent.click(approveButton);
      await flush();
    });

    expect(approveCalls).toBe(1);
    expect(
      toastCalls.find((c) => c.message === "已批准，Agent 可继续执行")
    ).toBeTruthy();
  });

  it("filters by status and shows the empty state for non-pending tabs", async () => {
    const item = pendingItem();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/auth/session") return jsonResponse({ recoverable_session: { token: "tok" } });
      if (url === "/caller/approvals?status=pending") return jsonResponse({ items: [item] });
      if (url === "/caller/approvals?status=approved") return jsonResponse({ items: [] });
      if (url === "/caller/approvals") return jsonResponse({ items: [item] });
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchSpy);

    renderPage();
    await waitFor(() => expect(screen.queryByText("Foxlab Text Classifier")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText("已批准"));
      await flush();
    });

    await waitFor(() => {
      expect(screen.queryByText("暂无记录")).toBeTruthy();
    });

    expect(
      fetchSpy.mock.calls.some(
        (call) => String(call[0]).includes("/caller/approvals?status=approved")
      )
    ).toBe(true);
  });

  it("adds the hotline to the global whitelist via the inline button", async () => {
    const item = pendingItem();
    let putBody: { hotlineWhitelist?: string[] } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init.method || "GET").toUpperCase();
        if (url === "/auth/session") return jsonResponse({ recoverable_session: { token: "tok" } });
        if (url.startsWith("/caller/approvals")) return jsonResponse({ items: [item] });
        if (url === "/caller/global-policy" && method === "GET") {
          return jsonResponse({
            mode: "allow_listed",
            responderWhitelist: [],
            hotlineWhitelist: [],
            blocklist: []
          });
        }
        if (url === "/caller/global-policy" && method === "PUT") {
          putBody = JSON.parse(String(init.body));
          return jsonResponse({
            mode: "allow_listed",
            responderWhitelist: [],
            hotlineWhitelist: putBody?.hotlineWhitelist ?? [],
            blocklist: []
          });
        }
        return jsonResponse({}, 404);
      })
    );

    renderPage();
    await waitFor(() => expect(screen.queryByText("Foxlab Text Classifier")).toBeTruthy());

    const allowButton = screen.getByText("加入白名单").closest("button")!;
    await act(async () => {
      fireEvent.click(allowButton);
      await flush();
    });

    expect(putBody?.hotlineWhitelist).toEqual([item.hotlineId]);
    expect(
      toastCalls.find((c) => c.message === "已加入 Hotline 白名单，后续可自动放行")
    ).toBeTruthy();
  });
});
