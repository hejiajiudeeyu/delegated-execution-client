import { describe, expect, it } from "vitest";

import {
  buildExampleHotlineDefinition,
  buildExampleRequestBody,
  isExampleHotlineDefinitionStale,
  LOCAL_EXAMPLE_CAPABILITY,
  LOCAL_EXAMPLE_DISPLAY_NAME,
  LOCAL_EXAMPLE_HOTLINE_ID,
  LOCAL_EXAMPLE_TASK_TYPE
} from "../../apps/ops/src/example-hotline.js";
import { buildHotlineRegistrationDraft } from "../../apps/ops/src/config.js";

describe("official local example hotline", () => {
  it("presents the official local example as a read-only workspace diagnostic", () => {
    const definition = buildExampleHotlineDefinition();

    expect(LOCAL_EXAMPLE_DISPLAY_NAME).toBe("Local Workspace Doctor");
    expect(LOCAL_EXAMPLE_TASK_TYPE).toBe("workspace_diagnose");
    expect(LOCAL_EXAMPLE_CAPABILITY).toBe("workspace.diagnose");
    expect(definition.tags).toEqual(["local", "example", "diagnostic"]);
    expect(definition.description).toContain("read-only");
    expect(definition.input_schema.properties.text.description).toContain("Optional");
    expect(definition.output_schema.required).toEqual(["summary", "checks", "links", "next_steps"]);
    expect(definition.output_schema.properties.checks.type).toBe("array");
    expect(definition.output_schema.properties.links.type).toBe("array");
    expect(definition.output_schema.properties.next_steps.type).toBe("array");
  });

  it("carries supervisor diagnostics into the example request payload without requiring secrets", () => {
    const request = buildExampleRequestBody({
      text: "check local runtime",
      responderId: "responder_local",
      diagnostics: {
        generated_at: "2026-06-11T08:00:00.000Z",
        checks: [{ name: "caller", status: "ok", detail: "http://127.0.0.1:8081/healthz" }],
        links: [{ label: "Console", url: "http://127.0.0.1:4174/" }],
        next_steps: ["Run delexec-ops status."]
      }
    });

    expect(request.task_type).toBe("workspace_diagnose");
    expect(request.payload.diagnostics.checks[0].name).toBe("caller");
    expect(JSON.stringify(request)).not.toContain("sk_admin");
    expect(JSON.stringify(request)).not.toContain("api_key");
    expect(JSON.stringify(request.output_schema.properties)).toContain("next_steps");
  });

  it("upgrades stale installed official example metadata to the current diagnostic contract", () => {
    const stale = {
      hotline_id: LOCAL_EXAMPLE_HOTLINE_ID,
      display_name: "Delegated Execution Workspace Summary",
      description: "old summary example",
      task_types: ["text_summarize"],
      capabilities: ["text.summarize"],
      tags: ["local", "example", "demo"],
      enabled: false,
      submitted_for_review: true,
      metadata: { registration: { draft_file: "/tmp/stale.json" } }
    };

    const upgraded = buildExampleHotlineDefinition(stale);

    expect(isExampleHotlineDefinitionStale(stale)).toBe(true);
    expect(isExampleHotlineDefinitionStale(upgraded)).toBe(false);
    expect(upgraded.display_name).toBe("Local Workspace Doctor");
    expect(upgraded.task_types).toEqual(["workspace_diagnose"]);
    expect(upgraded.capabilities).toEqual(["workspace.diagnose"]);
    expect(upgraded.tags).toEqual(["local", "example", "diagnostic"]);
    expect(upgraded.adapter.cmd).toContain("example-hotline-worker.js");
    expect(upgraded.enabled).toBe(false);
    expect(upgraded.submitted_for_review).toBe(true);
    expect(upgraded.metadata.registration.draft_file).toBe("/tmp/stale.json");
  });

  it("uses the official diagnostic schema when generating the registration draft", () => {
    const draft = buildHotlineRegistrationDraft(
      {
        config: { caller: { contact_email: "local@test.example" } },
        env: {}
      },
      buildExampleHotlineDefinition()
    );

    expect(draft.display_name).toBe("Local Workspace Doctor");
    expect(draft.draft_meta.generated_profile).toBe("workspace_diagnose");
    expect(draft.input_schema.properties.text.description).toContain("Optional");
    expect(draft.output_schema.required).toEqual(["summary", "checks", "links", "next_steps"]);
    expect(draft.recommended_for).toContain("First local run after bootstrap");
  });
});
