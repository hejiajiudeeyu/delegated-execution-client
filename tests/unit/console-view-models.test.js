import { describe, expect, it } from "vitest";

import {
  renderCallerSummaryCard,
  renderCatalogItemsMarkup,
  renderRequestDetailMarkup,
  renderRequestsMarkup,
  renderRuntimeCardsMarkup,
  renderSetupWizardMarkup,
  renderResponderHotlinesMarkup
} from "../../apps/ops-console/src/view-model.js";

describe("console view models", () => {
  it("renders ops request detail summary", () => {
    const markup = renderRequestDetailMarkup({
      request: {
        request_id: "req_1",
        responder_id: "responder_1",
        hotline_id: "hotline_1",
        status: "SUCCEEDED",
        updated_at: "2026-03-08T00:00:00Z"
      },
      result: {
        available: true,
        result_package: {
          status: "ok",
          output: { summary: "classification complete" }
        }
      }
    });
    expect(markup).toContain("req_1");
    expect(markup).toContain("classification complete");
    expect(markup).toContain("SUCCEEDED");
    expect(markup).toContain("Result Payload");
    expect(markup).toContain("Timeline");
    expect(markup).toContain("Result Summary");
    expect(renderSetupWizardMarkup({ config: { caller: { api_key: "sk" }, responder: { enabled: false, hotlines: [] } }, runtime: { supervisor: { port: 1 } } })).toContain("Register Caller");
    expect(renderSetupWizardMarkup({ config: { caller: {}, responder: { enabled: false, hotlines: [] } }, runtime: { supervisor: { port: 1 } } })).toContain("Blocked:");
  });

  it("renders ops collections", () => {
    expect(renderCallerSummaryCard({ health: { body: { ok: true } }, root: { body: { service: "caller-controller" } } })).toContain(
      "caller-controller"
    );
    expect(
      renderCatalogItemsMarkup([{ hotline_id: "s1", responder_id: "responder", capabilities: ["text.classify"] }])
    ).toContain("text.classify");
    expect(renderRequestsMarkup([{ request_id: "req_2", status: "SENT" }])).toContain("req_2");
    const responderMarkup = renderResponderHotlinesMarkup([{ hotline_id: "local.s1", adapter_type: "process", review_status: "pending" }]);
    expect(responderMarkup).toContain("pending");
    expect(responderMarkup).toContain("Disable");
    expect(responderMarkup).toContain("Remove");
    expect(
      renderRuntimeCardsMarkup({
        caller: { running: true, pid: 100, health: { body: { ok: true } } },
        responder: { running: false, pid: null, health: null },
        relay: { running: true, pid: 101, health: { body: { ok: false } } }
      })
    ).toContain("caller");
  });
});
