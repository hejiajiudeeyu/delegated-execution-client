import crypto from "node:crypto";
import http from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";

const JSON_RPC_VERSION = "2.0";
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

function callerSkillBaseUrl() {
  const port = process.env.CALLER_SKILL_ADAPTER_PORT || process.env.SKILL_ADAPTER_PORT || 8091;
  return process.env.CALLER_SKILL_BASE_URL || `http://127.0.0.1:${port}`;
}

function buildHeaders(body) {
  return body === undefined
    ? {}
    : {
        "content-type": "application/json; charset=utf-8"
      };
}

async function requestJson(fetchImpl, baseUrl, pathname, { method = "GET", body } = {}) {
  const response = await fetchImpl(new URL(pathname, baseUrl), {
    method,
    headers: buildHeaders(body),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    parsed = JSON.parse(text);
  }
  return {
    status: response.status,
    ok: response.ok,
    body: parsed
  };
}

const toolSchemas = {
  search_hotlines_brief: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string" },
      task_goal: { type: "string" },
      task_type: { type: "string" },
      limit: { type: "integer", minimum: 1 }
    }
  },
  search_hotlines_detailed: {
    type: "object",
    additionalProperties: false,
    required: ["hotline_ids"],
    properties: {
      hotline_ids: {
        type: "array",
        items: { type: "string" }
      }
    }
  },
  read_hotline: {
    type: "object",
    additionalProperties: false,
    required: ["hotline_id"],
    properties: {
      hotline_id: { type: "string" }
    }
  },
  prepare_request: {
    type: "object",
    additionalProperties: false,
    required: ["hotline_id", "input"],
    properties: {
      hotline_id: { type: "string" },
      input: { type: "object" },
      agent_session_id: { type: "string" }
    }
  },
  send_request: {
    type: "object",
    additionalProperties: false,
    required: ["prepared_request_id"],
    properties: {
      prepared_request_id: { type: "string" },
      wait: { type: "boolean" }
    }
  },
  report_response: {
    type: "object",
    additionalProperties: false,
    required: ["request_id"],
    properties: {
      request_id: { type: "string" }
    }
  }
};

const toolShapeSchemas = {
  search_hotlines_brief: {
    query: z.string().optional(),
    task_goal: z.string().optional(),
    task_type: z.string().optional(),
    limit: z.number().int().positive().optional()
  },
  search_hotlines_detailed: {
    hotline_ids: z.array(z.string())
  },
  read_hotline: {
    hotline_id: z.string()
  },
  prepare_request: {
    hotline_id: z.string(),
    input: z.record(z.string(), z.unknown()),
    agent_session_id: z.string().optional()
  },
  send_request: {
    prepared_request_id: z.string(),
    wait: z.boolean().optional()
  },
  report_response: {
    request_id: z.string()
  }
};

function mapActionToToolName(actionName) {
  return `caller_skill_${actionName}`;
}

function parseToolName(toolName) {
  if (toolName.startsWith("caller_skill.")) {
    return toolName.slice("caller_skill.".length);
  }
  if (toolName.startsWith("caller_skill_")) {
    return toolName.slice("caller_skill_".length);
  }
  return null;
}

function buildToolDefinitions(manifest) {
  return manifest.actions.map((action) => ({
    name: mapActionToToolName(action.name),
    description: action.description,
    inputSchema: toolSchemas[action.name] || {
      type: "object",
      additionalProperties: true,
      properties: {}
    }
  }));
}

function buildToolResult(body, isError = false) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(body, null, 2)
      }
    ],
    structuredContent: body,
    isError
  };
}

function buildJsonRpcResult(id, result) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result
  };
}

function buildJsonRpcError(id, code, message, data = null) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
      ...(data === null ? {} : { data })
    }
  };
}

function buildToolInputShape(actionName) {
  return toolShapeSchemas[actionName] || {};
}

export function createCallerSkillMcpAdapter(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = options.baseUrl || callerSkillBaseUrl();
  const adapterSessionId = options.adapterSessionId || `mcp_${crypto.randomUUID()}`;
  let manifestPromise = null;

  async function getManifest() {
    if (!manifestPromise) {
      manifestPromise = requestJson(fetchImpl, baseUrl, "/skills/caller/manifest").then((response) => {
        if (!response.ok) {
          throw new Error(`caller_skill_manifest_unavailable:${response.status}`);
        }
        return response.body;
      });
    }
    return manifestPromise;
  }

  async function listTools() {
    const manifest = await getManifest();
    return buildToolDefinitions(manifest);
  }

  async function invokeAction(actionName, args = {}) {
    switch (actionName) {
      case "search_hotlines_brief":
        return requestJson(fetchImpl, baseUrl, "/skills/caller/search-hotlines-brief", {
          method: "POST",
          body: args
        });
      case "search_hotlines_detailed":
        return requestJson(fetchImpl, baseUrl, "/skills/caller/search-hotlines-detailed", {
          method: "POST",
          body: args
        });
      case "read_hotline":
        return requestJson(
          fetchImpl,
          baseUrl,
          `/skills/caller/hotlines/${encodeURIComponent(args.hotline_id || "")}`
        );
      case "prepare_request":
        return requestJson(fetchImpl, baseUrl, "/skills/caller/prepare-request", {
          method: "POST",
          body: {
            ...args,
            agent_session_id: args.agent_session_id || adapterSessionId
          }
        });
      case "send_request":
        return requestJson(fetchImpl, baseUrl, "/skills/caller/send-request", {
          method: "POST",
          body: args
        });
      case "report_response":
        return requestJson(
          fetchImpl,
          baseUrl,
          `/skills/caller/requests/${encodeURIComponent(args.request_id || "")}/report`
        );
      default:
        throw new Error(`unsupported_caller_skill_action:${actionName}`);
    }
  }

  async function callTool(toolName, args = {}) {
    const actionName = parseToolName(toolName);
    if (!actionName) {
      throw new Error(`unsupported_tool:${toolName}`);
    }
    const response = await invokeAction(actionName, args);
    return {
      status: response.status,
      body: response.body,
      isError: !response.ok
    };
  }

  async function handleRpcRequest(message) {
    if (!message || message.jsonrpc !== JSON_RPC_VERSION || !message.method) {
      return buildJsonRpcError(message?.id ?? null, -32600, "Invalid Request");
    }

    const { id, method, params } = message;
    if (id === undefined) {
      return null;
    }

    try {
      if (method === "initialize") {
        return buildJsonRpcResult(id, {
          protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL_VERSION,
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "caller-skill-mcp-adapter",
            version: "0.1.0"
          }
        });
      }

      if (method === "ping") {
        return buildJsonRpcResult(id, {});
      }

      if (method === "tools/list") {
        const tools = await listTools();
        return buildJsonRpcResult(id, { tools });
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const args = params?.arguments || {};
        if (!toolName) {
          return buildJsonRpcError(id, -32602, "Missing tool name");
        }
        const result = await callTool(toolName, args);
        return buildJsonRpcResult(id, buildToolResult(result.body, result.isError));
      }

      return buildJsonRpcError(id, -32601, "Method not found");
    } catch (error) {
      return buildJsonRpcError(id, -32000, error instanceof Error ? error.message : "Unknown error");
    }
  }

  return {
    baseUrl,
    adapterSessionId,
    getManifest,
    listTools,
    callTool,
    handleRpcRequest
  };
}

export async function createCallerSkillMcpServer(options = {}) {
  const adapter = options.adapter || createCallerSkillMcpAdapter(options);
  const manifest = await adapter.getManifest();
  const server = new McpServer({
    name: manifest?.skill?.name || "caller-skill",
    version: manifest?.skill?.version || "0.1.0"
  });

  for (const action of manifest.actions || []) {
    const toolName = mapActionToToolName(action.name);
    server.registerTool(
      toolName,
      {
        description: action.description,
        inputSchema: buildToolInputShape(action.name)
      },
      async (args) => {
        const result = await adapter.callTool(toolName, args || {});
        return buildToolResult(result.body, result.isError);
      }
    );
  }

  return {
    adapter,
    server,
    manifest
  };
}

export async function runCallerSkillMcpAdapter(options = {}) {
  const { adapter, server, manifest } = await createCallerSkillMcpServer(options);
  const transport = options.transport || new StdioServerTransport(options.stdin, options.stdout);
  await server.connect(transport);
  return {
    adapter,
    server,
    transport,
    manifest
  };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(body));
}

export async function createCallerSkillMcpHttpServer(options = {}) {
  const adapter = options.adapter || createCallerSkillMcpAdapter(options);
  const port = Number(options.port || process.env.PORT || process.env.MCP_ADAPTER_PORT || 8092);
  const host = options.host || process.env.HOST || "127.0.0.1";

  const server = http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${host}:${port}`);

    if (method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, {
        ok: true,
        service: "caller-skill-mcp-adapter",
        transport: "streamable_http"
      });
      return;
    }

    if (method === "GET" && url.pathname === "/") {
      sendJson(res, 200, {
        ok: true,
        transport: "streamable_http",
        endpoint: "/mcp"
      });
      return;
    }

    if (url.pathname !== "/mcp") {
      sendJson(res, 404, {
        jsonrpc: JSON_RPC_VERSION,
        error: {
          code: -32004,
          message: "Not found"
        },
        id: null
      });
      return;
    }

    if (!["GET", "POST", "DELETE"].includes(method)) {
      sendJson(res, 405, {
        jsonrpc: JSON_RPC_VERSION,
        error: {
          code: -32000,
          message: "Method not allowed"
        },
        id: null
      });
      return;
    }

    try {
      const { server: mcpServer } = await createCallerSkillMcpServer({
        ...options,
        adapter
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      await mcpServer.connect(transport);
      const parsedBody = method === "POST" ? await parseJsonBody(req) : undefined;
      await transport.handleRequest(req, res, parsedBody);
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
    } catch (error) {
      console.error(
        `[caller-skill-mcp-adapter] streamable_http request failed: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`
      );
      sendJson(res, 500, {
        jsonrpc: JSON_RPC_VERSION,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal server error"
        },
        id: null
      });
    }
  });

  return {
    adapter,
    port,
    host,
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve({
            baseUrl: `http://${host}:${port}`,
            mcpUrl: `http://${host}:${port}/mcp`
          });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] || process.env.MCP_ADAPTER_TRANSPORT || "stdio";
  const run =
    mode === "http"
      ? async () => {
          const app = await createCallerSkillMcpHttpServer();
          const { mcpUrl } = await app.listen();
          console.error(`[caller-skill-mcp-adapter] streamable_http listening on ${mcpUrl}`);
          return app;
        }
      : () => runCallerSkillMcpAdapter();

  run().catch((error) => {
    console.error(`[caller-skill-mcp-adapter] ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exit(1);
  });
}
