import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildStructuredError } from "@delexec/contracts";
import {
  buildHotlineOnboardingBody,
  ensureHotlineRegistrationDraft,
  buildTransportEnvUpdates,
  buildTransportSecretUpdates,
  ensureResponderIdentity,
  ensureOpsState,
  hasEncryptedSecretStore,
  listLegacySecretKeys,
  loadHotlineRegistrationDraft,
  normalizeTransportConfig,
  OPS_SECRET_KEYS,
  readTransportSecretsFromEnv,
  readResolvedOpsSecrets,
  redactTransportConfig,
  removeHotline,
  saveOpsState,
  scrubLegacySecrets,
  setHotlineEnabled,
  unlockOpsSecrets,
  upsertHotline,
  writeOpsSecrets
} from "./config.js";
import {
  buildExampleRequestBody,
  buildExampleHotlineDefinition,
  LOCAL_EXAMPLE_DISPLAY_NAME,
  LOCAL_EXAMPLE_HOTLINE_ID
} from "./example-hotline.js";
import {
  appendServiceLog,
  appendSupervisorEvent,
  getServiceLogFile,
  getSupervisorEventsFile,
  readServiceLogTail,
  readSupervisorEventTail
} from "./logging.js";
import {
  ensureOpsDirectories,
  getOpsHomeDir,
  initializeSecretStore,
  rotateSecretStorePassphrase,
  writeJsonFile
} from "@delexec/runtime-utils";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function getOpsSessionStateFile() {
  return path.join(getOpsHomeDir(), "run", "session.json");
}

function nowIso() {
  return new Date().toISOString();
}

function persistActiveSession(session) {
  ensureOpsDirectories();
  const sessionStateFile = getOpsSessionStateFile();
  if (!session?.token) {
    if (fs.existsSync(sessionStateFile)) {
      fs.rmSync(sessionStateFile, { force: true });
    }
    return;
  }
  writeJsonFile(sessionStateFile, {
    token: session.token,
    expires_at: session.expires_at
  });
}

function clearActiveSession() {
  persistActiveSession(null);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization, X-Ops-Session"
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, code, message, { retryable, ...extra } = {}) {
  sendJson(res, statusCode, buildStructuredError(code, message, { retryable, ...extra }));
}

function parseJsonBody(req) {
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

async function requestJson(baseUrl, pathname, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      ...headers,
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

function processBaseUrl(port) {
  return `http://127.0.0.1:${port}`;
}

function appendPath(baseUrl, pathname) {
  return new URL(pathname, `${baseUrl}/`).toString();
}

function parseJsonArrayEnv(value) {
  const normalized = normalizedString(value);
  if (!normalized) {
    return [];
  }
  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [normalized];
  } catch {
    return normalized.split(/\s+/).filter(Boolean);
  }
}

function normalizedString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

const OPS_SESSION_HEADER = "x-ops-session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function createSessionToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

function buildTransportSecretLookup(secrets) {
  return {
    [OPS_SECRET_KEYS.transport_emailengine_access_token]: secrets.transport.emailengine.access_token,
    [OPS_SECRET_KEYS.transport_gmail_client_secret]: secrets.transport.gmail.client_secret,
    [OPS_SECRET_KEYS.transport_gmail_refresh_token]: secrets.transport.gmail.refresh_token
  };
}

function buildLegacyTransportSecretEnv(secretUpdates) {
  return {
    TRANSPORT_EMAILENGINE_ACCESS_TOKEN: secretUpdates[OPS_SECRET_KEYS.transport_emailengine_access_token] || undefined,
    TRANSPORT_GMAIL_CLIENT_SECRET: secretUpdates[OPS_SECRET_KEYS.transport_gmail_client_secret] || undefined,
    TRANSPORT_GMAIL_REFRESH_TOKEN: secretUpdates[OPS_SECRET_KEYS.transport_gmail_refresh_token] || undefined
  };
}

function mergeEnvWithResolvedSecrets(env, secrets) {
  return {
    ...env,
    CALLER_PLATFORM_API_KEY: secrets.caller_api_key || env.CALLER_PLATFORM_API_KEY || env.PLATFORM_API_KEY || "",
    PLATFORM_API_KEY: secrets.caller_api_key || env.PLATFORM_API_KEY || env.CALLER_PLATFORM_API_KEY || "",
    RESPONDER_PLATFORM_API_KEY: secrets.responder_platform_api_key || env.RESPONDER_PLATFORM_API_KEY || "",
    PLATFORM_ADMIN_API_KEY: secrets.platform_admin_api_key || env.PLATFORM_ADMIN_API_KEY || "",
    ...buildTransportSecretLookup(secrets)
  };
}

function pruneExpiredSessions(runtime) {
  const now = Date.now();
  for (const [token, session] of runtime.auth.sessions.entries()) {
    if (session.expiresAt <= now) {
      runtime.auth.sessions.delete(token);
    }
  }
  if (runtime.auth.sessions.size === 0) {
    runtime.auth.unlockedSecrets = null;
    runtime.auth.passphrase = null;
    runtime.auth.unlockedAt = null;
    clearActiveSession();
  }
}

function createAuthenticatedSession(runtime, passphrase, secrets) {
  pruneExpiredSessions(runtime);
  const token = createSessionToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  runtime.auth.passphrase = passphrase;
  runtime.auth.unlockedSecrets = secrets;
  runtime.auth.unlockedAt = nowIso();
  runtime.auth.sessions.set(token, {
    token,
    createdAt: nowIso(),
    expiresAt
  });
  const session = {
    token,
    expires_at: new Date(expiresAt).toISOString()
  };
  persistActiveSession(session);
  return session;
}

function readSessionToken(req) {
  const headerValue = req.headers[OPS_SESSION_HEADER];
  if (Array.isArray(headerValue)) {
    return headerValue[0] || null;
  }
  return normalizedString(headerValue);
}

function getCurrentSession(runtime, req) {
  pruneExpiredSessions(runtime);
  const token = readSessionToken(req);
  if (!token) {
    return null;
  }
  const session = runtime.auth.sessions.get(token);
  if (!session) {
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  const activeSession = {
    token,
    expires_at: new Date(session.expiresAt).toISOString()
  };
  persistActiveSession(activeSession);
  return activeSession;
}

function isLocalResponderConfigRoute(method, pathname) {
  if (method === "POST" && (pathname === "/responder/hotlines" || pathname === "/responder/hotlines/example")) {
    return true;
  }
  if (method === "DELETE" && /^\/responder\/hotlines\/[^/]+$/.test(pathname)) {
    return true;
  }
  if (method === "POST" && /^\/responder\/hotlines\/[^/]+\/(enable|disable)$/.test(pathname)) {
    return true;
  }
  return false;
}

function isProtectedRoute(method, pathname) {
  if (
    pathname === "/healthz" ||
    pathname === "/status" ||
    pathname === "/setup" ||
    pathname === "/mcp-adapter/spec" ||
    pathname.startsWith("/auth/session")
  ) {
    return false;
  }
  if (isLocalResponderConfigRoute(method, pathname)) {
    return false;
  }
  if (method === "GET" && pathname === "/") {
    return false;
  }
  return true;
}

function buildResponderRuntimeStatus(state, runtime, hotlineId = null) {
  const responderProcess = runtime.processes.get("responder") || null;
  const configuredHotlineIds = (state.config.responder?.hotlines || []).map((item) => item.hotline_id).filter(Boolean);
  return {
    responder_running: Boolean(responderProcess && !responderProcess.exited),
    responder_healthy: Boolean(responderProcess?.health?.status === 200),
    configured_hotline_ids: configuredHotlineIds,
    hotline_configured: hotlineId ? configuredHotlineIds.includes(hotlineId) : null
  };
}

function platformFeaturesEnabled(state) {
  return state.config?.platform?.enabled === true;
}

function serializeHotlineForUi(state, runtime, hotline) {
  const draftFile = hotline?.metadata?.registration?.draft_file || null;
  const localIntegrationFile = hotline?.metadata?.local?.integration_file || null;
  const localHookFile = hotline?.metadata?.local?.hook_file || null;
  const runtimeStatus = buildResponderRuntimeStatus(state, runtime, hotline?.hotline_id || null);
  return {
    ...hotline,
    draft_ready: Boolean(draftFile),
    draft_file: draftFile,
    local_integration_file: localIntegrationFile,
    local_hook_file: localHookFile,
    runtime_loaded: Boolean(runtimeStatus.responder_running && hotline?.enabled !== false && runtimeStatus.hotline_configured),
    local_status: hotline?.enabled === false ? "disabled" : draftFile ? "draft_ready" : "configured"
  };
}

function getAuthState(runtime, state) {
  pruneExpiredSessions(runtime);
  const configured = hasEncryptedSecretStore();
  const legacySecretKeys = listLegacySecretKeys(state);
  const activeSession = runtime.auth.sessions.values().next().value || null;
  return {
    configured,
    secret_file: state.secretsFile,
    legacy_secret_keys: legacySecretKeys,
    legacy_secret_source_present: legacySecretKeys.length > 0,
    locked: configured && runtime.auth.sessions.size === 0,
    authenticated: configured ? runtime.auth.sessions.size > 0 : true,
    setup_required: !configured,
    expires_at: activeSession ? new Date(activeSession.expiresAt).toISOString() : null
  };
}

function getRecoverableSession(runtime) {
  pruneExpiredSessions(runtime);
  const activeSession = runtime.auth.sessions.values().next().value || null;
  if (!activeSession) {
    return null;
  }
  return {
    token: activeSession.token,
    expires_at: new Date(activeSession.expiresAt).toISOString()
  };
}

function requireAuthenticatedSession(req, res, runtime, state) {
  if (!hasEncryptedSecretStore()) {
    return { ok: true, session: null };
  }
  const session = getCurrentSession(runtime, req);
  if (!session) {
    sendError(res, 401, "AUTH_SESSION_REQUIRED", "local supervisor session is locked or missing", {
      retryable: false,
      auth: getAuthState(runtime, state)
    });
    return { ok: false, session: null };
  }
  return { ok: true, session };
}

function normalizeTransportPayload(body = {}) {
  return normalizeTransportConfig({ runtime: { transport: body } }, {});
}

function validateTransportConfig(transport) {
  if (!["local", "relay_http", "email"].includes(transport.type)) {
    return { status: 400, body: buildStructuredError("CONTRACT_INVALID_TRANSPORT_TYPE", "unsupported transport type") };
  }
  if (transport.type === "relay_http" && !normalizedString(transport.relay_http?.base_url)) {
    return { status: 400, body: buildStructuredError("CONTRACT_INVALID_TRANSPORT_BODY", "relay_http.base_url is required") };
  }
  if (transport.type === "email") {
    if (!["emailengine", "gmail"].includes(transport.email.provider)) {
      return { status: 400, body: buildStructuredError("CONTRACT_INVALID_TRANSPORT_BODY", "unsupported email provider") };
    }
    if (!normalizedString(transport.email.sender)) {
      return { status: 400, body: buildStructuredError("CONTRACT_INVALID_TRANSPORT_BODY", "email.sender is required") };
    }
    if (!normalizedString(transport.email.receiver)) {
      return { status: 400, body: buildStructuredError("CONTRACT_INVALID_TRANSPORT_BODY", "email.receiver is required") };
    }
    if (transport.email.provider === "emailengine") {
      if (!normalizedString(transport.email.emailengine?.base_url) || !normalizedString(transport.email.emailengine?.account)) {
        return {
          status: 400,
          body: buildStructuredError("CONTRACT_INVALID_TRANSPORT_BODY", "email.emailengine.base_url and account are required")
        };
      }
    }
    if (transport.email.provider === "gmail" && (!normalizedString(transport.email.gmail?.client_id) || !normalizedString(transport.email.gmail?.user))) {
      return {
        status: 400,
        body: buildStructuredError("CONTRACT_INVALID_TRANSPORT_BODY", "email.gmail.client_id and user are required")
      };
    }
  }
  return null;
}

function getRuntimeTransport(state) {
  return normalizeTransportConfig(state.config, state.env);
}

function getResolvedSecrets(state, runtime) {
  return readResolvedOpsSecrets(state, runtime.auth.unlockedSecrets);
}

function getTransportResponse(state, runtime) {
  return redactTransportConfig(state.config.runtime?.transport || {}, mergeEnvWithResolvedSecrets(state.env, getResolvedSecrets(state, runtime)));
}

function buildPlatformHeaders(state, runtime) {
  const secrets = getResolvedSecrets(state, runtime);
  return secrets.caller_api_key ? { "X-Platform-Api-Key": secrets.caller_api_key } : {};
}

function findConfiguredExampleHotline(state) {
  return (state.config.responder?.hotlines || []).find((item) => item.hotline_id === LOCAL_EXAMPLE_HOTLINE_ID) || null;
}

function buildExampleVisibilityError(example) {
  if (!example) {
    return {
      status: 404,
      body: buildStructuredError("EXAMPLE_HOTLINE_NOT_CONFIGURED", "official example hotline is not configured locally", {
        stage: "add_example_hotline"
      })
    };
  }
  if (example.submitted_for_review !== true) {
    return {
      status: 409,
      body: buildStructuredError("EXAMPLE_REVIEW_NOT_SUBMITTED", "official example hotline must be submitted for review first", {
        stage: "submit_review"
      })
    };
  }
  return {
    status: 409,
    body: buildStructuredError("EXAMPLE_NOT_VISIBLE_IN_CATALOG", "official example hotline is not yet visible in catalog", {
      stage: "approve_and_catalog",
      review_status: example.review_status || "pending"
    })
  };
}

function ensurePreferenceState(state) {
  state.config.preferences ||= { task_types: {} };
  state.config.preferences.task_types ||= {};
  return state.config.preferences.task_types;
}

function normalizeTaskTypeKey(taskType) {
  return normalizedString(taskType)?.toLowerCase() || null;
}

function getTaskTypePreference(state, taskType) {
  const key = normalizeTaskTypeKey(taskType);
  if (!key) {
    return null;
  }
  return ensurePreferenceState(state)[key] || null;
}

function setTaskTypePreference(state, taskType, preference) {
  const key = normalizeTaskTypeKey(taskType);
  if (!key) {
    return null;
  }
  const preferences = ensurePreferenceState(state);
  if (!preference || !preference.hotline_id) {
    delete preferences[key];
    return null;
  }
  preferences[key] = {
    task_type: key,
    hotline_id: preference.hotline_id,
    responder_id: preference.responder_id || null,
    updated_at: nowIso()
  };
  return preferences[key];
}

function summarizeCandidate(item, { selected = false, taskType = null, preferred = false } = {}) {
  const taskTypeMatched = taskType ? (item.task_types || []).includes(taskType) : false;
  const reasons = [];
  if (selected) {
    reasons.push("agent_selected");
  }
  if (preferred) {
    reasons.push("task_type_preference");
  }
  if (taskTypeMatched) {
    reasons.push("task_type_match");
  }
  if (item.availability_status === "healthy") {
    reasons.push("healthy");
  }
  if ((item.capabilities || []).length > 0) {
    reasons.push("capability_signal");
  }
  return {
    hotline_id: item.hotline_id,
    responder_id: item.responder_id,
    display_name: item.display_name || item.hotline_id,
    responder_display_name: item.responder_display_name || item.responder_id,
    task_types: item.task_types || [],
    capabilities: item.capabilities || [],
    tags: item.tags || [],
    availability_status: item.availability_status || "unknown",
    signer_public_key_pem: item.responder_public_key_pem || null,
    template_summary: item.template_ref
      ? {
          template_ref: item.template_ref,
          input_properties: Object.keys(item.input_schema?.properties || {}),
          output_properties: Object.keys(item.output_schema?.properties || {})
        }
      : null,
    difference_note: preferred
      ? "Matches your remembered task-type preference."
      : taskTypeMatched
        ? "Matches the current task type."
        : "Available as a fallback responder route.",
    match_reasons: reasons
  };
}

function scoreCandidate(item, { taskType = null, responderId = null, hotlineId = null, preferred = null } = {}) {
  let score = 0;
  if (hotlineId && item.hotline_id === hotlineId) {
    score += 120;
  }
  if (responderId && item.responder_id === responderId) {
    score += 80;
  }
  if (preferred && item.hotline_id === preferred.hotline_id) {
    score += 60;
    if (!preferred.responder_id || preferred.responder_id === item.responder_id) {
      score += 20;
    }
  }
  if (taskType && (item.task_types || []).includes(taskType)) {
    score += 40;
  }
  if (item.availability_status === "healthy") {
    score += 15;
  }
  if (item.review_status === "approved") {
    score += 10;
  }
  score += Math.min((item.capabilities || []).length, 5);
  return score;
}

async function fetchCatalogCandidates(state, runtime, filters = {}) {
  if (!platformFeaturesEnabled(state)) {
    return listLocalCatalogHotlines(state, runtime, filters);
  }
  const params = new URLSearchParams();
  if (filters.hotline_id) {
    params.set("hotline_id", filters.hotline_id);
  }
  if (filters.responder_id) {
    params.set("responder_id", filters.responder_id);
  }
  if (filters.task_type) {
    params.set("task_type", filters.task_type);
  }
  if (filters.capability) {
    params.set("capability", filters.capability);
  }

  const response = await requestJson(
    processBaseUrl(state.config.runtime.ports.caller),
    `/controller/hotlines${params.toString() ? `?${params.toString()}` : ""}`,
    {
      headers: buildPlatformHeaders(state, runtime)
    }
  );
  return response.body?.items || [];
}

function buildLocalCatalogHotline(state, runtime, hotline) {
  const responderIdentity = ensureResponderIdentity(state);
  const { draft } = loadHotlineRegistrationDraft(state, hotline);
  const runtimeStatus = buildResponderRuntimeStatus(state, runtime, hotline.hotline_id);
  const source = draft || {};
  return {
    responder_id: state.config.responder.responder_id || responderIdentity.responder_id,
    hotline_id: hotline.hotline_id,
    display_name: source.display_name || hotline.display_name || hotline.hotline_id,
    description: source.description || null,
    summary: source.summary || null,
    status: hotline.enabled === false ? "disabled" : "enabled",
    review_status: hotline.review_status || "local_only",
    submission_version: null,
    submitted_at: null,
    reviewed_at: null,
    reviewed_by: null,
    review_reason: null,
    availability_status:
      runtimeStatus.responder_running && hotline.enabled !== false && runtimeStatus.hotline_configured ? "healthy" : "offline",
    last_heartbeat_at: null,
    template_ref: source.template_ref || `docs/templates/hotlines/${hotline.hotline_id}/`,
    task_types: source.task_types || hotline.task_types || [],
    capabilities: source.capabilities || hotline.capabilities || [],
    tags: source.tags || hotline.tags || [],
    recommended_for: Array.isArray(source.recommended_for) ? source.recommended_for : [],
    not_recommended_for: Array.isArray(source.not_recommended_for) ? source.not_recommended_for : [],
    limitations: Array.isArray(source.limitations) ? source.limitations : [],
    input_summary: source.input_summary || null,
    output_summary: source.output_summary || null,
    input_schema: source.input_schema || null,
    output_schema: source.output_schema || null,
    input_attachments: source.input_attachments || null,
    output_attachments: source.output_attachments || null,
    input_examples: Array.isArray(source.input_examples) ? source.input_examples : null,
    output_examples: Array.isArray(source.output_examples) ? source.output_examples : null,
    responder_public_key_pem: responderIdentity.public_key_pem,
    responder_public_keys_pem: responderIdentity.public_key_pem ? [responderIdentity.public_key_pem] : [],
    catalog_visibility: "local",
    source: "local"
  };
}

function listLocalCatalogHotlines(state, runtime, filters = {}) {
  return (state.config.responder?.hotlines || [])
    .filter((item) => item.enabled !== false)
    .map((item) => buildLocalCatalogHotline(state, runtime, item))
    .filter((item) => {
      if (filters.hotline_id && item.hotline_id !== filters.hotline_id) {
        return false;
      }
      if (filters.responder_id && item.responder_id !== filters.responder_id) {
        return false;
      }
      if (filters.task_type && !(item.task_types || []).includes(filters.task_type)) {
        return false;
      }
      if (filters.capability && !(item.capabilities || []).includes(filters.capability)) {
        return false;
      }
      return true;
    });
}


async function testRelayTransport(baseUrl) {
  try {
    const response = await fetch(new URL("/healthz", baseUrl));
    return {
      ok: response.ok,
      kind: "relay_http",
      status: response.status,
      detail: response.ok ? "relay_health_ok" : "relay_health_failed"
    };
  } catch (error) {
    return {
      ok: false,
      kind: "relay_http",
      error: buildStructuredError("TRANSPORT_CONNECTION_FAILED", error instanceof Error ? error.message : "unknown_error")
    };
  }
}

async function testEmailEngineTransport(transport, secrets) {
  if (!secrets.emailengine.access_token) {
    return {
      ok: false,
      kind: "emailengine",
      error: buildStructuredError("AUTH_CREDENTIALS_MISSING", "EmailEngine access token is not configured")
    };
  }

  try {
    const response = await fetch(
      new URL(`/v1/account/${encodeURIComponent(transport.email.emailengine.account)}`, transport.email.emailengine.base_url),
      {
        headers: {
          Authorization: `Bearer ${secrets.emailengine.access_token}`
        }
      }
    );
    if (!response.ok) {
      return {
        ok: false,
        kind: "emailengine",
        status: response.status,
        error: buildStructuredError("AUTH_INVALID_CREDENTIALS", `EmailEngine returned ${response.status}`)
      };
    }
    return {
      ok: true,
      kind: "emailengine",
      status: response.status,
      detail: "emailengine_auth_ok"
    };
  } catch (error) {
    return {
      ok: false,
      kind: "emailengine",
      error: buildStructuredError("TRANSPORT_CONNECTION_FAILED", error instanceof Error ? error.message : "unknown_error")
    };
  }
}

async function getGmailAccessToken(transport, secrets) {
  if (!secrets.gmail.client_secret || !secrets.gmail.refresh_token) {
    return {
      ok: false,
      error: buildStructuredError("AUTH_CREDENTIALS_MISSING", "Gmail client secret or refresh token is not configured")
    };
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: transport.email.gmail.client_id,
        client_secret: secrets.gmail.client_secret,
        refresh_token: secrets.gmail.refresh_token,
        grant_type: "refresh_token"
      })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.access_token) {
      return {
        ok: false,
        status: response.status,
        error: buildStructuredError("AUTH_INVALID_CREDENTIALS", body?.error_description || body?.error || "gmail_token_refresh_failed")
      };
    }
    return {
      ok: true,
      accessToken: body.access_token
    };
  } catch (error) {
    return {
      ok: false,
      error: buildStructuredError("TRANSPORT_CONNECTION_FAILED", error instanceof Error ? error.message : "unknown_error")
    };
  }
}

async function testGmailTransport(transport, secrets) {
  const token = await getGmailAccessToken(transport, secrets);
  if (!token.ok) {
    return {
      ok: false,
      kind: "gmail",
      ...(token.status ? { status: token.status } : {}),
      error: token.error
    };
  }

  try {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(transport.email.gmail.user)}/profile`, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`
      }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return {
        ok: false,
        kind: "gmail",
        status: response.status,
        error: buildStructuredError("AUTH_INVALID_CREDENTIALS", body?.error?.message || `gmail_profile_failed_${response.status}`)
      };
    }
    return {
      ok: true,
      kind: "gmail",
      status: response.status,
      detail: "gmail_auth_ok"
    };
  } catch (error) {
    return {
      ok: false,
      kind: "gmail",
      error: buildStructuredError("TRANSPORT_CONNECTION_FAILED", error instanceof Error ? error.message : "unknown_error")
    };
  }
}

async function testTransportConnection(state, runtime) {
  const transport = getRuntimeTransport(state);
  const secrets = getResolvedSecrets(state, runtime).transport;
  if (transport.type === "local") {
    return {
      ok: true,
      kind: "local",
      detail: "local_transport_uses_managed_relay"
    };
  }
  if (transport.type === "relay_http") {
    return testRelayTransport(transport.relay_http.base_url);
  }
  if (transport.email.provider === "emailengine") {
    return testEmailEngineTransport(transport, secrets);
  }
  return testGmailTransport(transport, secrets);
}

function logSeverity(message) {
  if (!message) {
    return null;
  }
  if (/(error|exception|fatal|failed|failure)/i.test(message)) {
    return "error";
  }
  if (/(warn|warning|retry|timeout|denied|reject)/i.test(message)) {
    return "warning";
  }
  return null;
}

export function createOpsSupervisorServer() {
  const state = ensureOpsState();
  appendSupervisorEvent({
    type: "supervisor_created",
    platform_base_url: state.config.platform.base_url
  });
  const runtime = {
    processes: new Map(),
    relayQueues: new Map(),
    auth: {
      sessions: new Map(),
      unlockedSecrets: null,
      passphrase: null,
      unlockedAt: null
    }
  };

  function getRuntimeStatus(name) {
    const processInfo = runtime.processes.get(name);
    if (!processInfo) {
      return {
        name,
        running: false,
        launch_mode: null,
        pid: null,
        started_at: null,
        exited_at: null,
        exit_code: null,
        last_error: null
      };
    }
    return {
      name,
      running: !processInfo.exited,
      launch_mode: processInfo.launchMode || null,
      pid: processInfo.child?.pid || processInfo.pid || null,
      started_at: processInfo.startedAt,
      exited_at: processInfo.exitedAt,
      exit_code: processInfo.exitCode,
      last_error: processInfo.lastError
    };
  }

  function usesManagedRelay() {
    const runtimeTransport = getRuntimeTransport(state);
    const managedRelayBaseUrl = processBaseUrl(state.config.runtime.ports.relay);
    return (
      runtimeTransport.type === "local" ||
      (runtimeTransport.type === "relay_http" && normalizedString(runtimeTransport.relay_http.base_url) === managedRelayBaseUrl)
    );
  }

  function resolveRelayPackageEntry() {
    const candidatePackageJsons = [
      path.resolve(__dirname, "../node_modules/@delexec/transport-relay/package.json"),
      path.resolve(__dirname, "../../../../platform/apps/transport-relay/package.json")
    ];

    for (const packageJsonPath of candidatePackageJsons) {
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }
      const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const packageRoot = path.dirname(packageJsonPath);
      if (typeof manifest.bin === "string") {
        return path.resolve(packageRoot, manifest.bin);
      }
      if (manifest.bin && typeof manifest.bin === "object") {
        const relayBin = manifest.bin["delexec-relay"] || Object.values(manifest.bin)[0];
        if (relayBin) {
          return path.resolve(packageRoot, relayBin);
        }
      }
      if (typeof manifest.main === "string") {
        return path.resolve(packageRoot, manifest.main);
      }
    }

    // Fall back to PATH lookup for delexec-relay / croc-relay binary.
    // @delexec/transport-relay is a platform package and is no longer bundled
    // with @delexec/ops. Operators who install it separately (globally or via
    // the platform compose stack) will have the binary available in PATH.
    for (const binName of ["delexec-relay", "croc-relay"]) {
      try {
        const resolved = execFileSync("which", [binName], { encoding: "utf8" }).trim();
        if (resolved) {
          return resolved;
        }
      } catch (_) {
        // not in PATH, try next
      }
    }

    return null;
  }

  function relayLaunchSpec() {
    const configuredBin = normalizedString(process.env.OPS_RELAY_BIN);
    if (configuredBin) {
      return {
        command: configuredBin,
        args: parseJsonArrayEnv(process.env.OPS_RELAY_ARGS),
        mode: "configured_command"
      };
    }

    const packageEntry = resolveRelayPackageEntry();
    if (packageEntry) {
      return {
        command: process.execPath,
        args: [packageEntry],
        mode: "package_entry"
      };
    }

    throw new Error("relay_launch_command_not_found");
  }

  function shouldUseEmbeddedRelay() {
    if (!usesManagedRelay()) {
      return false;
    }
    if (normalizedString(process.env.OPS_RELAY_BIN)) {
      return false;
    }
    return !resolveRelayPackageEntry();
  }

  function relayQueueFor(receiver) {
    const key = String(receiver || "").trim();
    if (!runtime.relayQueues.has(key)) {
      runtime.relayQueues.set(key, []);
    }
    return runtime.relayQueues.get(key);
  }

  async function startEmbeddedRelay() {
    const current = runtime.processes.get("relay");
    if (current && !current.exited) {
      return current;
    }
    runtime.relayQueues.clear();

    const server = http.createServer(async (req, res) => {
      const method = req.method || "GET";
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = url.pathname;

      if (method === "GET" && pathname === "/healthz") {
        sendJson(res, 200, { ok: true, service: "embedded-local-relay" });
        return;
      }

      if (method === "POST" && pathname === "/v1/messages/send") {
        const body = await parseJsonBody(req);
        if (!body?.receiver || !body?.envelope) {
          sendError(res, 400, "receiver_and_envelope_required", "receiver and envelope are required");
          return;
        }
        relayQueueFor(body.receiver).push(body.envelope);
        sendJson(res, 201, {
          ok: true,
          queued: true,
          receiver: body.receiver,
          message_id: body.envelope.message_id || null
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/messages/poll") {
        const body = await parseJsonBody(req);
        if (!body?.receiver) {
          sendError(res, 400, "receiver_required", "receiver is required");
          return;
        }
        sendJson(res, 200, {
          items: relayQueueFor(body.receiver).slice(0, Number(body.limit || 10))
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/messages/ack") {
        const body = await parseJsonBody(req);
        if (!body?.receiver || !body?.message_id) {
          sendError(res, 400, "receiver_and_message_id_required", "receiver and message_id are required");
          return;
        }
        const queue = relayQueueFor(body.receiver);
        const index = queue.findIndex((item) => item?.message_id === body.message_id);
        if (index >= 0) {
          queue.splice(index, 1);
        }
        sendJson(res, 200, { acked: index >= 0 });
        return;
      }

      if (method === "GET" && pathname === "/v1/messages/peek") {
        const receiver = normalizedString(url.searchParams.get("receiver"));
        if (!receiver) {
          sendError(res, 400, "receiver_required", "receiver is required");
          return;
        }
        const threadId = normalizedString(url.searchParams.get("thread_id"));
        const items = relayQueueFor(receiver);
        sendJson(res, 200, {
          items: threadId ? items.filter((item) => item?.thread_id === threadId) : [...items]
        });
        return;
      }

      const healthMatch = pathname.match(/^\/v1\/receivers\/([^/]+)\/health$/);
      if (method === "GET" && healthMatch) {
        const receiver = decodeURIComponent(healthMatch[1]);
        sendJson(res, 200, {
          ok: true,
          receiver,
          queue_depth: relayQueueFor(receiver).length
        });
        return;
      }

      sendError(res, 404, "not_found", "no matching embedded relay route", { path: pathname });
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(state.config.runtime.ports.relay, "127.0.0.1", resolve);
    });

    const processInfo = {
      name: "relay",
      child: null,
      pid: process.pid,
      logs: [],
      startedAt: nowIso(),
      launchMode: "embedded_local",
      exited: false,
      exitedAt: null,
      exitCode: null,
      lastError: null,
      close: async () => {
        if (processInfo.exited) {
          return;
        }
        await new Promise((resolve) => server.close(resolve));
        processInfo.exited = true;
        processInfo.exitedAt = nowIso();
        processInfo.exitCode = 0;
      }
    };

    server.on("error", (error) => {
      processInfo.lastError = error instanceof Error ? error.message : "embedded_relay_error";
      appendSupervisorEvent({
        type: "service_error",
        service: "relay",
        message: processInfo.lastError
      });
    });
    server.on("close", () => {
      if (!processInfo.exited) {
        processInfo.exited = true;
        processInfo.exitedAt = nowIso();
        processInfo.exitCode = 0;
      }
      appendSupervisorEvent({
        type: "service_exit",
        service: "relay",
        exit_code: processInfo.exitCode
      });
    });

    runtime.processes.set("relay", processInfo);
    appendSupervisorEvent({
      type: "service_started",
      service: "relay",
      pid: process.pid,
      launch_mode: "embedded_local"
    });
    return processInfo;
  }

  async function stopProcessInfo(processInfo) {
    if (!processInfo || processInfo.exited) {
      return;
    }
    if (typeof processInfo.close === "function") {
      await processInfo.close();
      return;
    }
    if (processInfo.child) {
      processInfo.child.kill();
      const deadline = Date.now() + 3000;
      while (!processInfo.exited && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  function serviceEnv(name) {
    const ports = state.config.runtime.ports;
    const runtimeTransport = getRuntimeTransport(state);
    const resolvedSecrets = getResolvedSecrets(state, runtime);
    const envWithSecrets = mergeEnvWithResolvedSecrets(state.env, resolvedSecrets);
    const relayBaseUrl =
      runtimeTransport.type === "relay_http"
        ? runtimeTransport.relay_http.base_url
        : processBaseUrl(ports.relay);
    const transportEnv = buildTransportEnvUpdates(
      runtimeTransport.type === "local"
        ? {
            ...runtimeTransport,
            relay_http: { base_url: relayBaseUrl }
          }
        : runtimeTransport,
      envWithSecrets
    );
    const base = {
      ...process.env,
      DELEXEC_HOME: process.env.DELEXEC_HOME || path.dirname(state.envFile),
      PLATFORM_API_BASE_URL: state.config.platform.base_url,
      CALLER_PLATFORM_API_KEY: resolvedSecrets.caller_api_key || "",
      PLATFORM_API_KEY: resolvedSecrets.caller_api_key || "",
      CALLER_CONTACT_EMAIL: state.config.caller.contact_email || "",
      CALLER_REGISTRATION_MODE: state.config.caller.registration_mode || "",
      RESPONDER_ID: state.config.responder.responder_id || "",
      RESPONDER_SIGNING_PUBLIC_KEY_PEM: state.env.RESPONDER_SIGNING_PUBLIC_KEY_PEM || "",
      RESPONDER_SIGNING_PRIVATE_KEY_PEM: state.env.RESPONDER_SIGNING_PRIVATE_KEY_PEM || "",
      HOTLINE_IDS: (state.config.responder.hotlines || []).map((item) => item.hotline_id).join(","),
      RESPONDER_PLATFORM_API_KEY: resolvedSecrets.responder_platform_api_key || "",
      TRANSPORT_BASE_URL: relayBaseUrl,
      TRANSPORT_TYPE: runtimeTransport.type,
      TRANSPORT_PROVIDER: transportEnv.TRANSPORT_PROVIDER || "",
      TRANSPORT_EMAIL_PROVIDER: transportEnv.TRANSPORT_EMAIL_PROVIDER || "",
      TRANSPORT_EMAIL_MODE: transportEnv.TRANSPORT_EMAIL_MODE || "",
      TRANSPORT_EMAIL_SENDER: transportEnv.TRANSPORT_EMAIL_SENDER || "",
      TRANSPORT_EMAIL_RECEIVER: transportEnv.TRANSPORT_EMAIL_RECEIVER || "",
      TRANSPORT_EMAIL_POLL_INTERVAL_MS: transportEnv.TRANSPORT_EMAIL_POLL_INTERVAL_MS || "",
      TRANSPORT_EMAILENGINE_BASE_URL: state.env.TRANSPORT_EMAILENGINE_BASE_URL || "",
      TRANSPORT_EMAILENGINE_ACCOUNT: state.env.TRANSPORT_EMAILENGINE_ACCOUNT || "",
      TRANSPORT_EMAILENGINE_ACCESS_TOKEN: resolvedSecrets.transport.emailengine.access_token || "",
      TRANSPORT_GMAIL_CLIENT_ID: state.env.TRANSPORT_GMAIL_CLIENT_ID || "",
      TRANSPORT_GMAIL_USER: state.env.TRANSPORT_GMAIL_USER || "",
      TRANSPORT_GMAIL_CLIENT_SECRET: resolvedSecrets.transport.gmail.client_secret || "",
      TRANSPORT_GMAIL_REFRESH_TOKEN: resolvedSecrets.transport.gmail.refresh_token || ""
    };

    if (name === "relay") {
      return {
        ...base,
        PORT: String(ports.relay),
        SERVICE_NAME: "transport-relay"
      };
    }
    if (name === "caller") {
      return {
        ...base,
        PORT: String(ports.caller),
        SERVICE_NAME: "caller-controller",
        PLATFORM_ENABLED: String(platformFeaturesEnabled(state)),
        TRANSPORT_RECEIVER: "caller-controller"
      };
    }
    if (name === "skill-adapter") {
      return {
        ...base,
        PORT: String(ports.skill_adapter || 8091),
        SERVICE_NAME: "caller-skill-adapter",
        PLATFORM_ENABLED: String(platformFeaturesEnabled(state)),
        CALLER_CONTROLLER_BASE_URL: processBaseUrl(ports.caller)
      };
    }
    if (name === "mcp-adapter") {
      return {
        ...base,
        PORT: String(ports.mcp_adapter || 8092),
        SERVICE_NAME: "caller-skill-mcp-adapter",
        MCP_ADAPTER_TRANSPORT: "http",
        CALLER_SKILL_BASE_URL: processBaseUrl(ports.skill_adapter || 8091)
      };
    }
    return {
      ...base,
      PORT: String(ports.responder),
      SERVICE_NAME: "responder-controller",
      TRANSPORT_RECEIVER: state.config.responder.responder_id || "responder-controller"
    };
  }

  function serviceEntry(name) {
    if (name === "caller") {
      return require.resolve("@delexec/caller-controller");
    }
    if (name === "skill-adapter") {
      return require.resolve("@delexec/caller-skill-adapter");
    }
    if (name === "mcp-adapter") {
      return path.resolve(__dirname, "../../caller-skill-mcp-adapter/src/server.js");
    }
    return require.resolve("@delexec/responder-controller");
  }

  function buildMcpAdapterSpec() {
    const callerSkillBaseUrl = processBaseUrl(state.config.runtime.ports.skill_adapter || 8091);
    const mcpEntry = path.resolve(__dirname, "../../caller-skill-mcp-adapter/src/server.js");
    const httpBaseUrl = processBaseUrl(state.config.runtime.ports.mcp_adapter || 8092);
    return {
      mode: "multi_transport",
      available: true,
      recommended_for: ["codex", "cursor", "claude-code"],
      preferred_transport: "streamable_http",
      stdio: {
        mode: "stdio",
        command: process.execPath,
        args: [mcpEntry],
        env: {
          CALLER_SKILL_BASE_URL: callerSkillBaseUrl
        }
      },
      streamable_http: {
        mode: "streamable_http",
        url: appendPath(httpBaseUrl, "/mcp"),
        health_url: appendPath(httpBaseUrl, "/healthz")
      },
      entry_file: mcpEntry,
      caller_skill_base_url: callerSkillBaseUrl,
      base_url: httpBaseUrl
    };
  }

  function serviceLaunchSpec(name) {
    if (name === "relay") {
      return relayLaunchSpec();
    }
    return {
      command: process.execPath,
      args: [serviceEntry(name)],
      mode: "node_entry"
    };
  }

  function captureLog(processInfo, chunk) {
    const ts = new Date().toTimeString().slice(0, 8); // HH:mm:ss
    const lines = chunk.toString("utf8").split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line) continue;
      const stamped = `${ts} ${line}`;
      processInfo.logs.push(stamped);
      if (processInfo.logs.length > 200) processInfo.logs.shift();
      appendServiceLog(processInfo.name, `${stamped}\n`);
    }
  }

  async function ensureService(name) {
    const current = runtime.processes.get(name);
    if (current && !current.exited) {
      return current;
    }
    if (name === "relay" && shouldUseEmbeddedRelay()) {
      return startEmbeddedRelay();
    }
    const ports = state.config.runtime.ports;
    const portMap = {
      caller: ports.caller,
      responder: ports.responder,
      relay: ports.relay,
      "skill-adapter": ports.skill_adapter || 8091,
      "mcp-adapter": ports.mcp_adapter || 8092
    };
    // Kill any orphaned process holding the port before starting
    const targetPort = portMap[name];
    if (targetPort) {
      await new Promise((resolve) => {
        const killer = spawn(process.execPath, [
          "-e",
          `const { execSync } = require("child_process");
           try {
             const out = execSync("lsof -ti:${targetPort} 2>/dev/null", { encoding: "utf8" }).trim();
             if (out) { out.split("\\n").forEach(pid => { try { process.kill(Number(pid), "SIGKILL"); } catch(_) {} }); }
           } catch(_) {}
          `
        ]);
        killer.on("exit", resolve);
        setTimeout(resolve, 2000);
      });
      // Brief pause to let OS release the port
      await new Promise((r) => setTimeout(r, 300));
    }
    const launch = serviceLaunchSpec(name);
    const child = spawn(launch.command, launch.args, {
      env: serviceEnv(name),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const processInfo = {
      name,
      child,
      logs: [],
      startedAt: nowIso(),
      launchMode: launch.mode,
      exited: false,
      exitedAt: null,
      exitCode: null,
      lastError: null
    };
    child.stdout.on("data", (chunk) => captureLog(processInfo, chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => captureLog(processInfo, chunk.toString("utf8")));
    child.on("error", (error) => {
      processInfo.lastError = error instanceof Error ? error.message : "unknown_error";
      appendSupervisorEvent({
        type: "service_error",
        service: name,
        message: processInfo.lastError
      });
    });
    child.on("exit", (code) => {
      processInfo.exited = true;
      processInfo.exitedAt = nowIso();
      processInfo.exitCode = code;
      appendSupervisorEvent({
        type: "service_exit",
        service: name,
        exit_code: code
      });
    });
    runtime.processes.set(name, processInfo);
    appendSupervisorEvent({
      type: "service_started",
      service: name,
      pid: child.pid
    });
    return processInfo;
  }

  async function waitForRelay(maxWaitMs = 8000) {
    const relayUrl = `http://127.0.0.1:${state.config.runtime.ports?.relay || 8090}`;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const res = await fetch(`${relayUrl}/healthz`);
        if (res.ok) return;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function waitForServiceHealth(name, maxWaitMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const health = await fetchHealth(name);
      if (health?.status === 200) {
        return health;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  async function ensureBaseServices() {
    if (usesManagedRelay()) {
      await ensureService("relay");
      if (shouldUseEmbeddedRelay()) {
        await waitForServiceHealth("relay");
      } else {
        await waitForRelay();
      }
    }
    await ensureService("caller");
    await waitForServiceHealth("caller");
    await ensureService("skill-adapter");
    await waitForServiceHealth("skill-adapter");
    await ensureService("mcp-adapter");
    await waitForServiceHealth("mcp-adapter");
    if (state.config.responder.enabled) {
      await ensureService("responder");
      await waitForServiceHealth("responder");
    }
  }

  async function prepareCallConfirmation(body = {}) {
    await ensureBaseServices();
    const taskType = normalizedString(body.task_type);
    const hotlineId = normalizedString(body.hotline_id);
    const responderId = normalizedString(body.responder_id);
    const capability = normalizedString(body.capability);
    const preference = getTaskTypePreference(state, taskType);

    const items = await fetchCatalogCandidates(state, runtime, {
      task_type: taskType,
      hotline_id: hotlineId,
      responder_id: responderId,
      capability
    });

    const candidates = items
      .map((item) => ({
        raw: item,
        score: scoreCandidate(item, {
          taskType,
          hotlineId,
          responderId,
          preferred: preference
        })
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);

    if (candidates.length === 0) {
      return {
        status: 404,
        body: buildStructuredError("HOTLINE_CANDIDATES_NOT_FOUND", "no visible hotline candidates matched the current request", {
          task_type: taskType,
          responder_id: responderId,
          hotline_id: hotlineId
        })
      };
    }

    const selected = candidates[0].raw;
    const selectedSummary = summarizeCandidate(selected, {
      selected: true,
      taskType,
      preferred: Boolean(preference && selected.hotline_id === preference.hotline_id)
    });

    return {
      status: 200,
      body: {
        task_type: taskType,
        always_ask: true,
        remembered_preference: preference,
        selection_reason: selectedSummary.match_reasons.join(" · "),
        selected_hotline: selectedSummary,
        candidate_hotlines: candidates.map(({ raw }) =>
          summarizeCandidate(raw, {
            selected: raw.hotline_id === selected.hotline_id && raw.responder_id === selected.responder_id,
            taskType,
            preferred: Boolean(preference && raw.hotline_id === preference.hotline_id)
          })
        )
      }
    };
  }

  async function confirmPreparedCall(body = {}) {
    await ensureBaseServices();
    const chosenHotlineId = normalizedString(body.hotline_id);
    const chosenResponderId = normalizedString(body.responder_id);
    const taskType = normalizedString(body.task_type);
    if (!chosenHotlineId || !chosenResponderId || !taskType) {
      return {
        status: 400,
        body: buildStructuredError(
          "CONTRACT_INVALID_CONFIRM_BODY",
          "hotline_id, responder_id, and task_type are required for call confirmation"
        )
      };
    }

    const candidates = await fetchCatalogCandidates(state, runtime, {
      hotline_id: chosenHotlineId,
      responder_id: chosenResponderId,
      task_type: taskType
    });
    const selected = candidates.find((item) => item.hotline_id === chosenHotlineId && item.responder_id === chosenResponderId);
    if (!selected) {
      return {
        status: 409,
        body: buildStructuredError("HOTLINE_NO_LONGER_VISIBLE", "chosen hotline is no longer visible for this caller", {
          hotline_id: chosenHotlineId,
          responder_id: chosenResponderId
        })
      };
    }

    if (body.remember_for_task_type === true) {
      setTaskTypePreference(state, taskType, {
        hotline_id: chosenHotlineId,
        responder_id: chosenResponderId
      });
      state.env = saveOpsState(state);
    }

    return requestJson(processBaseUrl(state.config.runtime.ports.caller), "/controller/remote-requests", {
      method: "POST",
      headers: buildPlatformHeaders(state, runtime),
      body: {
        responder_id: chosenResponderId,
        hotline_id: chosenHotlineId,
        task_type: taskType,
        input: body.input || { text: normalizedString(body.text) || "" },
        payload: body.payload || { text: normalizedString(body.text) || "" },
        output_schema: body.output_schema || {
          type: "object",
          properties: {
            summary: { type: "string" }
          }
        }
      }
    });
  }

  async function reloadResponderIfRunning() {
    if (!state.config.responder.enabled) {
      return;
    }
    const processInfo = runtime.processes.get("responder");
    if (processInfo && !processInfo.exited) {
      await stopProcessInfo(processInfo);
    }
    await ensureService("responder");
  }

  async function fetchHealth(name) {
    const portKey = name === "skill-adapter" ? "skill_adapter" : name === "mcp-adapter" ? "mcp_adapter" : name;
    const port = state.config.runtime.ports[portKey];
    if (name === "relay" && !usesManagedRelay()) {
      const runtimeTransport = getRuntimeTransport(state);
      if (runtimeTransport.type !== "relay_http") {
        return null;
      }
      try {
        return await requestJson(runtimeTransport.relay_http.base_url, "/healthz");
      } catch (error) {
        return { status: 503, body: { ok: false, error: error instanceof Error ? error.message : "unknown_error" } };
      }
    }
    try {
      return await requestJson(processBaseUrl(port), "/healthz");
    } catch (error) {
      return { status: 503, body: { ok: false, error: error instanceof Error ? error.message : "unknown_error" } };
    }
  }

  async function fetchRecentRequestsSummary() {
    try {
      const response = await requestJson(processBaseUrl(state.config.runtime.ports.caller), "/controller/requests");
      const items = response.body?.items || [];
      const byStatus = items.reduce((summary, item) => {
        const key = item.status || "UNKNOWN";
        summary[key] = (summary[key] || 0) + 1;
        return summary;
      }, {});
      return {
        total: items.length,
        by_status: byStatus,
        latest: items.slice(0, 5).map((item) => ({
          request_id: item.request_id,
          status: item.status,
          updated_at: item.updated_at || item.created_at || null
        }))
      };
    } catch {
      return {
        total: 0,
        by_status: {},
        latest: []
      };
    }
  }

  async function buildStatus() {
    await syncResponderReviewStatusesFromPlatform();
    const hotlines = state.config.responder.hotlines || [];
    const secrets = getResolvedSecrets(state, runtime);
    const runtimeTransport = getRuntimeTransport(state);
    const pendingReviewCount = platformFeaturesEnabled(state)
      ? hotlines.filter((item) => item.submitted_for_review !== true).length
      : 0;
    const reviewStatusCounts = hotlines.reduce((counts, item) => {
      const key = item.review_status || "local_only";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    state.config.caller.api_key_configured = Boolean(secrets.caller_api_key);
    state.config.caller.registration_mode ||= state.config.caller.api_key_configured ? "platform" : null;
    state.config.platform_console ||= {};
    state.config.platform_console.admin_api_key_configured = Boolean(secrets.platform_admin_api_key);
    return {
      ok: true,
      config: state.config,
      auth: getAuthState(runtime, state),
      debug: {
        logs_dir: path.join(path.dirname(state.envFile), "logs"),
        event_log: getSupervisorEventsFile(),
        service_logs: {
          relay: getServiceLogFile("relay"),
          caller: getServiceLogFile("caller"),
          skill_adapter: getServiceLogFile("skill-adapter"),
          mcp_adapter: getServiceLogFile("mcp-adapter"),
          responder: getServiceLogFile("responder")
        }
      },
      responder: {
        enabled: state.config.responder.enabled,
        responder_id: state.config.responder.responder_id,
        display_name: state.config.responder.display_name,
        hotline_count: hotlines.length,
        pending_review_count: pendingReviewCount,
        review_summary: reviewStatusCounts,
        platform_enabled: platformFeaturesEnabled(state)
      },
      caller: {
        enabled: state.config.caller.enabled !== false,
        registered: state.config.caller.registration_mode === "local_only" || state.config.caller.api_key_configured === true,
        registration_mode: state.config.caller.registration_mode || null,
        contact_email: state.config.caller.contact_email || null,
        api_key_configured: state.config.caller.api_key_configured === true,
        platform_enabled: platformFeaturesEnabled(state)
      },
      requests: await fetchRecentRequestsSummary(),
      runtime: {
        supervisor: {
          port: state.config.runtime.ports.supervisor
        },
        relay: {
          ...getRuntimeStatus("relay"),
          managed: usesManagedRelay(),
          transport_type: runtimeTransport.type,
          base_url: runtimeTransport.type === "relay_http" ? runtimeTransport.relay_http.base_url : processBaseUrl(state.config.runtime.ports.relay),
          health: await fetchHealth("relay")
        },
        caller: {
          ...getRuntimeStatus("caller"),
          health: await fetchHealth("caller")
        },
        skill_adapter: {
          ...getRuntimeStatus("skill-adapter"),
          health: await fetchHealth("skill-adapter")
        },
        mcp_adapter: {
          ...getRuntimeStatus("mcp-adapter"),
          health: await fetchHealth("mcp-adapter"),
          spec: buildMcpAdapterSpec()
        },
        responder: {
          ...getRuntimeStatus("responder"),
          health: state.config.responder.enabled ? await fetchHealth("responder") : null
        }
      }
    };
  }

  function buildRuntimeAlerts(service, { maxItems = 20 } = {}) {
    const events = readSupervisorEventTail({ maxLines: 200 })
      .filter((event) => {
        if (service === "supervisor") {
          return true;
        }
        return event.service === service;
      })
      .flatMap((event) => {
        if (event.type === "service_error") {
          return [
            {
              at: event.at,
              service: event.service,
              severity: "error",
              source: "event",
              message: event.message || "service_error"
            }
          ];
        }
        if (event.type === "service_exit" && event.exit_code !== 0 && event.exit_code !== null) {
          return [
            {
              at: event.at,
              service: event.service,
              severity: "error",
              source: "event",
              message: `service exited with code ${event.exit_code}`
            }
          ];
        }
        return [];
      });

    const logAlerts = (service === "supervisor" ? [] : readServiceLogTail(service, { maxLines: 200 }))
      .flatMap((line) => {
        const severity = logSeverity(line);
        if (!severity) {
          return [];
        }
        return [
          {
            at: null,
            service,
            severity,
            source: "log",
            message: line.trim()
          }
        ];
      });

    return [...events, ...logAlerts].slice(-maxItems).reverse();
  }

  async function registerCaller(contactEmail, { localOnly = false, forcePlatform = false } = {}) {
    if (!forcePlatform && (localOnly || !platformFeaturesEnabled(state))) {
      const nextEmail = normalizedString(contactEmail) || state.config.caller.contact_email || null;
      state.config.caller.contact_email = nextEmail;
      state.config.caller.registration_mode = "local_only";
      state.config.caller.api_key = null;
      state.config.caller.api_key_configured = false;
      state.env = saveOpsState(state);
      return {
        status: 201,
        body: {
          ok: true,
          registered: true,
          mode: "local_only",
          contact_email: nextEmail
        }
      };
    }
    const response = await requestJson(state.config.platform.base_url, "/v1/users/register", {
      method: "POST",
      body: {
        contact_email: contactEmail
      }
    });
    if (response.status !== 201) {
      return response;
    }
    state.config.caller.contact_email = response.body.contact_email || contactEmail;
    state.config.caller.registration_mode = "platform";
    state.config.caller.api_key_configured = true;
    state.config.platform.enabled = true;
    if (hasEncryptedSecretStore()) {
      writeOpsSecrets(runtime.auth.passphrase, {
        [OPS_SECRET_KEYS.caller_api_key]: response.body.api_key
      });
      runtime.auth.unlockedSecrets = unlockOpsSecrets(runtime.auth.passphrase);
      scrubLegacySecrets(state);
    } else {
      state.env = saveOpsState({
        ...state,
        env: {
          ...state.env,
          CALLER_PLATFORM_API_KEY: response.body.api_key,
          PLATFORM_API_KEY: response.body.api_key
        }
      });
    }
    state.env = saveOpsState(state);
    return response;
  }

function buildResponderRegisterHeaders() {
  const secrets = getResolvedSecrets(state, runtime);
  const apiKey = secrets.caller_api_key || secrets.responder_platform_api_key;
  if (!apiKey) {
    throw new Error("caller_platform_api_key_required");
  }
  return { Authorization: `Bearer ${apiKey}` };
}

  function buildPlatformReadHeaders() {
    const secrets = getResolvedSecrets(state, runtime);
    const apiKey = secrets.platform_admin_api_key || secrets.caller_api_key || secrets.responder_platform_api_key;
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  }

  async function syncResponderReviewStatusesFromPlatform() {
    if (!platformFeaturesEnabled(state)) {
      return false;
    }
    const hotlines = state.config.responder.hotlines || [];
    const submitted = hotlines.filter((item) => item.submitted_for_review === true);
    if (submitted.length === 0) {
      return false;
    }
    const headers = buildPlatformReadHeaders();
    let changed = false;
    for (const item of submitted) {
      let response;
      try {
        response = await requestJson(
          state.config.platform.base_url,
          `/v1/catalog/hotlines/${encodeURIComponent(item.hotline_id)}`,
          { headers }
        );
      } catch {
        continue;
      }
      if (response.status !== 200 || !response.body) {
        continue;
      }
      const nextReviewStatus = response.body.review_status || item.review_status || "pending";
      if (item.review_status !== nextReviewStatus) {
        item.review_status = nextReviewStatus;
        changed = true;
      }
      if (item.submitted_for_review !== true) {
        item.submitted_for_review = true;
        changed = true;
      }
    }
    if (changed) {
      state.env = saveOpsState(state);
    }
    return changed;
  }

  async function verifyRegisteredHotline({ hotlineId, expectedTemplateRef }) {
    let detail;
    let bundle;
    try {
      detail = await requestJson(
        state.config.platform.base_url,
        `/v1/catalog/hotlines/${encodeURIComponent(hotlineId)}`,
        {
          headers: buildResponderRegisterHeaders()
        }
      );
    } catch (error) {
      return {
        ok: false,
        catalog_visible: false,
        template_ref_matches: false,
        template_bundle_available: false,
        catalog_status: null,
        template_bundle_status: null,
        error: error instanceof Error ? error.message : "catalog_verification_failed"
      };
    }

    const actualTemplateRef = detail.body?.template_ref || null;
    const templateRefMatches = Boolean(detail.status === 200 && actualTemplateRef && actualTemplateRef === expectedTemplateRef);
    if (detail.status === 200 && actualTemplateRef) {
      try {
        bundle = await requestJson(
          state.config.platform.base_url,
          `/v1/catalog/hotlines/${encodeURIComponent(hotlineId)}/template-bundle?template_ref=${encodeURIComponent(actualTemplateRef)}`,
          {
            headers: buildResponderRegisterHeaders()
          }
        );
      } catch (error) {
        bundle = {
          status: null,
          body: {
            ok: false,
            error: error instanceof Error ? error.message : "template_bundle_verification_failed"
          }
        };
      }
    }

    const templateBundleAvailable = Boolean(bundle?.status === 200);
    return {
      ok: Boolean(detail.status === 200 && templateRefMatches && templateBundleAvailable),
      catalog_visible: detail.status === 200,
      template_ref_matches: templateRefMatches,
      template_bundle_available: templateBundleAvailable,
      catalog_status: detail.status,
      template_bundle_status: bundle?.status ?? null,
      template_ref: actualTemplateRef || expectedTemplateRef || null
    };
  }

  async function submitPendingResponderReviews({ hotlineId = null } = {}) {
    if (!platformFeaturesEnabled(state)) {
      return {
        status: 409,
        body: buildStructuredError(
          "PLATFORM_FEATURES_DISABLED",
          "platform publishing is disabled; enable platform features before submitting hotline reviews"
        )
      };
    }
    const responderIdentity = ensureResponderIdentity(state);
    const pending = (state.config.responder.hotlines || []).filter(
      (item) => item.submitted_for_review !== true && (!hotlineId || item.hotline_id === hotlineId)
    );
    const results = [];
    for (const item of pending) {
      let onboarding;
      try {
        onboarding = buildHotlineOnboardingBody(state, item, responderIdentity);
      } catch (error) {
        return {
          status: 400,
          body: buildStructuredError(
            error?.code || "HOTLINE_DRAFT_INVALID",
            error instanceof Error ? error.message : "hotline registration draft is invalid",
            { fields: Array.isArray(error?.fields) ? error.fields : [] }
          )
        };
      }
      const response = await requestJson(state.config.platform.base_url, "/v2/hotlines", {
        method: "POST",
        headers: buildResponderRegisterHeaders(),
        body: onboarding.body
      });
      if (response.status !== 201) {
        return response;
      }
      if (hasEncryptedSecretStore()) {
        writeOpsSecrets(runtime.auth.passphrase, {
          [OPS_SECRET_KEYS.responder_platform_api_key]: response.body.responder_api_key || response.body.api_key
        });
        runtime.auth.unlockedSecrets = unlockOpsSecrets(runtime.auth.passphrase);
        scrubLegacySecrets(state);
      } else {
        state.env = saveOpsState({
          ...state,
          env: {
            ...state.env,
            RESPONDER_PLATFORM_API_KEY: response.body.responder_api_key || response.body.api_key
          }
        });
      }
      item.submitted_for_review = true;
      item.review_status = response.body.hotline_review_status || response.body.review_status || "pending";
      const verification = await verifyRegisteredHotline({
        hotlineId: item.hotline_id,
        expectedTemplateRef: onboarding.body.template_ref
      });
      results.push({
        ...response.body,
        draft_file: onboarding.draft_file,
        used_draft: onboarding.used_draft,
        verification
      });
    }
    saveOpsState(state);
    return { status: 201, body: { ok: true, responder_id: responderIdentity.responder_id, submitted: results.length, results } };
  }

  async function addOfficialExampleHotline() {
    const definition = buildExampleHotlineDefinition();
    const registrationDraft = ensureHotlineRegistrationDraft(state, definition);
    upsertHotline(state, definition);
    state.env = saveOpsState(state);
    await reloadResponderIfRunning();
    appendSupervisorEvent({
      type: "hotline_upserted",
      hotline_id: definition.hotline_id,
      adapter_type: definition.adapter_type,
      example: true
    });
    return {
      ...definition,
      local_integration_file: registrationDraft.integration_file,
      local_hook_file: registrationDraft.hook_file,
      registration_draft_file: registrationDraft.draft_file,
      registration_draft: registrationDraft.draft
    };
  }

  async function dispatchExampleRequest(body = {}) {
    await ensureBaseServices();
    const callerRegistered =
      state.config.caller.registration_mode === "local_only" || Boolean(getResolvedSecrets(state, runtime).caller_api_key);
    if (!callerRegistered) {
      return {
        status: 409,
        body: buildStructuredError("CALLER_NOT_REGISTERED", "caller must be registered before running the local example", {
          stage: "register_caller"
        })
      };
    }
    if (state.config.responder.enabled !== true) {
      return {
        status: 409,
        body: buildStructuredError("RESPONDER_NOT_ENABLED", "responder must be enabled before running the local example", {
          stage: "enable_responder"
        })
      };
    }

    const example = findConfiguredExampleHotline(state);
    if (!example) {
      return buildExampleVisibilityError(example);
    }
    const responderIdentity = ensureResponderIdentity(state);
    let signerPublicKeyPem = responderIdentity.public_key_pem;

    if (platformFeaturesEnabled(state)) {
      if (example.submitted_for_review !== true) {
        return buildExampleVisibilityError(example);
      }

      const catalog = await requestJson(
        processBaseUrl(state.config.runtime.ports.caller),
        `/controller/hotlines?hotline_id=${encodeURIComponent(LOCAL_EXAMPLE_HOTLINE_ID)}&responder_id=${encodeURIComponent(
          state.config.responder.responder_id || ""
        )}`,
        {
          headers: buildPlatformHeaders(state, runtime)
        }
      );

      const selected = catalog.body?.items?.find(
        (item) => item.hotline_id === LOCAL_EXAMPLE_HOTLINE_ID && item.responder_id === state.config.responder.responder_id
      );
      if (!selected) {
        return buildExampleVisibilityError(example);
      }
      signerPublicKeyPem = selected.responder_public_key_pem || signerPublicKeyPem;
    }

    const requestBody = buildExampleRequestBody({
      text: body.text,
      responderId: state.config.responder.responder_id,
      hotlineId: LOCAL_EXAMPLE_HOTLINE_ID,
      signerPublicKeyPem
    });
    let response;
    if (platformFeaturesEnabled(state)) {
      response = await requestJson(processBaseUrl(state.config.runtime.ports.caller), "/controller/remote-requests", {
        method: "POST",
        headers: buildPlatformHeaders(state, runtime),
        body: requestBody
      });
    } else {
      const created = await requestJson(processBaseUrl(state.config.runtime.ports.caller), "/controller/requests", {
        method: "POST",
        body: requestBody
      });
      if (created.status !== 201 || !created.body?.request_id) {
        response = created;
      } else {
        await requestJson(
          processBaseUrl(state.config.runtime.ports.caller),
          `/controller/requests/${encodeURIComponent(created.body.request_id)}/contract-draft`,
          {
            method: "POST",
            body: {}
          }
        );
        const dispatched = await requestJson(
          processBaseUrl(state.config.runtime.ports.caller),
          `/controller/requests/${encodeURIComponent(created.body.request_id)}/dispatch`,
          {
            method: "POST",
            body: {
              thread_id: LOCAL_EXAMPLE_HOTLINE_ID,
              payload: requestBody.payload,
              task_input: requestBody.input
            }
          }
        );
        response = {
          status: dispatched.status === 202 ? 201 : dispatched.status,
          body: {
            request_id: created.body.request_id,
            request: dispatched.body?.request || created.body,
            accepted: dispatched.body?.accepted === true,
            delivery_meta: null,
            task_token: null
          }
        };
      }
    }
    const draft = loadHotlineRegistrationDraft(state, example);
    return {
      status: response.status,
      body: {
        ...(response.body || {}),
        hotline_id: LOCAL_EXAMPLE_HOTLINE_ID,
        draft_file: draft.draft_file,
        draft_ready: Boolean(draft.draft)
      }
    };
  }

  const server = http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname;

    try {
      if (method === "OPTIONS") {
        sendJson(res, 204, {});
        return;
      }

      if (isProtectedRoute(method, pathname)) {
        const session = requireAuthenticatedSession(req, res, runtime, state);
        if (!session.ok) {
          return;
        }
      }

      if (method === "GET" && pathname === "/healthz") {
        sendJson(res, 200, { ok: true, service: "ops-supervisor" });
        return;
      }
      if (method === "GET" && pathname === "/auth/session") {
        const recoverableSession = getRecoverableSession(runtime);
        if (recoverableSession) {
          persistActiveSession(recoverableSession);
        }
        sendJson(res, 200, {
          ok: true,
          session: getAuthState(runtime, state),
          recoverable_session: recoverableSession
        });
        return;
      }
      if (method === "POST" && pathname === "/auth/session/setup") {
        const body = await parseJsonBody(req);
        const passphrase = normalizedString(body.passphrase);
        if (!passphrase || passphrase.length < 8) {
          sendError(res, 400, "AUTH_INVALID_PASSPHRASE", "passphrase must be at least 8 characters");
          return;
        }
        if (hasEncryptedSecretStore()) {
          sendError(res, 409, "AUTH_SECRET_STORE_EXISTS", "encrypted secret store already exists");
          return;
        }
        const legacySecrets = Object.fromEntries(
          Object.entries(readResolvedOpsSecrets(state))
            .flatMap(([key, value]) => {
              if (key === "transport") {
                return [
                  [OPS_SECRET_KEYS.transport_emailengine_access_token, value.emailengine.access_token],
                  [OPS_SECRET_KEYS.transport_gmail_client_secret, value.gmail.client_secret],
                  [OPS_SECRET_KEYS.transport_gmail_refresh_token, value.gmail.refresh_token]
                ];
              }
              return [[key, value]];
            })
            .filter(([, value]) => normalizedString(value))
        );
        initializeSecretStore(state.secretsFile, passphrase, legacySecrets);
        runtime.auth.unlockedSecrets = unlockOpsSecrets(passphrase);
        runtime.auth.passphrase = passphrase;
        runtime.auth.unlockedAt = nowIso();
        state.config.caller.api_key_configured = Boolean(runtime.auth.unlockedSecrets[OPS_SECRET_KEYS.caller_api_key]);
        scrubLegacySecrets(state);
        state.env = saveOpsState(state);
        const session = createAuthenticatedSession(runtime, passphrase, runtime.auth.unlockedSecrets);
        appendSupervisorEvent({ type: "auth_session_setup" });
        sendJson(res, 201, {
          ok: true,
          token: session.token,
          expires_at: session.expires_at,
          session: getAuthState(runtime, state)
        });
        return;
      }
      if (method === "POST" && pathname === "/auth/session/login") {
        const body = await parseJsonBody(req);
        const passphrase = normalizedString(body.passphrase);
        if (!passphrase) {
          sendError(res, 400, "AUTH_INVALID_PASSPHRASE", "passphrase is required");
          return;
        }
        if (!hasEncryptedSecretStore()) {
          sendError(res, 409, "AUTH_SECRET_STORE_MISSING", "encrypted secret store is not initialized yet");
          return;
        }
        try {
          const secrets = unlockOpsSecrets(passphrase);
          const session = createAuthenticatedSession(runtime, passphrase, secrets);
          appendSupervisorEvent({ type: "auth_session_login" });
          for (const svc of ["caller", "skill-adapter"]) {
            const existing = runtime.processes.get(svc);
            if (existing && !existing.exited) {
              existing.child.kill();
              const deadline = Date.now() + 3000;
              while (!existing.exited && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 100));
              }
            }
            await ensureService(svc);
          }
          appendSupervisorEvent({ type: "services_restarted_after_login", services: ["caller", "skill-adapter"] });
          sendJson(res, 200, {
            ok: true,
            token: session.token,
            expires_at: session.expires_at,
            session: getAuthState(runtime, state)
          });
        } catch (error) {
          sendError(res, 401, "AUTH_INVALID_PASSPHRASE", error instanceof Error ? error.message : "secret_unlock_failed");
        }
        return;
      }
      if (method === "POST" && pathname === "/auth/session/logout") {
        const token = readSessionToken(req);
        if (token) {
          runtime.auth.sessions.delete(token);
        } else {
          runtime.auth.sessions.clear();
        }
        pruneExpiredSessions(runtime);
        if (runtime.auth.sessions.size === 0) {
          clearActiveSession();
        }
        appendSupervisorEvent({ type: "auth_session_logout" });
        sendJson(res, 200, {
          ok: true,
          session: getAuthState(runtime, state)
        });
        return;
      }
      if (method === "POST" && pathname === "/auth/session/change-passphrase") {
        if (!hasEncryptedSecretStore()) {
          sendError(res, 409, "AUTH_SECRET_STORE_MISSING", "encrypted secret store is not initialized yet");
          return;
        }
        const body = await parseJsonBody(req);
        const nextPassphrase = normalizedString(body.next_passphrase);
        if (!nextPassphrase || nextPassphrase.length < 8) {
          sendError(res, 400, "AUTH_INVALID_PASSPHRASE", "next_passphrase must be at least 8 characters");
          return;
        }
        const currentPassphrase = runtime.auth.passphrase || normalizedString(body.current_passphrase);
        if (!currentPassphrase) {
          sendError(res, 400, "AUTH_INVALID_PASSPHRASE", "current passphrase is required");
          return;
        }
        try {
          rotateSecretStorePassphrase(state.secretsFile, currentPassphrase, nextPassphrase);
          const secrets = unlockOpsSecrets(nextPassphrase);
          runtime.auth.passphrase = nextPassphrase;
          runtime.auth.unlockedSecrets = secrets;
          runtime.auth.unlockedAt = nowIso();
          appendSupervisorEvent({ type: "auth_passphrase_rotated" });
          sendJson(res, 200, {
            ok: true,
            session: getAuthState(runtime, state)
          });
        } catch (error) {
          sendError(res, 401, "AUTH_INVALID_PASSPHRASE", error instanceof Error ? error.message : "passphrase_rotation_failed");
        }
        return;
      }
      if (method === "GET" && pathname === "/status") {
        sendJson(res, 200, await buildStatus());
        return;
      }
      if (method === "GET" && pathname === "/platform/settings") {
        sendJson(res, 200, {
          enabled: platformFeaturesEnabled(state),
          base_url: state.config.platform?.base_url || null
        });
        return;
      }
      if (method === "PUT" && pathname === "/platform/settings") {
        const body = await parseJsonBody(req);
        state.config.platform ||= {};
        if (typeof body.enabled === "boolean") {
          state.config.platform.enabled = body.enabled;
        }
        if (normalizedString(body.base_url)) {
          state.config.platform.base_url = normalizedString(body.base_url);
          state.config.platform_console ||= {};
          state.config.platform_console.base_url = state.config.platform.base_url;
        }
        state.env = saveOpsState(state);
        for (const svc of ["caller", "skill-adapter"]) {
          const existing = runtime.processes.get(svc);
          if (existing && !existing.exited) {
            existing.child.kill();
            const deadline = Date.now() + 3000;
            while (!existing.exited && Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 100));
            }
          }
          await ensureService(svc);
        }
        appendSupervisorEvent({
          type: "platform_settings_updated",
          enabled: platformFeaturesEnabled(state),
          base_url: state.config.platform.base_url
        });
        sendJson(res, 200, {
          ok: true,
          enabled: platformFeaturesEnabled(state),
          base_url: state.config.platform.base_url
        });
        return;
      }
      if (method === "GET" && pathname === "/runtime/transport") {
        sendJson(res, 200, getTransportResponse(state, runtime));
        return;
      }
      if (method === "PUT" && pathname === "/runtime/transport") {
        const body = await parseJsonBody(req);
        const nextTransport = normalizeTransportPayload(body);
        const validation = validateTransportConfig(nextTransport);
        if (validation) {
          sendJson(res, validation.status, validation.body);
          return;
        }
        state.config.runtime ||= {};
        state.config.runtime.transport = nextTransport;
        const secretUpdates = buildTransportSecretUpdates(body);
        if (hasEncryptedSecretStore()) {
          if (Object.keys(secretUpdates).length > 0) {
            writeOpsSecrets(runtime.auth.passphrase, secretUpdates);
            runtime.auth.unlockedSecrets = unlockOpsSecrets(runtime.auth.passphrase);
          }
          scrubLegacySecrets(state);
        } else if (Object.keys(secretUpdates).length > 0) {
          state.env = {
            ...state.env,
            ...buildLegacyTransportSecretEnv(secretUpdates)
          };
        }
        // Clear after scrubLegacySecrets (which re-reads disk) so saveOpsState picks up config.type
        if (state.env) state.env = { ...state.env, TRANSPORT_TYPE: null };
        state.env = saveOpsState(state);
        appendSupervisorEvent({
          type: "transport_updated",
          transport_type: nextTransport.type,
          provider: nextTransport.type === "email" ? nextTransport.email.provider : null
        });
        sendJson(res, 200, getTransportResponse(state, runtime));
        return;
      }
      if (method === "POST" && pathname === "/runtime/transport/test") {
        const validation = validateTransportConfig(getRuntimeTransport(state));
        if (validation) {
          sendJson(res, validation.status, validation.body);
          return;
        }
        const result = await testTransportConnection(state, runtime);
        sendJson(res, result.ok ? 200 : result.status || 502, result);
        return;
      }
      if (method === "POST" && pathname === "/setup") {
        ensureResponderIdentity(state);
        state.env = saveOpsState(state);
        appendSupervisorEvent({ type: "setup_completed" });
        sendJson(res, 200, { ok: true, config: state.config });
        return;
      }
      if (method === "POST" && pathname === "/auth/register-caller") {
        const body = await parseJsonBody(req);
        const registered = await registerCaller(body.contact_email, {
          localOnly: normalizedString(body.mode) === "local_only",
          forcePlatform: normalizedString(body.mode) === "platform"
        });
        appendSupervisorEvent({
          type: "caller_registered",
          ok: registered.status === 201,
          contact_email: body.contact_email || null
        });
        if (registered.status === 201) {
          for (const svc of ["caller", "skill-adapter"]) {
            const existing = runtime.processes.get(svc);
            if (existing && !existing.exited) {
              await stopProcessInfo(existing);
            }
            await ensureService(svc);
          }
          appendSupervisorEvent({ type: "services_restarted_after_registration", services: ["caller", "skill-adapter"] });
        }
        sendJson(res, registered.status, registered.body);
        return;
      }
      if (method === "GET" && pathname === "/catalog/hotlines") {
        if (!platformFeaturesEnabled(state)) {
          const items = listLocalCatalogHotlines(state, runtime, {
            hotline_id: url.searchParams.get("hotline_id") || undefined,
            responder_id: url.searchParams.get("responder_id") || undefined,
            task_type: url.searchParams.get("task_type") || undefined,
            capability: url.searchParams.get("capability") || undefined
          });
          sendJson(res, 200, { items });
          return;
        }
        const response = await requestJson(
          processBaseUrl(state.config.runtime.ports.caller),
          `/controller/hotlines${url.search}`
        , {
          headers: buildPlatformHeaders(state, runtime)
        });
        sendJson(res, response.status, response.body);
        return;
      }
      const catalogDetailMatch = pathname.match(/^\/catalog\/hotlines\/([^/]+)$/);
      if (method === "GET" && catalogDetailMatch) {
        const hotlineId = decodeURIComponent(catalogDetailMatch[1]);
        if (!platformFeaturesEnabled(state)) {
          const localItem = listLocalCatalogHotlines(state, runtime, { hotline_id: hotlineId })[0] || null;
          if (!localItem) {
            sendError(res, 404, "HOTLINE_NOT_FOUND", "hotline is not configured locally");
            return;
          }
          sendJson(res, 200, localItem);
          return;
        }
        const response = await requestJson(
          state.config.platform.base_url,
          `/v1/catalog/hotlines/${encodeURIComponent(hotlineId)}`,
          {
            headers: buildPlatformReadHeaders()
          }
        );
        sendJson(res, response.status, response.body);
        return;
      }

      // ------------------------------------------------------------------
      // /caller/approvals proxy → Skill Adapter
      // Allows the Ops Console to read and action pending approval records
      // ------------------------------------------------------------------
      if (pathname.startsWith("/caller/approvals")) {
        const skillAdapterBase = processBaseUrl(state.config.runtime.ports.skill_adapter);
        const upstreamPath = `/skills/remote-hotline/approvals${pathname.slice("/caller/approvals".length)}${url.search}`;
        const body = ["POST", "PUT", "PATCH"].includes(method) ? await parseJsonBody(req) : undefined;
        const response = await requestJson(skillAdapterBase, upstreamPath, {
          method,
          body
        });
        sendJson(res, response.status, response.body);
        return;
      }

      // ------------------------------------------------------------------
      // /caller/global-policy proxy → Skill Adapter
      // ------------------------------------------------------------------
      if (pathname === "/caller/global-policy") {
        const skillAdapterBase = processBaseUrl(state.config.runtime.ports.skill_adapter);
        const body = ["POST", "PUT", "PATCH"].includes(method) ? await parseJsonBody(req) : undefined;
        const response = await requestJson(skillAdapterBase, `/skills/remote-hotline/global-policy`, {
          method,
          body
        });
        sendJson(res, response.status, response.body);
        return;
      }
      if (method === "POST" && pathname === "/calls/prepare") {
        const body = await parseJsonBody(req);
        const response = await prepareCallConfirmation(body);
        sendJson(res, response.status, response.body);
        return;
      }
      if (method === "POST" && pathname === "/calls/confirm") {
        const body = await parseJsonBody(req);
        const response = await confirmPreparedCall(body);
        sendJson(res, response.status, response.body);
        return;
      }
      const preferenceMatch = pathname.match(/^\/preferences\/task-types\/([^/]+)\/hotline$/);
      if (preferenceMatch && method === "PUT") {
        const body = await parseJsonBody(req);
        const preference = setTaskTypePreference(state, decodeURIComponent(preferenceMatch[1]), {
          hotline_id: normalizedString(body.hotline_id),
          responder_id: normalizedString(body.responder_id)
        });
        state.env = saveOpsState(state);
        sendJson(res, 200, {
          ok: true,
          preference
        });
        return;
      }
      if (method === "GET" && pathname === "/preferences/task-types") {
        sendJson(res, 200, { items: Object.values(ensurePreferenceState(state)) });
        return;
      }
      if (method === "GET" && pathname === "/requests") {
        const response = await requestJson(processBaseUrl(state.config.runtime.ports.caller), "/controller/requests");
        sendJson(res, response.status, response.body);
        return;
      }
      const requestMatch = pathname.match(/^\/requests\/([^/]+)$/);
      if (method === "GET" && requestMatch) {
        const response = await requestJson(processBaseUrl(state.config.runtime.ports.caller), `/controller/requests/${requestMatch[1]}`);
        sendJson(res, response.status, response.body);
        return;
      }
      const requestResultMatch = pathname.match(/^\/requests\/([^/]+)\/result$/);
      if (method === "GET" && requestResultMatch) {
        const response = await requestJson(processBaseUrl(state.config.runtime.ports.caller), `/controller/requests/${requestResultMatch[1]}/result`);
        sendJson(res, response.status, response.body);
        return;
      }
      if (method === "POST" && pathname === "/requests") {
        const body = await parseJsonBody(req);
        const response = await requestJson(processBaseUrl(state.config.runtime.ports.caller), "/controller/remote-requests", {
          method: "POST",
          headers: buildPlatformHeaders(state, runtime),
          body
        });
        sendJson(res, response.status, response.body);
        return;
      }
      if (method === "POST" && pathname === "/requests/example") {
        const body = await parseJsonBody(req);
        const response = await dispatchExampleRequest(body);
        sendJson(res, response.status, response.body);
        return;
      }
      if (method === "GET" && pathname === "/responder") {
        await syncResponderReviewStatusesFromPlatform();
        sendJson(res, 200, {
          enabled: state.config.responder.enabled,
          responder_id: state.config.responder.responder_id,
          display_name: state.config.responder.display_name,
          platform_enabled: platformFeaturesEnabled(state),
          hotline_count: (state.config.responder.hotlines || []).length,
          hotlines: (state.config.responder.hotlines || []).map((item) => serializeHotlineForUi(state, runtime, item))
        });
        return;
      }
      if (method === "GET" && pathname === "/responder/hotlines") {
        await syncResponderReviewStatusesFromPlatform();
        sendJson(res, 200, {
          platform_enabled: platformFeaturesEnabled(state),
          items: (state.config.responder.hotlines || []).map((item) => serializeHotlineForUi(state, runtime, item))
        });
        return;
      }
      const hotlineDraftMatch = pathname.match(/^\/responder\/hotlines\/([^/]+)\/draft$/);
      if (method === "GET" && hotlineDraftMatch) {
        const hotlineId = decodeURIComponent(hotlineDraftMatch[1]);
        const hotline = (state.config.responder.hotlines || []).find((item) => item.hotline_id === hotlineId);
        if (!hotline) {
          sendError(res, 404, "hotline_not_found", "no hotline found with this id", { hotline_id: hotlineId });
          return;
        }
        await syncResponderReviewStatusesFromPlatform();
        const registrationDraft = loadHotlineRegistrationDraft(state, hotline);
        sendJson(res, 200, {
          ok: Boolean(registrationDraft.draft),
          hotline_id: hotline.hotline_id,
          platform_enabled: platformFeaturesEnabled(state),
          review_status: hotline.review_status || "local_only",
          submitted_for_review: hotline.submitted_for_review === true,
          draft_file: registrationDraft.draft_file,
          local_integration_file: hotline?.metadata?.local?.integration_file || null,
          local_hook_file: hotline?.metadata?.local?.hook_file || null,
          draft_ready: Boolean(registrationDraft.draft_file),
          runtime: buildResponderRuntimeStatus(state, runtime, hotline.hotline_id),
          draft: registrationDraft.draft
        });
        return;
      }
      if (method === "POST" && pathname === "/responder/hotlines/example") {
        const definition = await addOfficialExampleHotline();
        sendJson(res, 201, {
          ...definition,
          example: true,
          message: `${LOCAL_EXAMPLE_DISPLAY_NAME} is configured locally`
        });
        return;
      }
      if (method === "POST" && pathname === "/responder/hotlines") {
        const body = await parseJsonBody(req);
        const definition = {
          hotline_id: body.hotline_id,
          display_name: body.display_name || body.hotline_id,
          enabled: body.enabled !== false,
          task_types: body.task_types || [],
          capabilities: body.capabilities || [],
          tags: body.tags || [],
          adapter_type: body.adapter_type || "process",
          adapter: body.adapter || {},
          metadata: body.metadata || null,
          timeouts: body.timeouts || { soft_timeout_s: 60, hard_timeout_s: 180 },
          review_status: "local_only",
          submitted_for_review: false
        };
        const registrationDraft = ensureHotlineRegistrationDraft(state, definition);
        upsertHotline(state, definition);
        state.env = saveOpsState(state);
        await reloadResponderIfRunning();
        appendSupervisorEvent({
          type: "hotline_upserted",
          hotline_id: definition.hotline_id,
          adapter_type: definition.adapter_type
        });
        sendJson(res, 201, {
          ...definition,
          local_integration_file: registrationDraft.integration_file,
          local_hook_file: registrationDraft.hook_file,
          registration_draft_file: registrationDraft.draft_file,
          registration_draft: registrationDraft.draft,
          runtime: buildResponderRuntimeStatus(state, runtime, definition.hotline_id)
        });
        return;
      }
      const hotlineToggleMatch = pathname.match(/^\/responder\/hotlines\/([^/]+)\/(enable|disable)$/);
      if (method === "POST" && hotlineToggleMatch) {
        const hotlineId = decodeURIComponent(hotlineToggleMatch[1]);
        const enabled = hotlineToggleMatch[2] === "enable";
        const item = setHotlineEnabled(state, hotlineId, enabled);
        if (!item) {
          sendError(res, 404, "hotline_not_found", "no hotline found with this id", { hotline_id: hotlineId });
          return;
        }
        state.env = saveOpsState(state);
        await reloadResponderIfRunning();
        appendSupervisorEvent({
          type: "hotline_toggled",
          hotline_id: item.hotline_id,
          enabled: item.enabled !== false
        });
        sendJson(res, 200, {
          ok: true,
          hotline_id: item.hotline_id,
          enabled: item.enabled !== false,
          review_status: item.review_status || "local_only",
          submitted_for_review: item.submitted_for_review === true,
          runtime: buildResponderRuntimeStatus(state, runtime, item.hotline_id)
        });
        return;
      }
      const hotlineDeleteMatch = pathname.match(/^\/responder\/hotlines\/([^/]+)$/);
      if (method === "DELETE" && hotlineDeleteMatch) {
        const hotlineId = decodeURIComponent(hotlineDeleteMatch[1]);
        const removed = removeHotline(state, hotlineId);
        if (!removed) {
          sendError(res, 404, "hotline_not_found", "no hotline found with this id", { hotline_id: hotlineId });
          return;
        }
        state.env = saveOpsState(state);
        await reloadResponderIfRunning();
        appendSupervisorEvent({
          type: "hotline_removed",
          hotline_id: removed.hotline_id
        });
        sendJson(res, 200, {
          ok: true,
          removed: {
            hotline_id: removed.hotline_id,
            review_status: removed.review_status || "local_only"
          },
          runtime: buildResponderRuntimeStatus(state, runtime, removed.hotline_id)
        });
        return;
      }
      const hotlineSubmitDraftMatch = pathname.match(/^\/responder\/hotlines\/([^/]+)\/submit-review$/);
      if (method === "POST" && hotlineSubmitDraftMatch) {
        const hotlineId = decodeURIComponent(hotlineSubmitDraftMatch[1]);
        const hotline = (state.config.responder.hotlines || []).find((item) => item.hotline_id === hotlineId);
        if (!hotline) {
          sendError(res, 404, "hotline_not_found", "no hotline found with this id", { hotline_id: hotlineId });
          return;
        }
        ensureResponderIdentity(state);
        state.env = saveOpsState(state);
        const submitted = await submitPendingResponderReviews({ hotlineId });
        await reloadResponderIfRunning();
        appendSupervisorEvent({
          type: "responder_review_submitted",
          responder_id: state.config.responder.responder_id,
          hotline_id: hotlineId,
          submitted: submitted.body?.submitted || 0,
          ok: submitted.status === 201
        });
        sendJson(res, submitted.status, submitted.body);
        return;
      }
      if (method === "POST" && pathname === "/responder/enable") {
        const body = await parseJsonBody(req);
        ensureResponderIdentity(state, {
          responderId: body.responder_id || state.config.responder.responder_id || null,
          displayName: body.display_name || state.config.responder.display_name || null
        });
        state.config.responder.enabled = true;
        if (body.hotline_id) {
          const definition = {
            hotline_id: body.hotline_id,
            display_name: body.display_name || body.hotline_id,
            enabled: true,
            task_types: body.task_types || [],
            capabilities: body.capabilities || [],
            tags: body.tags || [],
            adapter_type: body.adapter_type || "process",
            adapter: body.adapter || { cmd: body.cmd || "" },
            timeouts: body.timeouts || { soft_timeout_s: 60, hard_timeout_s: 180 },
            review_status: "local_only",
            submitted_for_review: false
          };
          ensureHotlineRegistrationDraft(state, definition);
          upsertHotline(state, definition);
        }
        state.env = saveOpsState(state);
        await ensureService("responder");
        appendSupervisorEvent({
          type: "responder_enabled",
          responder_id: state.config.responder.responder_id
        });
        sendJson(res, 200, {
          ok: true,
          responder: state.config.responder,
          submitted: 0,
          review: null
        });
        return;
      }
      if (method === "POST" && pathname === "/responder/submit-review") {
        const body = await parseJsonBody(req);
        ensureResponderIdentity(state, {
          responderId: body.responder_id || state.config.responder.responder_id || null,
          displayName: body.display_name || state.config.responder.display_name || null
        });
        state.env = saveOpsState(state);
        const submitted = await submitPendingResponderReviews({
          hotlineId: normalizedString(body.hotline_id) || null
        });
        await reloadResponderIfRunning();
        appendSupervisorEvent({
          type: "responder_review_submitted",
          responder_id: state.config.responder.responder_id,
          hotline_id: normalizedString(body.hotline_id) || null,
          submitted: submitted.body?.submitted || 0,
          ok: submitted.status === 201
        });
        sendJson(res, submitted.status, submitted.body);
        return;
      }
      if (method === "GET" && pathname === "/runtime/logs") {
        const service = url.searchParams.get("service");
        if (!service) {
          sendError(res, 400, "service_required", "service query parameter is required");
          return;
        }
        const maxLines = Number(url.searchParams.get("max_lines") || 200);
        sendJson(res, 200, {
          service,
          file: getServiceLogFile(service),
          logs: readServiceLogTail(service, { maxLines })
        });
        return;
      }
      if (method === "DELETE" && pathname === "/runtime/logs") {
        const service = url.searchParams.get("service");
        if (!service) {
          sendError(res, 400, "service_required", "service query parameter is required");
          return;
        }
        const logFile = getServiceLogFile(service);
        if (fs.existsSync(logFile)) fs.writeFileSync(logFile, "", "utf8");
        sendJson(res, 200, { ok: true });
        return;
      }
      if (method === "GET" && pathname === "/runtime/alerts") {
        const service = url.searchParams.get("service");
        if (!service) {
          sendError(res, 400, "service_required", "service query parameter is required");
          return;
        }
        const maxItems = Number(url.searchParams.get("max_items") || 20);
        sendJson(res, 200, {
          service,
          alerts: buildRuntimeAlerts(service, { maxItems })
        });
        return;
      }
      if (method === "DELETE" && pathname === "/runtime/alerts") {
        const eventsFile = getSupervisorEventsFile();
        if (fs.existsSync(eventsFile)) fs.writeFileSync(eventsFile, "", "utf8");
        sendJson(res, 200, { ok: true });
        return;
      }
      if (method === "GET" && pathname === "/debug/snapshot") {
        const status = await buildStatus();
        sendJson(res, 200, {
          ok: true,
          generated_at: nowIso(),
          status,
          recent_events: readSupervisorEventTail({ maxLines: 50 }),
          log_tail: {
            relay: readServiceLogTail("relay", { maxLines: 50 }),
            caller: readServiceLogTail("caller", { maxLines: 50 }),
            responder: readServiceLogTail("responder", { maxLines: 50 })
          }
        });
        return;
      }
      if (method === "GET" && pathname === "/mcp-adapter/spec") {
        sendJson(res, 200, {
          ok: true,
          spec: buildMcpAdapterSpec()
        });
        return;
      }

      const serviceRestartMatch = pathname.match(/^\/runtime\/services\/([^/]+)\/restart$/);
      if (method === "POST" && serviceRestartMatch) {
        const name = serviceRestartMatch[1];
        if (!["caller", "responder", "relay", "skill-adapter", "mcp-adapter"].includes(name)) {
          sendError(res, 400, "invalid_service", "service must be caller, responder, relay, skill-adapter, or mcp-adapter");
          return;
        }
        const existing = runtime.processes.get(name);
        if (existing && !existing.exited) {
          await stopProcessInfo(existing);
        }
        await ensureService(name);
        appendSupervisorEvent({ type: "service_restarted", service: name });
        sendJson(res, 200, { ok: true, service: name });
        return;
      }

      sendError(res, 404, "not_found", "no matching route", { path: pathname });
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_json") {
        sendError(res, 400, "invalid_json", "request body is not valid JSON");
        return;
      }
      sendError(res, 500, "ops_supervisor_internal_error", error instanceof Error ? error.message : "unknown_error", { retryable: true });
    }
  });

  server.startManagedServices = async () => {
    ensureResponderIdentity(state);
    state.env = saveOpsState(state);
    await ensureBaseServices();
    appendSupervisorEvent({ type: "managed_services_started" });
  };

  server.stopManagedServices = async () => {
    for (const processInfo of runtime.processes.values()) {
      await stopProcessInfo(processInfo);
    }
    appendSupervisorEvent({ type: "managed_services_stopped" });
  };

  return server;
}
