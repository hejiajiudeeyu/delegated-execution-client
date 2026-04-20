/** @vitest-environment happy-dom */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AccessListsPage } from "../../apps/ops-console/src/pages/caller/AccessListsPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <AccessListsPage />
    </MemoryRouter>
  );
}

interface PolicyShape {
  mode: "manual" | "allow_listed" | "allow_all";
  responderWhitelist: string[];
  hotlineWhitelist: string[];
  blocklist: string[];
}

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
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

function installFetch(initialPolicy: PolicyShape) {
  let policy: PolicyShape = { ...initialPolicy };
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url === "/auth/session" && method === "GET") {
      return jsonResponse({ recoverable_session: { token: "tok-test" } });
    }
    if (url === "/caller/global-policy" && method === "GET") {
      return jsonResponse(policy);
    }
    if (url === "/caller/global-policy" && method === "PUT") {
      policy = { ...policy, ...(body as Partial<PolicyShape>) };
      return jsonResponse(policy);
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, getPolicy: () => policy };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AccessListsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    toastCalls.length = 0;
  });

  it("loads policy and renders the manual-mode banner with empty list panel", async () => {
    installFetch({
      mode: "manual",
      responderWhitelist: [],
      hotlineWhitelist: [],
      blocklist: []
    });

    renderPage();

    await waitFor(() => {
      expect(screen.queryByText("名单管理")).toBeTruthy();
    });

    expect(screen.queryByText(/审批模式：全部手动审批/)).toBeTruthy();
    expect(screen.queryByText(/下方白名单已保存但当前不会自动放行/)).toBeTruthy();
    expect(screen.queryByText("暂无 Responder 白名单")).toBeTruthy();
  });

  it("adds an entry to the responder whitelist via the input + button", async () => {
    const { calls, getPolicy } = installFetch({
      mode: "allow_listed",
      responderWhitelist: [],
      hotlineWhitelist: [],
      blocklist: []
    });

    renderPage();
    await waitFor(() => expect(screen.queryByText("名单管理")).toBeTruthy());

    expect(screen.queryByText(/审批模式：白名单自动放行/)).toBeTruthy();
    expect(screen.queryByText(/全部手动审批/)).toBeFalsy();

    const input = screen.getByPlaceholderText(/responder_id/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "my-bot.v1" } });

    const addButton = screen.getAllByText("加入名单")[0].closest("button")!;
    await act(async () => {
      fireEvent.click(addButton);
      await flush();
    });

    await waitFor(() => {
      expect(screen.queryByText("my-bot.v1")).toBeTruthy();
    });
    expect(getPolicy().responderWhitelist).toContain("my-bot.v1");
    expect(toastCalls.find((c) => c.message === "名单已更新")).toBeTruthy();

    const putCall = calls.find((c) => c.method === "PUT" && c.url === "/caller/global-policy");
    expect(putCall).toBeTruthy();
    expect((putCall!.body as PolicyShape).responderWhitelist).toEqual(["my-bot.v1"]);

    const inputAfter = screen.getByPlaceholderText(/responder_id/) as HTMLInputElement;
    expect(inputAfter.value).toBe("");
  });

  it("rejects duplicates with an info toast and does not call PUT again", async () => {
    const { calls } = installFetch({
      mode: "allow_listed",
      responderWhitelist: ["existing.bot"],
      hotlineWhitelist: [],
      blocklist: []
    });

    renderPage();
    await waitFor(() => expect(screen.queryByText("existing.bot")).toBeTruthy());

    const input = screen.getByPlaceholderText(/responder_id/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "existing.bot" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await flush();
    });

    expect(toastCalls.find((c) => c.level === "info")).toBeTruthy();
    expect(calls.filter((c) => c.method === "PUT").length).toBe(0);
  });

  it("removes an entry through the trash button and surfaces an error toast on PUT failure", async () => {
    let policy: PolicyShape = {
      mode: "allow_listed",
      responderWhitelist: ["bot-a"],
      hotlineWhitelist: [],
      blocklist: []
    };
    let putCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init.method || "GET").toUpperCase();
        if (url === "/auth/session") {
          return jsonResponse({ recoverable_session: { token: "tok" } });
        }
        if (url === "/caller/global-policy" && method === "GET") {
          return jsonResponse(policy);
        }
        if (url === "/caller/global-policy" && method === "PUT") {
          putCount += 1;
          if (putCount === 1) {
            return jsonResponse({ error: "boom" }, 500);
          }
          policy = { ...policy, ...(JSON.parse(String(init.body)) as Partial<PolicyShape>) };
          return jsonResponse(policy);
        }
        return jsonResponse({}, 404);
      })
    );

    renderPage();
    await waitFor(() => expect(screen.queryByText("bot-a")).toBeTruthy());

    const removeButton = screen.getByText("移除").closest("button")!;
    await act(async () => {
      fireEvent.click(removeButton);
      await flush();
    });

    expect(toastCalls.find((c) => c.level === "error")).toBeTruthy();
    expect(screen.queryByText("bot-a")).toBeTruthy(); // server failed, item still there

    await act(async () => {
      fireEvent.click(removeButton);
      await flush();
    });

    await waitFor(() => {
      expect(screen.queryByText("bot-a")).toBeFalsy();
    });
    expect(policy.responderWhitelist).toEqual([]);
  });
});
