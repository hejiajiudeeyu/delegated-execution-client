import crypto from "node:crypto";

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

function mapActionToToolName(actionName) {
  return `caller_skill.${actionName}`;
}

function parseToolName(toolName) {
  if (!toolName.startsWith("caller_skill.")) {
    return null;
  }
  return toolName.slice("caller_skill.".length);
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

function encodeFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8"),
    payload
  ]);
}

function createContentLengthParser(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const headerText = buffer.subarray(0, headerEnd).toString("utf8");
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        throw new Error("mcp_content_length_missing");
      }
      const contentLength = Number(match[1]);
      const frameEnd = headerEnd + 4 + contentLength;
      if (buffer.length < frameEnd) {
        return;
      }
      const payload = buffer.subarray(headerEnd + 4, frameEnd).toString("utf8");
      buffer = buffer.subarray(frameEnd);
      onMessage(JSON.parse(payload));
    }
  };
}

export function runCallerSkillMcpAdapter(options = {}) {
  const stdin = options.stdin || process.stdin;
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const adapter = options.adapter || createCallerSkillMcpAdapter(options);

  stdin.resume();
  stdin.on(
    "data",
    createContentLengthParser(async (message) => {
      try {
        const response = await adapter.handleRpcRequest(message);
        if (response) {
          stdout.write(encodeFrame(response));
        }
      } catch (error) {
        stderr.write(`[caller-skill-mcp-adapter] ${error instanceof Error ? error.message : String(error)}\n`);
      }
    })
  );

  return adapter;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCallerSkillMcpAdapter();
}
