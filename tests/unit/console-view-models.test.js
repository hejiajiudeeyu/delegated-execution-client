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
import {
  renderAdminRequestCardsMarkup,
  renderAuditCardsMarkup,
  renderDetailSummary,
  renderEntityCardsMarkup,
  renderHistorySummary,
  renderPaginationSummary,
  renderReviewActionSummary,
  renderReviewCardsMarkup
} from "../../apps/platform-console/src/view-model.js";

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

  it("renders platform collections and pagination summary", () => {
    expect(renderEntityCardsMarkup([{ responder_id: "responder_a", hotline_count: 2, status: "disabled" }], "responders")).toContain(
      "Approve"
    );
    expect(renderAdminRequestCardsMarkup([{ request_id: "req_a", event_count: 1 }])).toContain("req_a");
    expect(renderAuditCardsMarkup([{ id: "audit_1", action: "responder.disabled", target_type: "responder", target_id: "responder_a", actor_type: "admin", recorded_at: "now" }])).toContain("responder.disabled");
    expect(renderReviewCardsMarkup([{ id: "review_1", target_type: "responder", target_id: "responder_a", review_status: "pending", actor_type: "caller", recorded_at: "now" }])).toContain("pending");
    expect(renderPaginationSummary({ total: 24, offset: 10, limit: 10 }, "responders")).toBe("responders: 11-20 / 24");
    expect(renderDetailSummary({ responder_id: "responder_a", status: "disabled" })).toContain("responder_a");
    expect(renderHistorySummary([{ review_status: "pending", recorded_at: "now" }], "Review History")).toContain("Review History");
    expect(renderReviewActionSummary({ responder_id: "responder_a", status: "disabled" }, "manual check", [{ reason: "policy" }])).toContain("manual check");
  });
});
