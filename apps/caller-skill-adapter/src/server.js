import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureOpsDirectories, getOpsHomeDir, readJsonFile, writeJsonFile } from "@delexec/runtime-utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDisplayHintsMap() {
  const map = new Map();
  try {
    const contractsRoot = path.resolve(__dirname, "../../../packages/caller-controller-core/node_modules/@delexec/contracts");
    const altRoot = path.resolve(__dirname, "../../../../node_modules/@delexec/contracts");
    const localRoot = path.resolve(__dirname, "../../../../../repos/protocol/docs/templates/hotlines");
    const roots = [
      localRoot,
      path.join(contractsRoot, "templates/hotlines"),
      path.join(altRoot, "templates/hotlines")
    ];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const hotlineId of fs.readdirSync(root)) {
        const hintsPath = path.join(root, hotlineId, "output_display_hints.json");
        if (fs.existsSync(hintsPath)) {
          try {
            map.set(hotlineId, JSON.parse(fs.readFileSync(hintsPath, "utf8")));
          } catch {
            // ignore malformed hints
          }
        }
      }
      if (map.size > 0) break;
    }
  } catch {
    // non-fatal
  }
  return map;
}

const displayHintsMap = loadDisplayHintsMap();

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

function nowIso() {
  return new Date().toISOString();
}

function buildCallerHeaders() {
  const headers = {};
  if (process.env.CALLER_PLATFORM_API_KEY || process.env.PLATFORM_API_KEY) {
    headers["X-Platform-Api-Key"] = process.env.CALLER_PLATFORM_API_KEY || process.env.PLATFORM_API_KEY;
  }
  return headers;
}

function callerBaseUrl() {
  return process.env.CALLER_CONTROLLER_BASE_URL || `http://127.0.0.1:${process.env.CALLER_CONTROLLER_PORT || 8081}`;
}

function sanitizeHotlineIdForFileName(hotlineId) {
  return String(hotlineId || "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureCallerSkillDirectories() {
  ensureOpsDirectories();
  const preparedDir = path.join(getOpsHomeDir(), "prepared-requests");
  fs.mkdirSync(preparedDir, { recursive: true, mode: 0o700 });
  return {
    preparedDir,
    draftDir: path.join(getOpsHomeDir(), "hotline-registration-drafts")
  };
}

function getHotlineRegistrationDraftFile(hotlineId) {
  const { draftDir } = ensureCallerSkillDirectories();
  const safeName = sanitizeHotlineIdForFileName(hotlineId) || "hotline";
  return path.join(draftDir, `${safeName}.registration.json`);
}

function generatePreparedRequestId() {
  return `prep_${crypto.randomUUID()}`;
}

function getPreparedRequestFile(preparedRequestId) {
  const { preparedDir } = ensureCallerSkillDirectories();
  return path.join(preparedDir, `${preparedRequestId}.json`);
}

function loadPreparedRequest(preparedRequestId) {
  const filePath = getPreparedRequestFile(preparedRequestId);
  return {
    filePath,
    record: readJsonFile(filePath, null)
  };
}

function savePreparedRequest(record) {
  const filePath = getPreparedRequestFile(record.prepared_request_id);
  writeJsonFile(filePath, record);
  return filePath;
}

function invalidatePriorPreparedRequests(hotlineId, agentSessionId) {
  if (!agentSessionId) {
    return;
  }
  const { preparedDir } = ensureCallerSkillDirectories();
  if (!fs.existsSync(preparedDir)) {
    return;
  }
  for (const name of fs.readdirSync(preparedDir)) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(preparedDir, name);
    const record = readJsonFile(filePath, null);
    if (!record) continue;
    if (record.hotline_id !== hotlineId) continue;
    if (record.source_agent_session_id !== agentSessionId) continue;
    if (!["draft", "ready"].includes(record.status)) continue;
    record.status = "invalidated";
    record.updated_at = nowIso();
    writeJsonFile(filePath, record);
  }
}

function isSafeLocalTextPath(targetPath) {
  if (!targetPath || !path.isAbsolute(targetPath)) {
    return { ok: false, reason: "LOCAL_FILE_PATH_REQUIRED" };
  }
  const ext = path.extname(targetPath).toLowerCase();
  if (![".md", ".txt"].includes(ext)) {
    return { ok: false, reason: "LOCAL_FILE_UNSUPPORTED_EXTENSION" };
  }
  const normalized = path.resolve(targetPath);
  const parentDir = path.dirname(normalized);
  const tempDir = fs.existsSync(parentDir)
    ? fs.realpathSync.native(parentDir)
    : path.resolve(parentDir);
  const mineruTempPrefixes = [
    path.join("/var", "folders"),
    path.join("/private", "var", "folders")
  ];
  const explicitReadableRoots = [
    "/Users/hejiajiudeeyu/Documents",
    "/tmp"
  ];
  const inExplicitRoot = explicitReadableRoots.some((root) => normalized.startsWith(path.resolve(root) + path.sep) || normalized === path.resolve(root));
  const inMineruTemp = mineruTempPrefixes.some((prefix) => tempDir.startsWith(prefix));
  if (!inExplicitRoot && !inMineruTemp) {
    return { ok: false, reason: "LOCAL_FILE_PATH_NOT_ALLOWED" };
  }
  return { ok: true, path: normalized };
}

function readLocalTextFile(targetPath) {
  const guard = isSafeLocalTextPath(targetPath);
  if (!guard.ok) {
    return {
      status: 400,
      body: structuredError(guard.reason, "Local file path is not allowed or not supported", {
        path: targetPath || null
      })
    };
  }
  if (!fs.existsSync(guard.path)) {
    return {
      status: 404,
      body: structuredError("LOCAL_FILE_NOT_FOUND", "Local text file does not exist", {
        path: guard.path
      })
    };
  }
  const stats = fs.statSync(guard.path);
  if (!stats.isFile()) {
    return {
      status: 400,
      body: structuredError("LOCAL_FILE_NOT_REGULAR", "Local path must point to a regular file", {
        path: guard.path
      })
    };
  }
  const maxBytes = Number(process.env.LOCAL_TEXT_FILE_MAX_BYTES || 120000);
  const content = fs.readFileSync(guard.path, "utf8");
  const truncated = Buffer.byteLength(content, "utf8") > maxBytes;
  const finalContent = truncated ? content.slice(0, maxBytes) : content;
  return {
    status: 200,
    body: {
      ok: true,
      path: guard.path,
      content: finalContent,
      truncated,
      bytes_read: Buffer.byteLength(finalContent, "utf8")
    }
  };
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

function mapRequestState(request, result = null) {
  const resultPackage = result?.result_package || request?.result_package || null;
  return {
    request_id: request?.request_id || null,
    status: request?.status || "UNKNOWN",
    hotline_id: request?.hotline_id || resultPackage?.hotline_id || null,
    responder_id: request?.responder_id || resultPackage?.responder_id || null,
    result: resultPackage?.output || null,
    error: resultPackage?.error || null,
    result_package: resultPackage,
    human_summary: resultPackage?.human_summary || null
  };
}

function buildCallerSkillManifest() {
  return {
    skill: {
      name: "caller-skill",
      version: "0.1.0",
      mode: "local_only",
      description: "Progressive-disclosure caller skill for local hotline discovery, preparation, dispatch, and result reporting."
    },
    actions: [
      {
        name: "search_hotlines_brief",
        method: "POST",
        path: "/skills/caller/search-hotlines-brief",
        description: "Fuzzy narrowing from a large hotline space into a short candidate list."
      },
      {
        name: "search_hotlines_detailed",
        method: "POST",
        path: "/skills/caller/search-hotlines-detailed",
        description: "Detailed comparison for a small candidate set before selection."
      },
      {
        name: "read_hotline",
        method: "GET",
        path: "/skills/caller/hotlines/:hotlineId",
        description: "Read the selected hotline contract and caller-facing template."
      },
      {
        name: "prepare_request",
        method: "POST",
        path: "/skills/caller/prepare-request",
        description: "Validate and normalize candidate input against the hotline schema."
      },
      {
        name: "send_request",
        method: "POST",
        path: "/skills/caller/send-request",
        description: "Send a previously prepared request and optionally wait for terminal state."
      },
      {
        name: "report_response",
        method: "GET",
        path: "/skills/caller/requests/:requestId/report",
        description: "Read and normalize request terminal state for agent consumption."
      }
    ],
    orchestration: {
      search_phase_order: "flexible",
      execution_phase_order: [
        "read_hotline",
        "prepare_request",
        "send_request",
        "report_response"
      ],
      go_back_after_read_to: [
        "search_hotlines_brief",
        "search_hotlines_detailed"
      ],
      polling_owner: "adapter"
    }
  };
}

function mapCatalogBriefItem(item, score = null, matchReason = null) {
  return {
    hotline_id: item.hotline_id,
    display_name: item.display_name || item.hotline_id,
    short_description: item.description || null,
    task_types: item.task_types || [],
    source: item.review_status && item.review_status !== "local_only" ? "platform" : "local",
    match_reason: matchReason,
    score
  };
}

function mapCatalogDetailedItem(item, draftInfo = null) {
  const draft = draftInfo?.draft || null;
  return {
    hotline_id: item.hotline_id,
    responder_id: item.responder_id,
    display_name: draft?.display_name || item.display_name || item.hotline_id,
    description: draft?.description || item.description || null,
    input_summary: draft?.input_summary || draft?.summary || null,
    output_summary: draft?.output_summary || null,
    task_types: draft?.task_types || item.task_types || [],
    draft_ready: Boolean(draft),
    local_only: !item.review_status || item.review_status === "local_only",
    review_status: item.review_status || "local_only"
  };
}

function computeCatalogMatch(item, queryTerms = [], taskGoalTerms = [], taskType = null) {
  const haystacks = [
    item.hotline_id,
    item.display_name,
    item.description,
    ...(item.task_types || []),
    ...(item.capabilities || []),
    ...(item.tags || [])
  ]
    .filter(Boolean)
    .map((entry) => String(entry).toLowerCase());

  const allTerms = [...queryTerms, ...taskGoalTerms].filter(Boolean);
  let score = 0;
  const matched = new Set();

  for (const term of allTerms) {
    if (haystacks.some((value) => value.includes(term))) {
      score += queryTerms.includes(term) ? 2 : 1;
      matched.add(term);
    }
  }

  if (taskType && (item.task_types || []).some((entry) => String(entry).toLowerCase() === taskType.toLowerCase())) {
    score += 3;
    matched.add(`task_type:${taskType}`);
  }

  const matchReason = matched.size > 0 ? `matches ${Array.from(matched).join(", ")}` : null;
  return { score, matchReason };
}

function tokenizeSearchText(value) {
  return normalizedString(value)
    ? normalizedString(value)
        .toLowerCase()
        .split(/[^a-z0-9._-]+/i)
        .map((term) => term.trim())
        .filter(Boolean)
    : [];
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
      request_id: requestId,
      status: "PENDING",
      result: null,
      error: {
        code: "SKILL_WAIT_TIMEOUT",
        message: "request did not reach terminal state before skill timeout",
        retryable: true
      },
      result_package: null,
      human_summary: null
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
        hotline_id: hotlineId,
        responder_id: responderId
      })
    };
  }
  return {
    status: 200,
    body: selected
  };
}

function loadHotlineDraft(hotlineId) {
  const draftFile = getHotlineRegistrationDraftFile(hotlineId);
  return {
    draft_file: draftFile,
    draft: readJsonFile(draftFile, null)
  };
}

function buildReadHotlineResponse(selected, draftInfo) {
  const draft = draftInfo.draft || {};
  return {
    hotline_id: selected.hotline_id,
    responder_id: selected.responder_id,
    display_name: draft.display_name || selected.display_name || selected.hotline_id,
    description: draft.description || selected.description || null,
    input_summary: draft.input_summary || draft.summary || null,
    output_summary: draft.output_summary || null,
    input_schema: draft.input_schema || null,
    output_schema: draft.output_schema || null,
    draft_ready: Boolean(draftInfo.draft),
    draft_file: draftInfo.draft_file,
    local_only: !selected.review_status || selected.review_status === "local_only",
    review_status: selected.review_status || "local_only",
    task_types: draft.task_types || selected.task_types || [],
    output_display_hints: displayHintsMap.get(selected.hotline_id) ?? null
  };
}

function normalizeValueBySchema(schema, value, field, errors, warnings) {
  if (!schema || typeof schema !== "object") {
    return value;
  }
  const type = schema.type;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push({
      field,
      code: "INVALID_ENUM_VALUE",
      message: `${field} must be one of: ${schema.enum.join(", ")}`
    });
    return value;
  }
  if (!type) {
    return value;
  }
  switch (type) {
    case "string": {
      if (typeof value !== "string") {
        errors.push({
          field,
          code: "INVALID_TYPE",
          message: `${field} must be a string`
        });
        return value;
      }
      const trimmed = value.trim();
      if (value !== trimmed) {
        warnings.push({
          field,
          code: "STRING_TRIMMED",
          message: `${field} was trimmed`
        });
      }
      return trimmed;
    }
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push({
          field,
          code: "INVALID_TYPE",
          message: `${field} must be a number`
        });
      }
      return value;
    case "integer":
      if (!Number.isInteger(value)) {
        errors.push({
          field,
          code: "INVALID_TYPE",
          message: `${field} must be an integer`
        });
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        errors.push({
          field,
          code: "INVALID_TYPE",
          message: `${field} must be a boolean`
        });
      }
      return value;
    case "array":
      if (!Array.isArray(value)) {
        errors.push({
          field,
          code: "INVALID_TYPE",
          message: `${field} must be an array`
        });
      }
      return value;
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push({
          field,
          code: "INVALID_TYPE",
          message: `${field} must be an object`
        });
      }
      return value;
    default:
      return value;
  }
}

function validatePreparedInput(inputSchema, candidateInput) {
  const errors = [];
  const warnings = [];
  if (!inputSchema || typeof inputSchema !== "object" || inputSchema.type !== "object") {
    return {
      normalized_input: candidateInput || {},
      errors: [
        {
          field: null,
          code: "HOTLINE_INPUT_SCHEMA_UNSUPPORTED",
          message: "hotline input schema must be an object schema"
        }
      ],
      warnings
    };
  }
  const input = candidateInput && typeof candidateInput === "object" && !Array.isArray(candidateInput) ? candidateInput : {};
  const properties = inputSchema.properties && typeof inputSchema.properties === "object" ? inputSchema.properties : {};
  const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
  const additionalProperties = inputSchema.additionalProperties;
  const normalized = {};

  for (const [field, value] of Object.entries(input)) {
    if (!Object.prototype.hasOwnProperty.call(properties, field)) {
      if (additionalProperties === false) {
        errors.push({
          field,
          code: "UNEXPECTED_FIELD",
          message: `${field} is not allowed by the hotline input schema`
        });
      } else {
        normalized[field] = value;
      }
      continue;
    }
    normalized[field] = normalizeValueBySchema(properties[field], value, field, errors, warnings);
  }

  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) {
      errors.push({
        field,
        code: "REQUIRED_FIELD_MISSING",
        message: `${field} is required`
      });
      continue;
    }
    const def = properties[field];
    if (def?.type === "string" && typeof normalized[field] === "string" && normalized[field].length === 0) {
      errors.push({
        field,
        code: "EMPTY_STRING_NOT_ALLOWED",
        message: `${field} must not be empty`
      });
    }
  }

  return {
    normalized_input: normalized,
    errors,
    warnings
  };
}

function buildPreparedRequestRecord({ hotlineId, selected, draft, normalizedInput, errors, warnings, agentSessionId }) {
  const preparedRequestId = generatePreparedRequestId();
  const status = errors.length > 0 ? "draft" : "ready";
  const createdAt = nowIso();
  return {
    prepared_request_id: preparedRequestId,
    hotline_id: hotlineId,
    responder_id: selected.responder_id,
    task_type: draft?.task_types?.[0] || selected.task_types?.[0] || null,
    expected_signer_public_key_pem: selected.responder_public_key_pem || null,
    output_schema: draft?.output_schema || null,
    normalized_input: normalizedInput,
    errors,
    warnings,
    review: {
      required: false,
      status: "not_required"
    },
    status,
    request_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    source_agent_session_id: agentSessionId
  };
}

function preparedRequestExpired(record) {
  return Boolean(record?.expires_at) && Date.parse(record.expires_at) <= Date.now();
}

async function buildRequestReport(requestId) {
  const request = await requestJson(callerBaseUrl(), `/controller/requests/${encodeURIComponent(requestId)}`);
  if (request.status !== 200) {
    return request;
  }
  const result = await requestJson(callerBaseUrl(), `/controller/requests/${encodeURIComponent(requestId)}/result`);
  return {
    status: 200,
    body: mapRequestState(request.body, result.body)
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

      if (method === "GET" && pathname === "/skills/caller/manifest") {
        sendJson(res, 200, buildCallerSkillManifest());
        return;
      }

      if (method === "POST" && pathname === "/skills/local-file/read") {
        const body = await parseJsonBody(req);
        const result = readLocalTextFile(normalizedString(body.path));
        sendJson(res, result.status, result.body);
        return;
      }

      if (method === "POST" && pathname === "/skills/caller/search-hotlines-brief") {
        const body = await parseJsonBody(req);
        const queryTerms = tokenizeSearchText(body.query);
        const taskGoalTerms = tokenizeSearchText(body.task_goal || body.taskGoal);
        const taskType = normalizedString(body.task_type || body.taskType);
        const limit = Math.max(1, Math.min(Number(body.limit || 8), 25));
        const catalog = await requestJson(callerBaseUrl(), "/controller/hotlines");
        if (catalog.status !== 200) {
          sendJson(res, catalog.status, catalog.body);
          return;
        }

        const ranked = (catalog.body?.items || [])
          .map((item) => {
            const { score, matchReason } = computeCatalogMatch(item, queryTerms, taskGoalTerms, taskType);
            return {
              item: mapCatalogBriefItem(item, score, matchReason),
              score
            };
          })
          .filter((entry) => queryTerms.length === 0 && taskGoalTerms.length === 0 && !taskType ? true : entry.score > 0)
          .sort((left, right) => right.score - left.score || left.item.hotline_id.localeCompare(right.item.hotline_id))
          .slice(0, limit)
          .map((entry) => entry.item);

        sendJson(res, 200, { items: ranked });
        return;
      }

      if (method === "POST" && pathname === "/skills/caller/search-hotlines-detailed") {
        const body = await parseJsonBody(req);
        const hotlineIds = Array.isArray(body.hotline_ids || body.hotlineIds)
          ? (body.hotline_ids || body.hotlineIds).map((entry) => normalizedString(entry)).filter(Boolean)
          : [];
        if (hotlineIds.length === 0) {
          sendJson(res, 400, structuredError("HOTLINE_IDS_REQUIRED", "hotline_ids must contain at least one hotline id"));
          return;
        }

        const catalog = await requestJson(callerBaseUrl(), "/controller/hotlines");
        if (catalog.status !== 200) {
          sendJson(res, catalog.status, catalog.body);
          return;
        }

        const items = hotlineIds
          .map((hotlineId) => (catalog.body?.items || []).find((item) => item.hotline_id === hotlineId))
          .filter(Boolean)
          .map((item) => mapCatalogDetailedItem(item, loadHotlineDraft(item.hotline_id)));

        sendJson(res, 200, { items });
        return;
      }

      const readHotlineMatch = pathname.match(/^\/skills\/caller\/hotlines\/([^/]+)$/);
      if (method === "GET" && readHotlineMatch) {
        const hotlineId = decodeURIComponent(readHotlineMatch[1]);
        const target = await resolveCatalogTarget(hotlineId);
        if (target.status !== 200) {
          sendJson(res, target.status, target.body);
          return;
        }
        const draftInfo = loadHotlineDraft(hotlineId);
        if (!draftInfo.draft) {
          sendJson(res, 404, structuredError("HOTLINE_DRAFT_NOT_FOUND", "hotline registration draft was not found", {
            hotline_id: hotlineId,
            draft_file: draftInfo.draft_file
          }));
          return;
        }
        sendJson(res, 200, buildReadHotlineResponse(target.body, draftInfo));
        return;
      }

      if (method === "POST" && pathname === "/skills/caller/prepare-request") {
        const body = await parseJsonBody(req);
        const hotlineId = normalizedString(body.hotline_id || body.hotlineId);
        if (!hotlineId) {
          sendJson(res, 400, structuredError("HOTLINE_ID_REQUIRED", "hotline_id is required"));
          return;
        }
        const target = await resolveCatalogTarget(hotlineId, normalizedString(body.responder_id || body.responderId));
        if (target.status !== 200) {
          sendJson(res, target.status, target.body);
          return;
        }
        const draftInfo = loadHotlineDraft(hotlineId);
        if (!draftInfo.draft) {
          sendJson(res, 404, structuredError("HOTLINE_DRAFT_NOT_FOUND", "hotline registration draft was not found", {
            hotline_id: hotlineId,
            draft_file: draftInfo.draft_file
          }));
          return;
        }

        const agentSessionId = normalizedString(body.agent_session_id || body.agentSessionId);
        invalidatePriorPreparedRequests(hotlineId, agentSessionId);

        const validation = validatePreparedInput(draftInfo.draft.input_schema, body.input);
        const record = buildPreparedRequestRecord({
          hotlineId,
          selected: target.body,
          draft: draftInfo.draft,
          normalizedInput: validation.normalized_input,
          errors: validation.errors,
          warnings: validation.warnings,
          agentSessionId
        });
        savePreparedRequest(record);

        sendJson(res, 200, {
          prepared_request_id: record.prepared_request_id,
          hotline_id: record.hotline_id,
          status: record.status,
          normalized_input: record.normalized_input,
          errors: record.errors,
          warnings: record.warnings,
          review: record.review,
          expires_at: record.expires_at
        });
        return;
      }

      if (method === "POST" && pathname === "/skills/caller/send-request") {
        const body = await parseJsonBody(req);
        const preparedRequestId = normalizedString(body.prepared_request_id || body.preparedRequestId);
        if (!preparedRequestId) {
          sendJson(res, 400, structuredError("PREPARED_REQUEST_ID_REQUIRED", "prepared_request_id is required"));
          return;
        }
        const { filePath, record } = loadPreparedRequest(preparedRequestId);
        if (!record) {
          sendJson(res, 404, structuredError("PREPARED_REQUEST_NOT_FOUND", "prepared request was not found", {
            prepared_request_id: preparedRequestId
          }));
          return;
        }
        if (preparedRequestExpired(record)) {
          record.status = "expired";
          record.updated_at = nowIso();
          writeJsonFile(filePath, record);
          sendJson(res, 409, structuredError("PREPARED_REQUEST_EXPIRED", "prepared request has expired", {
            prepared_request_id: preparedRequestId
          }));
          return;
        }
        if (record.status !== "ready") {
          sendJson(res, 409, structuredError("PREPARED_REQUEST_NOT_READY", "prepared request is not ready to send", {
            prepared_request_id: preparedRequestId,
            status: record.status,
            errors: record.errors || []
          }));
          return;
        }

        const createBody = {
          responder_id: record.responder_id,
          hotline_id: record.hotline_id,
          expected_signer_public_key_pem: record.expected_signer_public_key_pem,
          task_type: record.task_type,
          input: record.normalized_input,
          payload: record.normalized_input,
          output_schema: record.output_schema
        };

        const created = await requestJson(callerBaseUrl(), "/controller/requests", {
          method: "POST",
          body: createBody
        });
        if (created.status !== 201) {
          sendJson(res, created.status, created.body);
          return;
        }

        const requestId = created.body?.request_id;
        await requestJson(callerBaseUrl(), `/controller/requests/${encodeURIComponent(requestId)}/contract-draft`, {
          method: "POST",
          body: {
            ...createBody,
            task_input: record.normalized_input
          }
        });

        const dispatched = await requestJson(callerBaseUrl(), `/controller/requests/${encodeURIComponent(requestId)}/dispatch`, {
          method: "POST",
          body: {
            ...createBody,
            task_input: record.normalized_input
          }
        });
        if (![200, 202].includes(dispatched.status)) {
          sendJson(res, dispatched.status, dispatched.body);
          return;
        }

        record.status = "sent";
        record.request_id = requestId;
        record.updated_at = nowIso();
        writeJsonFile(filePath, record);

        const wait = body.wait !== false;
        if (!wait) {
          sendJson(res, 202, {
            request_id: requestId,
            hotline_id: record.hotline_id,
            status: "PENDING"
          });
          return;
        }

        const terminal = await waitForTerminalRequest(requestId);
        sendJson(res, terminal.status, terminal.body);
        return;
      }

      const reportMatch = pathname.match(/^\/skills\/caller\/requests\/([^/]+)\/report$/);
      if (method === "GET" && reportMatch) {
        const requestId = decodeURIComponent(reportMatch[1]);
        const report = await buildRequestReport(requestId);
        sendJson(res, report.status, report.body);
        return;
      }

      sendJson(res, 404, structuredError("NOT_FOUND", "unknown route"));
    } catch (error) {
      sendJson(
        res,
        500,
        structuredError("SKILL_ADAPTER_RUNTIME_ERROR", error instanceof Error ? error.message : "unknown_error")
      );
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT || 8091);
  const server = createCallerSkillAdapterServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`[caller-skill-adapter] listening on ${port}`);
  });
}
