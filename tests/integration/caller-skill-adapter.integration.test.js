import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCallerSkillAdapterServer } from "../../apps/caller-skill-adapter/src/server.js";
import { closeServer, jsonRequest, listenServer } from "../helpers/http.js";

function createFakeCallerControllerServer() {
  const requests = new Map();

  return http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname;

    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };

    const parseBody = async () =>
      new Promise((resolve) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          if (chunks.length === 0) {
            resolve({});
            return;
          }
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        });
      });

    if (method === "GET" && pathname === "/controller/hotlines") {
      send(200, {
        items: [
          {
            responder_id: "responder_local_demo",
            hotline_id: "local.delegated-execution.workspace-summary.v1",
            display_name: "Workspace Summary",
            description: "Summarize a local workspace",
            review_status: "local_only",
            task_types: ["text_summarize"],
            capabilities: ["workspace.summary"],
            tags: ["local", "workspace"],
            responder_public_key_pem: "pem"
          }
        ]
      });
      return;
    }

    if (method === "POST" && pathname === "/controller/requests") {
      const body = await parseBody();
      const request = {
        request_id: "req_skill_1",
        responder_id: body.responder_id,
        hotline_id: body.hotline_id,
        status: "CREATED"
      };
      requests.set(request.request_id, request);
      send(201, request);
      return;
    }

    if (method === "POST" && pathname === "/controller/requests/req_skill_1/contract-draft") {
      send(200, {
        request_id: "req_skill_1",
        contract: {
          request_id: "req_skill_1"
        }
      });
      return;
    }

    if (method === "POST" && pathname === "/controller/requests/req_skill_1/dispatch") {
      const request = requests.get("req_skill_1");
      request.status = "SUCCEEDED";
      send(202, { accepted: true, request });
      return;
    }

    if (method === "GET" && pathname === "/controller/requests/req_skill_1") {
      send(200, requests.get("req_skill_1"));
      return;
    }

    if (method === "GET" && pathname === "/controller/requests/req_skill_1/result") {
      send(200, {
        available: true,
        result_package: {
          status: "ok",
          responder_id: "responder_local_demo",
          hotline_id: "local.delegated-execution.workspace-summary.v1",
          output: {
            summary: "Workspace summary complete"
          }
        }
      });
      return;
    }

    send(404, { error: { code: "NOT_FOUND", message: "not found" } });
  });
}

function writeExampleDraft(homeDir) {
  const draftDir = path.join(homeDir, "hotline-registration-drafts");
  fs.mkdirSync(draftDir, { recursive: true });
  const draftFile = path.join(draftDir, "local.delegated-execution.workspace-summary.v1.registration.json");
  fs.writeFileSync(
    draftFile,
    JSON.stringify(
      {
        hotline_id: "local.delegated-execution.workspace-summary.v1",
        display_name: "Workspace Summary",
        description: "Summarize a local workspace",
        input_summary: "Provide workspace_path and question",
        output_summary: "Returns structured summary output",
        task_types: ["text_summarize"],
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["workspace_path", "question"],
          properties: {
            workspace_path: {
              type: "string",
              description: "Absolute path to the workspace to inspect"
            },
            question: {
              type: "string",
              description: "What the hotline should summarize or answer"
            }
          }
        },
        output_schema: {
          type: "object",
          additionalProperties: false,
          required: ["summary"],
          properties: {
            summary: {
              type: "string",
              description: "Structured summary output"
            }
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );
  return draftFile;
}

describe("caller skill adapter integration", () => {
  let callerServer;
  let skillServer;
  let tempHome;

  afterEach(async () => {
    delete process.env.CALLER_CONTROLLER_BASE_URL;
    delete process.env.DELEXEC_HOME;
    if (skillServer) {
      await closeServer(skillServer);
      skillServer = null;
    }
    if (callerServer) {
      await closeServer(callerServer);
      callerServer = null;
    }
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
      tempHome = null;
    }
  });

  it("supports read, prepare, send, and report for caller skill requests", async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "caller-skill-"));
    process.env.DELEXEC_HOME = tempHome;
    const draftFile = writeExampleDraft(tempHome);

    callerServer = createFakeCallerControllerServer();
    const callerUrl = await listenServer(callerServer);
    process.env.CALLER_CONTROLLER_BASE_URL = callerUrl;

    skillServer = createCallerSkillAdapterServer();
    const skillUrl = await listenServer(skillServer);

    const manifest = await jsonRequest(skillUrl, "/skills/caller/manifest");
    expect(manifest.status).toBe(200);
    expect(manifest.body.skill.name).toBe("caller-skill");
    expect(manifest.body.actions).toHaveLength(6);
    expect(manifest.body.orchestration.execution_phase_order).toEqual([
      "read_hotline",
      "prepare_request",
      "send_request",
      "report_response"
    ]);

    const brief = await jsonRequest(skillUrl, "/skills/caller/search-hotlines-brief", {
      method: "POST",
      body: {
        query: "workspace summarize",
        task_type: "text_summarize",
        limit: 5
      }
    });
    expect(brief.status).toBe(200);
    expect(brief.body.items).toHaveLength(1);
    expect(brief.body.items[0].hotline_id).toBe("local.delegated-execution.workspace-summary.v1");
    expect(brief.body.items[0].source).toBe("local");

    const detailed = await jsonRequest(skillUrl, "/skills/caller/search-hotlines-detailed", {
      method: "POST",
      body: {
        hotline_ids: ["local.delegated-execution.workspace-summary.v1"]
      }
    });
    expect(detailed.status).toBe(200);
    expect(detailed.body.items).toHaveLength(1);
    expect(detailed.body.items[0].draft_ready).toBe(true);
    expect(detailed.body.items[0].local_only).toBe(true);

    const read = await jsonRequest(skillUrl, "/skills/caller/hotlines/local.delegated-execution.workspace-summary.v1");
    expect(read.status).toBe(200);
    expect(read.body.hotline_id).toBe("local.delegated-execution.workspace-summary.v1");
    expect(read.body.draft_file).toBe(draftFile);
    expect(read.body.input_schema.required).toEqual(["workspace_path", "question"]);

    const invalidPrepared = await jsonRequest(skillUrl, "/skills/caller/prepare-request", {
      method: "POST",
      body: {
        hotline_id: "local.delegated-execution.workspace-summary.v1",
        input: {
          workspace_path: "/tmp/demo"
        },
        agent_session_id: "agent_1"
      }
    });
    expect(invalidPrepared.status).toBe(200);
    expect(invalidPrepared.body.status).toBe("draft");
    expect(invalidPrepared.body.errors[0].code).toBe("REQUIRED_FIELD_MISSING");

    const prepared = await jsonRequest(skillUrl, "/skills/caller/prepare-request", {
      method: "POST",
      body: {
        hotline_id: "local.delegated-execution.workspace-summary.v1",
        input: {
          workspace_path: "/tmp/demo",
          question: "Summarize the repo structure"
        },
        agent_session_id: "agent_1"
      }
    });
    expect(prepared.status).toBe(200);
    expect(prepared.body.status).toBe("ready");
    expect(prepared.body.errors).toEqual([]);

    const preparedFile = path.join(tempHome, "prepared-requests", `${prepared.body.prepared_request_id}.json`);
    expect(fs.existsSync(preparedFile)).toBe(true);

    const sent = await jsonRequest(skillUrl, "/skills/caller/send-request", {
      method: "POST",
      body: {
        prepared_request_id: prepared.body.prepared_request_id
      }
    });
    expect(sent.status).toBe(200);
    expect(sent.body.request_id).toBe("req_skill_1");
    expect(sent.body.status).toBe("SUCCEEDED");
    expect(sent.body.result_package.status).toBe("ok");

    const sentRecord = JSON.parse(fs.readFileSync(preparedFile, "utf8"));
    expect(sentRecord.status).toBe("sent");
    expect(sentRecord.request_id).toBe("req_skill_1");

    const report = await jsonRequest(skillUrl, "/skills/caller/requests/req_skill_1/report");
    expect(report.status).toBe(200);
    expect(report.body.request_id).toBe("req_skill_1");
    expect(report.body.result.summary).toBe("Workspace summary complete");
  });

  it("reads allowed local markdown files and rejects unsupported extensions", async () => {
    skillServer = createCallerSkillAdapterServer();
    const skillUrl = await listenServer(skillServer);

    const tempFile = path.join(os.tmpdir(), `skill-adapter-${Date.now()}.md`);
    fs.writeFileSync(tempFile, "# Resume\n\nEducation: Zhejiang University\n", "utf8");

    const readOk = await jsonRequest(skillUrl, "/skills/local-file/read", {
      method: "POST",
      body: { path: tempFile }
    });
    expect(readOk.status).toBe(200);
    expect(readOk.body.ok).toBe(true);
    expect(readOk.body.path).toBe(tempFile);
    expect(readOk.body.content).toContain("Zhejiang University");

    const readPdf = await jsonRequest(skillUrl, "/skills/local-file/read", {
      method: "POST",
      body: { path: "/tmp/sample.pdf" }
    });
    expect(readPdf.status).toBe(400);
    expect(readPdf.body.error.code).toBe("LOCAL_FILE_UNSUPPORTED_EXTENSION");
  });
});
