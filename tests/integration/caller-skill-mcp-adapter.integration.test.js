import http from "node:http";
import process from "node:process";

import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  createCallerSkillMcpAdapter,
  createCallerSkillMcpHttpServer
} from "../../apps/caller-skill-mcp-adapter/src/server.js";
import { closeServer, jsonRequest, listenServer } from "../helpers/http.js";

function createFakeCallerSkillServer() {
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

    if (method === "GET" && pathname === "/skills/caller/manifest") {
      send(200, {
        skill: { name: "caller-skill", version: "0.1.0", mode: "local_only" },
        actions: [
          { name: "search_hotlines_brief", description: "brief search" },
          { name: "search_hotlines_detailed", description: "detailed search" },
          { name: "read_hotline", description: "read hotline" },
          { name: "prepare_request", description: "prepare request" },
          { name: "send_request", description: "send request" },
          { name: "report_response", description: "report response" }
        ],
        orchestration: {
          execution_phase_order: ["read_hotline", "prepare_request", "send_request", "report_response"]
        }
      });
      return;
    }

    if (method === "POST" && pathname === "/skills/caller/search-hotlines-brief") {
      send(200, {
        items: [
          {
            hotline_id: "local.delegated-execution.workspace-summary.v1",
            display_name: "Workspace Summary"
          }
        ]
      });
      return;
    }

    if (method === "POST" && pathname === "/skills/caller/search-hotlines-detailed") {
      send(200, {
        items: [
          {
            hotline_id: "local.delegated-execution.workspace-summary.v1",
            input_summary: "Provide workspace_path and question"
          }
        ]
      });
      return;
    }

    if (method === "GET" && pathname === "/skills/caller/hotlines/local.delegated-execution.workspace-summary.v1") {
      send(200, {
        hotline_id: "local.delegated-execution.workspace-summary.v1",
        input_schema: { type: "object" }
      });
      return;
    }

    if (method === "POST" && pathname === "/skills/caller/prepare-request") {
      const body = await parseBody();
      send(200, {
        prepared_request_id: "prep_mcp_1",
        status: "ready",
        hotline_id: body.hotline_id,
        normalized_input: body.input,
        agent_session_id: body.agent_session_id
      });
      return;
    }

    if (method === "POST" && pathname === "/skills/caller/send-request") {
      send(200, {
        request_id: "req_mcp_1",
        hotline_id: "local.delegated-execution.workspace-summary.v1",
        status: "SUCCEEDED",
        result_package: {
          status: "ok",
          output: {
            summary: "done"
          }
        }
      });
      return;
    }

    if (method === "GET" && pathname === "/skills/caller/requests/req_mcp_1/report") {
      send(200, {
        request_id: "req_mcp_1",
        status: "SUCCEEDED",
        result_package: {
          status: "ok",
          output: {
            summary: "done"
          }
        }
      });
      return;
    }

    send(404, { error: { code: "NOT_FOUND", message: "not found" } });
  });
}

describe("caller skill mcp adapter integration", () => {
  let skillServer;

  afterEach(async () => {
    if (skillServer) {
      await closeServer(skillServer);
      skillServer = null;
    }
  });

  it("maps caller-skill manifest and actions into MCP tools", async () => {
    skillServer = createFakeCallerSkillServer();
    const skillBaseUrl = await listenServer(skillServer);

    const adapter = createCallerSkillMcpAdapter({
      baseUrl: skillBaseUrl
    });

    const tools = await adapter.listTools();
    expect(tools).toHaveLength(6);
    expect(tools[0].name).toBe("caller_skill_search_hotlines_brief");

    const brief = await adapter.callTool("caller_skill_search_hotlines_brief", {
      query: "workspace summarize",
      limit: 5
    });
    expect(brief.isError).toBe(false);
    expect(brief.body.items[0].hotline_id).toBe("local.delegated-execution.workspace-summary.v1");

    const prepared = await adapter.callTool("caller_skill_prepare_request", {
      hotline_id: "local.delegated-execution.workspace-summary.v1",
      input: {
        workspace_path: "/tmp/demo",
        question: "Summarize the repo"
      }
    });
    expect(prepared.body.prepared_request_id).toBe("prep_mcp_1");
    expect(prepared.body.agent_session_id).toBe(adapter.adapterSessionId);

    const sent = await adapter.callTool("caller_skill_send_request", {
      prepared_request_id: "prep_mcp_1",
      wait: true
    });
    expect(sent.body.request_id).toBe("req_mcp_1");
    expect(sent.body.result_package.status).toBe("ok");

    const report = await adapter.handleRpcRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "caller_skill_report_response",
        arguments: {
          request_id: "req_mcp_1"
        }
      }
    });
    expect(report.result.isError).toBe(false);
    expect(report.result.structuredContent.status).toBe("SUCCEEDED");
  });

  it("exposes caller-skill tools over stdio via the official MCP SDK", async () => {
    skillServer = createFakeCallerSkillServer();
    const skillBaseUrl = await listenServer(skillServer);

    const client = new Client({
      name: "caller-skill-mcp-adapter-test-client",
      version: "0.1.0"
    });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "/Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client/apps/caller-skill-mcp-adapter/src/server.js"
      ],
      env: {
        ...process.env,
        CALLER_SKILL_BASE_URL: skillBaseUrl
      },
      stderr: "pipe"
    });

    const stderrChunks = [];
    transport.stderr?.on("data", (chunk) => stderrChunks.push(chunk.toString("utf8")));

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.some((tool) => tool.name === "caller_skill_prepare_request")).toBe(true);

      const sent = await client.callTool({
        name: "caller_skill_send_request",
        arguments: {
          prepared_request_id: "prep_mcp_1",
          wait: true
        }
      });

      expect(sent.isError).not.toBe(true);
      expect(sent.structuredContent.request_id).toBe("req_mcp_1");
      expect(sent.structuredContent.result_package.status).toBe("ok");
    } finally {
      await client.close();
    }

    expect(stderrChunks.join("")).toBe("");
  });

  it("exposes caller-skill tools over streamable HTTP via the official MCP SDK", async () => {
    skillServer = createFakeCallerSkillServer();
    const skillBaseUrl = await listenServer(skillServer);

    const httpServer = await createCallerSkillMcpHttpServer({
      baseUrl: skillBaseUrl,
      port: 0
    });
    const server = httpServer.server;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    const mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);

    const client = new Client({
      name: "caller-skill-mcp-adapter-http-test-client",
      version: "0.1.0"
    });
    const transport = new StreamableHTTPClientTransport(mcpUrl);

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.some((tool) => tool.name === "caller_skill_read_hotline")).toBe(true);

      const prepared = await client.callTool({
        name: "caller_skill_prepare_request",
        arguments: {
          hotline_id: "local.delegated-execution.workspace-summary.v1",
          input: {
            workspace_path: "/tmp/demo",
            question: "Summarize the repo"
          }
        }
      });

      expect(prepared.isError).not.toBe(true);
      expect(prepared.structuredContent.prepared_request_id).toBe("prep_mcp_1");
    } finally {
      await client.close();
      await httpServer.close();
    }
  });
});
