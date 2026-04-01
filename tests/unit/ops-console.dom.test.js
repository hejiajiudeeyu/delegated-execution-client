/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body, status = 200) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ops-console dom flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("renders requests and selected request detail through supervisor-only flow", async () => {
    document.body.innerHTML = `<div id="app"></div>`;
    let transportConfig = {
      type: "local",
      relay_http: { base_url: "http://127.0.0.1:8090" },
      email: {
        provider: "emailengine",
        sender: "",
        receiver: "",
        poll_interval_ms: 5000,
        emailengine: {
          base_url: "",
          account: "",
          access_token_configured: false
        },
        gmail: {
          client_id: "",
          user: "",
          client_secret_configured: false,
          refresh_token_configured: false
        }
      }
    };
    let localHotlines = [
      {
        hotline_id: "local.hotline.v2",
        display_name: "Local One",
        task_types: ["text_classify"],
        capabilities: ["text.classify"],
        tags: ["local"],
        adapter_type: "process",
        adapter: { cmd: "node worker.js" },
        metadata: {
          project: {
            path: "/tmp/local-one",
            description: "Summarizes a local repository for remote callers"
          }
        },
        enabled: true,
        review_status: "pending",
        submitted_for_review: true
      }
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init = {}) => {
        const url = typeof input === "string" ? new URL(input) : input;
        const pathname = url.pathname;
        const method = init.method || "GET";

        if (pathname === "/auth/session" && method === "GET") {
          return jsonResponse({
            session: {
              setup_required: false,
              authenticated: true,
              legacy_secret_source_present: false,
              legacy_secret_keys: [],
              expires_at: "2026-03-17T00:00:00.000Z"
            }
          });
        }
        if (pathname === "/status") {
          return jsonResponse({
            config: {
              caller: { api_key: null, api_key_configured: true, contact_email: "caller@test.local" },
              responder: {
                enabled: false,
                responder_id: "responder_local",
                hotlines: localHotlines
              }
            },
            responder: {
              enabled: false,
              pending_review_count: 0,
              review_summary: { pending: 1 }
            },
            requests: { total: 1, by_status: { SUCCEEDED: 1 }, latest: [] },
            runtime: {
              caller: { health: { status: 200, body: { ok: true } } },
              responder: { health: null },
              relay: { health: { status: 200, body: { ok: true } } }
            }
          });
        }
        if (pathname === "/runtime/logs" && method === "GET") {
          return jsonResponse({ service: "caller", logs: ["caller ready\n"] });
        }
        if (pathname === "/runtime/transport" && method === "GET") {
          return jsonResponse(transportConfig);
        }
        if (pathname === "/runtime/transport" && method === "PUT") {
          const body = JSON.parse(init.body || "{}");
          transportConfig = {
            ...transportConfig,
            type: body.type,
            relay_http: {
              base_url: body.relay_http?.base_url || ""
            },
            email: {
              provider: body.email?.provider || "emailengine",
              sender: body.email?.sender || "",
              receiver: body.email?.receiver || "",
              poll_interval_ms: body.email?.poll_interval_ms || 5000,
              emailengine: {
                base_url: body.email?.emailengine?.base_url || "",
                account: body.email?.emailengine?.account || "",
                access_token_configured: Boolean(body.email?.emailengine?.access_token)
              },
              gmail: {
                client_id: body.email?.gmail?.client_id || "",
                user: body.email?.gmail?.user || "",
                client_secret_configured: Boolean(body.email?.gmail?.client_secret),
                refresh_token_configured: Boolean(body.email?.gmail?.refresh_token)
              }
            }
          };
          return jsonResponse(transportConfig);
        }
        if (pathname === "/runtime/transport/test" && method === "POST") {
          return jsonResponse({
            ok: true,
            kind: transportConfig.type === "email" ? transportConfig.email.provider : transportConfig.type,
            detail: "test_ok"
          });
        }
        if (pathname === "/runtime/alerts" && method === "GET") {
          return jsonResponse({
            service: "caller",
            alerts: [
              {
                service: "caller",
                severity: "warning",
                source: "log",
                message: "warning: caller retry scheduled"
              }
            ]
          });
        }
        if (pathname === "/debug/snapshot" && method === "GET") {
          return jsonResponse({
            ok: true,
            generated_at: "2026-03-09T00:00:00.000Z",
            status: {
              responder: { enabled: false, review_summary: { pending: 1 } },
              requests: { total: 1, by_status: { SUCCEEDED: 1 } },
              debug: { logs_dir: "/tmp/ops/logs", event_log: "/tmp/ops/logs/supervisor.events.jsonl" }
            },
            recent_events: [{ type: "service_started", service: "caller" }]
          });
        }
        if (pathname === "/catalog/hotlines" && method === "GET") {
          return jsonResponse({
            items: [
              {
                hotline_id: "foxlab.text.classifier.v1",
                responder_id: "responder_foxlab",
                display_name: "Foxlab Text Classifier",
                task_types: ["text_classify"],
                capabilities: ["text.classify"],
                availability_status: "healthy"
              }
            ]
          });
        }
        if (pathname === "/calls/prepare" && method === "POST") {
          return jsonResponse({
            task_type: "text_classify",
            always_ask: true,
            remembered_preference: null,
            selection_reason: "task_type_match · healthy",
            selected_hotline: {
              hotline_id: "foxlab.text.classifier.v1",
              responder_id: "responder_foxlab",
              display_name: "Foxlab Text Classifier",
              responder_display_name: "Foxlab",
              capabilities: ["text.classify"],
              availability_status: "healthy",
              template_summary: {
                template_ref: "foxlab.text.classifier",
                output_properties: ["summary"]
              },
              match_reasons: ["task_type_match", "healthy"]
            },
            candidate_hotlines: [
              {
                hotline_id: "foxlab.text.classifier.v1",
                responder_id: "responder_foxlab",
                display_name: "Foxlab Text Classifier",
                responder_display_name: "Foxlab",
                capabilities: ["text.classify"],
                availability_status: "healthy",
                difference_note: "Matches the current task type.",
                template_summary: {
                  template_ref: "foxlab.text.classifier",
                  output_properties: ["summary"]
                }
              },
              {
                hotline_id: "atelier.text.classifier.v2",
                responder_id: "responder_atelier",
                display_name: "Atelier Text Router",
                responder_display_name: "Atelier",
                capabilities: ["text.classify", "routing.assist"],
                availability_status: "healthy",
                difference_note: "Available as a fallback responder route.",
                template_summary: {
                  template_ref: "atelier.text.router",
                  output_properties: ["summary"]
                }
              }
            ]
          });
        }
        if (pathname === "/calls/confirm" && method === "POST") {
          return jsonResponse({
            request_id: "req_confirm_1",
            request: {
              request_id: "req_confirm_1",
              responder_id: "responder_atelier",
              hotline_id: "atelier.text.classifier.v2",
              status: "SENT",
              updated_at: "2026-03-08T00:00:01Z"
            }
          }, 201);
        }
        if (pathname === "/responder/hotlines" && method === "POST") {
          const body = JSON.parse(init.body || "{}");
          const nextHotline = {
            hotline_id: body.hotline_id,
            display_name: body.display_name,
            task_types: body.task_types || [],
            capabilities: body.capabilities || [],
            tags: body.tags || [],
            adapter_type: body.adapter_type || "process",
            adapter: body.adapter || { cmd: "node worker.js" },
            enabled: true,
            review_status: "local_only",
            submitted_for_review: false
          };
          localHotlines = [
            ...localHotlines.filter((item) => item.hotline_id !== nextHotline.hotline_id),
            nextHotline
          ];
          return jsonResponse({
            ...nextHotline
          }, 201);
        }
        if (pathname === "/responder/hotlines/example" && method === "POST") {
          const nextHotline = {
            hotline_id: "local.delegated-execution.workspace-summary.v1",
            display_name: "Delegated Execution Workspace Summary",
            task_types: ["text_summarize"],
            capabilities: ["text.summarize"],
            tags: ["local", "example", "demo"],
            adapter_type: "process",
            adapter: { cmd: `${process.execPath} example-hotline-worker.js` },
            enabled: true,
            review_status: "local_only",
            submitted_for_review: false
          };
          localHotlines = [
            ...localHotlines.filter((item) => item.hotline_id !== nextHotline.hotline_id),
            nextHotline
          ];
          return jsonResponse({
            ...nextHotline,
            example: true
          }, 201);
        }
        if (pathname === "/responder/hotlines/local.hotline.v2/disable" && method === "POST") {
          localHotlines = localHotlines.map((item) =>
            item.hotline_id === "local.hotline.v2" ? { ...item, enabled: false } : item
          );
          return jsonResponse({
            ok: true,
            hotline_id: "local.hotline.v2",
            enabled: false,
            review_status: "pending",
            submitted_for_review: true
          });
        }
        if (pathname === "/responder/hotlines/local.hotline.v2" && method === "DELETE") {
          localHotlines = localHotlines.filter((item) => item.hotline_id !== "local.hotline.v2");
          return jsonResponse({
            ok: true,
            removed: {
              hotline_id: "local.hotline.v2"
            }
          });
        }
        if (pathname === "/responder/submit-review" && method === "POST") {
          return jsonResponse({ responder_id: "responder_local", submitted: 1, results: [{ review_status: "pending" }] }, 201);
        }
        if (pathname === "/requests" && method === "GET") {
          return jsonResponse({
            items: [
              {
                request_id: "req_ui_1",
                responder_id: "responder_foxlab",
                hotline_id: "foxlab.text.classifier.v1",
                status: "SUCCEEDED",
                updated_at: "2026-03-08T00:00:00Z"
              }
            ]
          });
        }
        if (pathname === "/requests/req_ui_1") {
          return jsonResponse({
            request_id: "req_ui_1",
            responder_id: "responder_foxlab",
            hotline_id: "foxlab.text.classifier.v1",
            status: "SUCCEEDED",
            updated_at: "2026-03-08T00:00:00Z"
          });
        }
        if (pathname === "/requests/req_ui_1/result") {
          return jsonResponse({
            available: true,
            result_package: {
              status: "ok",
              output: { summary: "dom flow ok" }
            }
          });
        }
        if (pathname === "/requests/req_confirm_1") {
          return jsonResponse({
            request_id: "req_confirm_1",
            responder_id: "responder_atelier",
            hotline_id: "atelier.text.classifier.v2",
            status: "SUCCEEDED",
            updated_at: "2026-03-08T00:00:03Z"
          });
        }
        if (pathname === "/requests/req_confirm_1/result") {
          return jsonResponse({
            available: true,
            result_package: {
              status: "ok",
              output: { summary: "confirmed call ok" }
            }
          });
        }
        if (pathname === "/requests/example" && method === "POST") {
          return jsonResponse({
            request_id: "req_example_1",
            request: {
              request_id: "req_example_1",
              responder_id: "responder_local",
              hotline_id: "local.delegated-execution.workspace-summary.v1",
              status: "SENT",
              updated_at: "2026-03-08T00:00:01Z"
            }
          }, 201);
        }
        if (pathname === "/requests/req_example_1") {
          return jsonResponse({
            request_id: "req_example_1",
            responder_id: "responder_local",
            hotline_id: "local.delegated-execution.workspace-summary.v1",
            status: "SUCCEEDED",
            updated_at: "2026-03-08T00:00:02Z"
          });
        }
        if (pathname === "/requests/req_example_1/result") {
          return jsonResponse({
            available: true,
            result_package: {
              status: "ok",
              output: { summary: "local demo ok" }
            }
          });
        }
        return jsonResponse({ items: [] });
      })
    );

    await import("../../apps/ops-console/src/main.js");
    await flush();

    expect(document.querySelector("#ops-url")).toBeNull();
    expect(document.querySelector("#requests-list")?.textContent).toContain("req_ui_1");
    expect(document.querySelector("#runtime-output")?.textContent).toContain("caller ready");
    expect(document.querySelector("#runtime-alerts")?.textContent).toContain("caller retry scheduled");
    expect(document.querySelector("#debug-output")?.textContent).toContain("/tmp/ops/logs");
    expect(document.querySelector("#request-summary")?.textContent).toContain("SUCCEEDED: 1");
    expect(document.querySelector("#transport-summary")?.textContent).toContain("type=local");
    expect(document.querySelector("#setup-wizard")?.textContent).toContain("Register Caller");
    expect(document.querySelector("#setup-wizard")?.textContent).toContain("Add Local Example");
    expect(document.querySelector("[data-wizard-action='register-caller']")?.textContent).toContain("Review");
    expect(document.querySelector("#setup-wizard")?.textContent).toContain("Submitted: 1");
    document.querySelector("#add-example-hotline")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#responder-hotlines")?.textContent).toContain("Delegated Execution Workspace Summary");
    expect(document.querySelector("#responder-hotlines")?.textContent).toContain("/tmp/local-one");
    expect(document.querySelector("#responder-hotlines")?.textContent).toContain("Summarizes a local repository for remote callers");
    document.querySelector("#transport-type").value = "email";
    document.querySelector("#transport-type")?.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#transport-email-provider").value = "gmail";
    document.querySelector("#transport-email-provider")?.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#transport-email-sender").value = "caller@example.com";
    document.querySelector("#transport-email-receiver").value = "responder@example.com";
    document.querySelector("#transport-gmail-client-id").value = "gmail-client-id";
    document.querySelector("#transport-gmail-user").value = "caller@example.com";
    document.querySelector("#transport-gmail-client-secret").value = "secret";
    document.querySelector("#transport-gmail-refresh-token").value = "refresh";
    document.querySelector("#save-transport")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#transport-summary")?.textContent).toContain("provider=gmail");
    expect(document.querySelector("#transport-summary")?.textContent).toContain("client_secret=configured");
    document.querySelector("#test-transport")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#transport-summary")?.textContent).toContain("test_ok");
    document
      .querySelector("[data-hotline-action='edit'][data-hotline-id='local.hotline.v2']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#hotline-id")?.value).toBe("local.hotline.v2");
    expect(document.querySelector("#add-hotline")?.textContent).toContain("Save");
    document.querySelector("#display-name").value = "Local One Updated";
    document.querySelector("#add-hotline")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#responder-hotlines")?.textContent).toContain("Local One Updated");
    document
      .querySelector("[data-hotline-action='disable'][data-hotline-id='local.hotline.v2']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#responder-output")?.textContent).toContain("\"enabled\": false");
    document
      .querySelector("[data-hotline-action='remove'][data-hotline-id='local.hotline.v2']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#responder-hotlines")?.textContent).not.toContain("local.hotline.v2");
    document.querySelector("[data-request-id='req_ui_1']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#request-detail")?.textContent).toContain("dom flow ok");
    expect(document.querySelector("#request-detail")?.textContent).toContain("Result Summary");
    document.querySelector("#prepare-call")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#call-confirmation")?.textContent).toContain("Foxlab Text Classifier");
    expect(document.querySelector("#call-confirmation")?.textContent).toContain("Atelier Text Router");
    document.querySelector("[data-candidate-hotline-id='atelier.text.classifier.v2']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.querySelector("#remember-task-type").checked = true;
    document.querySelector("#confirm-call")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    document.querySelector("#poll-result")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#request-detail")?.textContent).toContain("confirmed call ok");
    document.querySelector("#run-example-request")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    document.querySelector("#poll-result")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector("#request-detail")?.textContent).toContain("local demo ok");
  });
});
