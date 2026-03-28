import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function structuredError(code, message, extra = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: false,
      ...extra
    }
  };
}

function normalizedString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed || null;
}

function buildCallerHeaders() {
  const headers = {};
  if (process.env.CALLER_PLATFORM_API_KEY || process.env.PLATFORM_API_KEY) {
    headers["X-Platform-Api-Key"] = process.env.CALLER_PLATFORM_API_KEY || process.env.PLATFORM_API_KEY;
  }
  return headers;
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

async function requestJson(baseUrl, pathname, { method = "GET", body } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      ...buildCallerHeaders(),
      ...(body === undefined ? {} : { "content-type": "application/json; charset=utf-8" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null
  };
}

function callerBaseUrl() {
  return process.env.CALLER_CONTROLLER_BASE_URL || `http://127.0.0.1:${process.env.CALLER_CONTROLLER_PORT || 8081}`;
}

function mapCatalogItem(item) {
  return {
    hotlineId: item.hotline_id,
    responderId: item.responder_id,
    displayName: item.display_name || item.hotline_id,
    taskTypes: item.task_types || [],
    capabilities: item.capabilities || [],
    tags: item.tags || [],
    status: item.availability_status || item.status || "enabled"
  };
}

function mapRequestState(request, result = null) {
  const resultPackage = result?.result_package || request?.result_package || null;
  return {
    requestId: request?.request_id || null,
    status: request?.status || "UNKNOWN",
    hotlineId: request?.hotline_id || resultPackage?.hotline_id || null,
    responder: {
      responderId: request?.responder_id || resultPackage?.responder_id || null,
      hotlineId: request?.hotline_id || resultPackage?.hotline_id || null
    },
    result: resultPackage?.output || null,
    error: resultPackage?.error || null,
    resultPackage
  };
}

async function waitForTerminalRequest(requestId, { timeoutMs, intervalMs } = {}) {
  const startedAt = Date.now();
  const maxWaitMs = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : Number(process.env.SKILL_MAX_WAIT_MS || 30000);
  const pollEveryMs = Number.isFinite(Number(intervalMs)) ? Number(intervalMs) : Number(process.env.SKILL_POLL_INTERVAL_MS || 250);
  while (Date.now() - startedAt < maxWaitMs) {
    const request = await requestJson(callerBaseUrl(), `/controller/requests/${encodeURIComponent(requestId)}`);
    if (request.status !== 200) {
      return request;
    }
    const result = await requestJson(callerBaseUrl(), `/controller/requests/${encodeURIComponent(requestId)}/result`);
    if (["SUCCEEDED", "FAILED", "UNVERIFIED", "TIMED_OUT"].includes(request.body?.status) || result.body?.available === true) {
      return {
        status: 200,
        body: mapRequestState(request.body, result.body)
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
  }
  return {
    status: 200,
    body: {
      requestId,
      status: "PENDING",
      result: null,
      error: {
        code: "SKILL_WAIT_TIMEOUT",
        message: "request did not reach terminal state before skill timeout",
        retryable: true
      }
    }
  };
}

async function resolveCatalogTarget(hotlineId, responderId = null) {
  const params = new URLSearchParams();
  if (hotlineId) {
    params.set("hotline_id", hotlineId);
  }
  if (responderId) {
    params.set("responder_id", responderId);
  }
  const catalog = await requestJson(callerBaseUrl(), `/controller/hotlines?${params.toString()}`);
  if (catalog.status !== 200) {
    return catalog;
  }
  const selected = (catalog.body?.items || []).find((item) => {
    if (item.hotline_id !== hotlineId) {
      return false;
    }
    if (responderId && item.responder_id !== responderId) {
      return false;
    }
    return true;
  });
  if (!selected) {
    return {
      status: 404,
      body: structuredError("HOTLINE_NOT_FOUND", "no catalog hotline matched the requested hotlineId", {
        hotlineId,
        responderId
      })
    };
  }
  return {
    status: 200,
    body: selected
  };
}

function buildInvokePayload(body, selected) {
  const softTimeoutS = Number(body?.constraints?.softTimeoutS);
  const hardTimeoutS = Number(body?.constraints?.hardTimeoutS);
  return {
    responder_id: selected.responder_id,
    hotline_id: selected.hotline_id,
    expected_signer_public_key_pem: selected.responder_public_key_pem || null,
    task_type: normalizedString(body.taskType) || selected.task_types?.[0] || null,
    input: body.input || {},
    payload: body.input || {},
    soft_timeout_s: Number.isFinite(softTimeoutS) ? softTimeoutS : undefined,
    hard_timeout_s: Number.isFinite(hardTimeoutS) ? hardTimeoutS : undefined
  };
}

export function createCallerSkillAdapterServer() {
  return http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname;
    try {
      if (method === "OPTIONS") {
        sendJson(res, 204, {});
        return;
      }
      if (method === "GET" && pathname === "/healthz") {
        sendJson(res, 200, { ok: true, service: "caller-skill-adapter" });
        return;
      }
      if (method === "GET" && pathname === "/skills/remote-hotline/catalog") {
        const catalog = await requestJson(callerBaseUrl(), `/controller/hotlines${url.search}`);
        sendJson(
          res,
          catalog.status,
          catalog.status === 200 ? { items: (catalog.body?.items || []).map(mapCatalogItem) } : catalog.body
        );
        return;
      }
      if (method === "POST" && pathname === "/skills/remote-hotline/invoke") {
        const body = await parseJsonBody(req);
        const hotlineId = normalizedString(body.hotlineId);
        if (!hotlineId) {
          sendJson(res, 400, structuredError("HOTLINE_ID_REQUIRED", "hotlineId is required"));
          return;
        }
        const target = await resolveCatalogTarget(hotlineId, normalizedString(body.responderId));
        if (target.status !== 200) {
          sendJson(res, target.status, target.body);
          return;
        }
        const created = await requestJson(callerBaseUrl(), "/controller/remote-requests", {
          method: "POST",
          body: buildInvokePayload(body, target.body)
        });
        if (created.status !== 201) {
          sendJson(res, created.status, created.body);
          return;
        }
        const terminal = await waitForTerminalRequest(created.body.request_id, {
          timeoutMs: Number(body?.constraints?.hardTimeoutS) ? Number(body.constraints.hardTimeoutS) * 1000 + 2000 : undefined
        });
        sendJson(res, terminal.status, terminal.body);
        return;
      }
      const requestMatch = pathname.match(/^\/skills\/remote-hotline\/requests\/([^/]+)$/);
      if (method === "GET" && requestMatch) {
        const requestId = decodeURIComponent(requestMatch[1]);
        const request = await requestJson(callerBaseUrl(), `/controller/requests/${encodeURIComponent(requestId)}`);
        if (request.status !== 200) {
          sendJson(res, request.status, request.body);
          return;
        }
        const result = await requestJson(callerBaseUrl(), `/controller/requests/${encodeURIComponent(requestId)}/result`);
        sendJson(res, 200, mapRequestState(request.body, result.body));
        return;
      }
      sendJson(res, 404, structuredError("NOT_FOUND", "unknown route"));
    } catch (error) {
      sendJson(res, 500, structuredError("SKILL_ADAPTER_RUNTIME_ERROR", error instanceof Error ? error.message : "unknown_error"));
    }
  });
}

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT || 8091);
  const server = createCallerSkillAdapterServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`[caller-skill-adapter] listening on ${port}`);
  });
}
