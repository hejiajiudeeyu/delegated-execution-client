import path from "node:path";
import { fileURLToPath } from "node:url";

export const LOCAL_EXAMPLE_HOTLINE_ID = "local.delegated-execution.workspace-summary.v1";
export const LOCAL_EXAMPLE_DISPLAY_NAME = "Local Workspace Doctor";
export const LOCAL_EXAMPLE_TASK_TYPE = "workspace_diagnose";
export const LOCAL_EXAMPLE_CAPABILITY = "workspace.diagnose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function quoteShellArg(value) {
  return JSON.stringify(String(value));
}

export function resolveExampleWorkerPath() {
  return path.resolve(__dirname, "example-hotline-worker.js");
}

export function buildExampleHotlineDefinition(existing = null) {
  const base = {
    hotline_id: LOCAL_EXAMPLE_HOTLINE_ID,
    display_name: LOCAL_EXAMPLE_DISPLAY_NAME,
    description:
      "A read-only local delegated-execution workspace diagnostic. It checks local runtime readiness and points you to the next debug step without using admin secrets.",
    summary:
      "Run this first to verify that Caller, Responder, Relay, and Agent-facing adapters are ready on this machine.",
    enabled: true,
    task_types: [LOCAL_EXAMPLE_TASK_TYPE],
    capabilities: [LOCAL_EXAMPLE_CAPABILITY],
    tags: ["local", "example", "diagnostic"],
    adapter_type: "process",
    adapter: {
      cmd: `${quoteShellArg(process.execPath)} ${quoteShellArg(resolveExampleWorkerPath())}`
    },
    timeouts: {
      soft_timeout_s: 60,
      hard_timeout_s: 180
    },
    review_status: "local_only",
    submitted_for_review: false,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
          description:
            "Optional note for the diagnostic run, such as what you just tried or which page sent you here."
        }
      }
    },
    output_schema: buildWorkspaceDoctorOutputSchema(),
    input_summary: "Optional: add a short note about what you are trying to verify. The diagnostic itself is read-only.",
    output_summary:
      "Returns a compact local readiness report with service checks, useful console links, and next debug commands.",
    recommended_for: [
      "First local run after bootstrap",
      "Verifying the Agent-callable local environment",
      "Checking where to look next when a trial call fails"
    ],
    limitations: [
      "Read-only: it does not approve platform reviews or mutate admin settings.",
      "Local-only: it reports this machine's client runtime, not public platform availability."
    ],
    input_examples: [
      {
        title: "First local smoke check",
        input: {
          text: "I opened Catalog from Dashboard next-up and want to verify the local runtime."
        }
      }
    ],
    output_examples: [
      {
        title: "Workspace ready",
        output: {
          summary: "Local delegated-execution workspace is ready for a first trial call.",
          checks: [
            { name: "caller", status: "ok", detail: "Caller controller is running." },
            { name: "responder", status: "ok", detail: "Local responder is enabled." }
          ],
          links: [
            { label: "Runtime", url: "http://127.0.0.1:4173/general/runtime" },
            { label: "Calls", url: "http://127.0.0.1:4173/caller/calls" }
          ],
          next_steps: ["Open Calls to inspect the request result.", "Run delexec-ops debug-snapshot if a check fails."]
        }
      }
    ]
  };
  if (!existing || typeof existing !== "object") {
    return base;
  }
  return {
    ...base,
    enabled: existing.enabled === false ? false : base.enabled,
    review_status: typeof existing.review_status === "string" ? existing.review_status : base.review_status,
    submitted_for_review:
      typeof existing.submitted_for_review === "boolean" ? existing.submitted_for_review : base.submitted_for_review,
    metadata: existing.metadata && typeof existing.metadata === "object" ? existing.metadata : base.metadata
  };
}

export function isExampleHotlineDefinitionStale(existing = null) {
  if (!existing || typeof existing !== "object") {
    return false;
  }
  const current = buildExampleHotlineDefinition();
  return (
    existing.display_name !== current.display_name ||
    JSON.stringify(existing.task_types || []) !== JSON.stringify(current.task_types || []) ||
    JSON.stringify(existing.capabilities || []) !== JSON.stringify(current.capabilities || []) ||
    JSON.stringify(existing.tags || []) !== JSON.stringify(current.tags || [])
  );
}

export function buildWorkspaceDoctorOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "checks", "links", "next_steps"],
    properties: {
      summary: {
        type: "string",
        description: "Human-readable local readiness summary."
      },
      checks: {
        type: "array",
        description: "Read-only local service and configuration checks.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "status", "detail"],
          properties: {
            name: { type: "string" },
            status: { type: "string", enum: ["ok", "warn", "fail"] },
            detail: { type: "string" }
          }
        }
      },
      links: {
        type: "array",
        description: "Console links that help inspect the local run.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "url"],
          properties: {
            label: { type: "string" },
            url: { type: "string" }
          }
        }
      },
      next_steps: {
        type: "array",
        description: "Suggested local debug or follow-up commands.",
        items: { type: "string" }
      }
    }
  };
}

export function buildExampleRequestBody({
  text,
  responderId,
  hotlineId = LOCAL_EXAMPLE_HOTLINE_ID,
  signerPublicKeyPem = null,
  diagnostics = null
} = {}) {
  const payloadText = String(text || "Check this local delegated-execution workspace.").trim();
  const payload = {
    text: payloadText,
    ...(diagnostics && typeof diagnostics === "object" ? { diagnostics } : {})
  };
  return {
    responder_id: responderId,
    hotline_id: hotlineId,
    expected_signer_public_key_pem: signerPublicKeyPem,
    task_type: LOCAL_EXAMPLE_TASK_TYPE,
    input: payload,
    payload,
    output_schema: buildWorkspaceDoctorOutputSchema()
  };
}

export function summarizeExampleText(text) {
  const value = String(text || "").trim().replace(/\s+/g, " ");
  if (!value) {
    return "No input text provided.";
  }
  if (value.length <= 120) {
    return value;
  }
  return `${value.slice(0, 117)}...`;
}
