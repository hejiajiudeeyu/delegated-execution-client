#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { ensureOpsDirectories, readJsonFile } from "@delexec/runtime-utils";
import { buildStructuredError } from "@delexec/contracts";
import { createOpsSupervisorServer } from "./supervisor.js";
import {
  buildHotlineOnboardingBody,
  ensureHotlineRegistrationDraft,
  ensureOpsState,
  ensureResponderIdentity,
  loadHotlineRegistrationDraft,
  removeHotline,
  saveOpsState,
  setHotlineEnabled,
  upsertHotline
} from "./config.js";
import { buildExampleHotlineDefinition, LOCAL_EXAMPLE_HOTLINE_ID } from "./example-hotline.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(import.meta.url);
const CLIENT_ROOT = path.resolve(path.dirname(CLI_PATH), "../../..");
const OPS_CONSOLE_DIR = path.join(CLIENT_ROOT, "apps/ops-console");
const DEFAULT_CONSOLE_HOST = "127.0.0.1";
const DEFAULT_CONSOLE_PORT = 4173;
const OPS_SESSION_HEADER = "X-Ops-Session";

function getOpsSessionFile() {
  return path.join(ensureOpsDirectories(), "run", "session.json");
}

function usage() {
  console.log(`Usage:
  delexec-ops setup
  delexec-ops start
  delexec-ops status
  delexec-ops bootstrap [--email <email>] [--platform <url>] [--text <text>] [--open-ui] [--ui-port <port>] [--ui-host <host>] [--no-browser]
  delexec-ops ui start [--host <host>] [--port <port>] [--open] [--no-browser]
  delexec-ops auth register --email <email> [--local] [--platform <url>]
  delexec-ops enable-responder [--responder-id <id>] [--display-name <name>]
  delexec-ops add-hotline --type <process|http> --hotline-id <id> [options]
  delexec-ops attach-project --project-path <path> [--project-name <name>] [--project-description <text>] [--hotline-id <id>] [--cmd <command> | --url <url>] [--task-type <type>] [--capability <capability>]
  delexec-ops add-example-hotline
  delexec-ops remove-hotline --hotline-id <id>
  delexec-ops enable-hotline --hotline-id <id>
  delexec-ops disable-hotline --hotline-id <id>
  delexec-ops submit-review [--hotline-id <id>]
  delexec-ops responder show-draft --hotline-id <id>
  delexec-ops responder submit-draft --hotline-id <id>
  delexec-ops run-example [--text <text>]
  delexec-ops doctor
  delexec-ops debug-snapshot

Product terms:
  Caller = Caller
  Responder = Responder
  Hotline = catalog-facing service entry backed by a responder/hotline pair
  Platform Control = web UI for operator review and oversight

Compatibility:
  delexec-ops responder init
  delexec-ops responder register
  delexec-ops responder add-hotline ...
  delexec-ops responder start
  delexec-ops responder status
  delexec-ops responder doctor
  delexec-ops responder init
  delexec-ops responder register
  delexec-ops responder add-hotline ...
  delexec-ops responder start
  delexec-ops responder status
  delexec-ops responder doctor`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    const value = !next || next.startsWith("--") ? true : next;
    if (value !== true) {
      index += 1;
    }
    if (args[key] === undefined) {
      args[key] = value;
    } else if (Array.isArray(args[key])) {
      args[key].push(value);
    } else {
      args[key] = [args[key], value];
    }
  }
  return args;
}

function emit(value) {
  console.log(JSON.stringify(value, null, 2));
}

function logBootstrapStep(steps, step, ok, detail = {}) {
  steps.push({ step, ok, ...detail });
}

function getValues(value) {
  if (value === undefined || value === null || value === false) {
    return [];
  }
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function sanitizeIdSegment(value) {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "") || "project"
  );
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

function readSupervisorSessionToken() {
  const session = readJsonFile(getOpsSessionFile(), null);
  if (!session?.token || !session?.expires_at) {
    return null;
  }
  const expiresAt = Date.parse(session.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }
  return String(session.token);
}

function writeSupervisorSessionToken(session) {
  if (!session?.token || !session?.expires_at) {
    return false;
  }
  ensureOpsDirectories();
  const sessionFile = getOpsSessionFile();
  fs.writeFileSync(
    sessionFile,
    `${JSON.stringify({ token: String(session.token), expires_at: String(session.expires_at) }, null, 2)}\n`,
    "utf8"
  );
  return true;
}

function withSupervisorSessionHeaders(headers = {}) {
  const token = readSupervisorSessionToken();
  return token ? { ...headers, [OPS_SESSION_HEADER]: token } : headers;
}

async function recoverSupervisorSession(state) {
  const response = await requestJson(supervisorUrlFromState(state), "/auth/session");
  const session = response.body?.recoverable_session;
  if (!session?.token || !session?.expires_at) {
    return false;
  }
  return writeSupervisorSessionToken(session);
}

async function requestSupervisorJson(state, pathname, options = {}) {
  let response = await requestJson(supervisorUrlFromState(state), pathname, {
    ...options,
    headers: withSupervisorSessionHeaders(options.headers || {})
  });
  if (response.status === 401 && response.body?.error?.code === "AUTH_SESSION_REQUIRED") {
    const sessionFile = getOpsSessionFile();
    if (fs.existsSync(sessionFile)) {
      try {
        fs.rmSync(sessionFile, { force: true });
      } catch {}
    }
    const recovered = await recoverSupervisorSession(state).catch(() => false);
    if (recovered) {
      response = await requestJson(supervisorUrlFromState(state), pathname, {
        ...options,
        headers: withSupervisorSessionHeaders(options.headers || {})
      });
    }
  }
  return response;
}

async function runCliSubcommand(args, env) {
  const result = await execFileAsync(process.execPath, [CLI_PATH, ...args], { env });
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

async function waitFor(check, { timeoutMs = 15000, intervalMs = 250 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return await check();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("timeout");
}

function parsePort(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function resolveUiConfig(args = {}) {
  return {
    host: String(args["ui-host"] || args.host || process.env.DELEXEC_OPS_UI_HOST || DEFAULT_CONSOLE_HOST).trim() || DEFAULT_CONSOLE_HOST,
    port: parsePort(args["ui-port"] || args.port || process.env.DELEXEC_OPS_UI_PORT, DEFAULT_CONSOLE_PORT),
    openBrowser: args["no-browser"] ? false : args["open-ui"] === true || args.open === true
  };
}

function uiUrl({ host, port }) {
  return `http://${host}:${port}`;
}

function corepackExecutable() {
  return process.platform === "win32" ? "corepack.cmd" : "corepack";
}

function canLaunchOpsConsoleWorkspace() {
  return fs.existsSync(path.join(OPS_CONSOLE_DIR, "package.json"));
}

function buildUiLaunchCommand({ host, port }) {
  const bin = process.env.DELEXEC_OPS_UI_BIN;
  const customArgs = process.env.DELEXEC_OPS_UI_ARGS ? JSON.parse(process.env.DELEXEC_OPS_UI_ARGS) : null;
  if (bin) {
    return {
      command: bin,
      args: Array.isArray(customArgs) ? customArgs : [],
      cwd: CLIENT_ROOT,
      launch_mode: "configured_command"
    };
  }
  if (!canLaunchOpsConsoleWorkspace()) {
    throw new Error("ops_console_workspace_required");
  }
  return {
    command: corepackExecutable(),
    args: [
      "pnpm",
      "--dir",
      CLIENT_ROOT,
      "--filter",
      "@delexec/ops-console",
      "run",
      "dev",
      "--",
      "--host",
      host,
      "--port",
      String(port),
      "--strictPort"
    ],
    cwd: CLIENT_ROOT,
    launch_mode: "workspace_vite"
  };
}

async function waitForUi(url) {
  return waitFor(async () => {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error("ui_not_ready");
    }
    return true;
  }, { timeoutMs: 30000, intervalMs: 500 });
}

function openBrowser(url) {
  const configuredBin = process.env.DELEXEC_OPS_BROWSER_BIN;
  const configuredArgs = process.env.DELEXEC_OPS_BROWSER_ARGS ? JSON.parse(process.env.DELEXEC_OPS_BROWSER_ARGS) : null;
  if (configuredBin) {
    const child = spawn(configuredBin, [...(Array.isArray(configuredArgs) ? configuredArgs : []), url], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return { opened: true, command: configuredBin };
  }

  const browserCommand =
    process.platform === "darwin"
      ? { command: "open", args: [url] }
      : process.platform === "win32"
        ? { command: "cmd", args: ["/c", "start", "", url] }
        : { command: "xdg-open", args: [url] };

  const child = spawn(browserCommand.command, browserCommand.args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return { opened: true, command: browserCommand.command };
}

async function ensureUiAvailable(args = {}, env = process.env) {
  const ui = resolveUiConfig(args);
  const consoleUrl = uiUrl(ui);
  let alreadyRunning = false;
  try {
    const probe = await fetch(consoleUrl, { method: "GET", signal: AbortSignal.timeout(2000) });
    alreadyRunning = probe.ok;
  } catch {}

  let pid = null;
  let launchMode = "existing";
  if (!alreadyRunning) {
    const launch = buildUiLaunchCommand(ui);
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: {
        ...env,
        DELEXEC_OPS_UI_HOST: ui.host,
        DELEXEC_OPS_UI_PORT: String(ui.port)
      },
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    pid = child.pid || null;
    launchMode = launch.launch_mode;
    await waitForUi(consoleUrl);
  }

  let browser = { opened: false };
  if (ui.openBrowser) {
    browser = openBrowser(consoleUrl);
  }

  return {
    ok: true,
    url: consoleUrl,
    host: ui.host,
    port: ui.port,
    started: !alreadyRunning,
    pid,
    launch_mode: launchMode,
    browser
  };
}

function buildResponderRegisterHeaders(state) {
  const apiKey =
    state.config.caller.api_key ||
    state.env.CALLER_PLATFORM_API_KEY ||
    state.env.PLATFORM_API_KEY ||
    process.env.CALLER_PLATFORM_API_KEY ||
    process.env.PLATFORM_API_KEY ||
    state.env.RESPONDER_PLATFORM_API_KEY;
  if (!apiKey) {
    throw new Error("caller_platform_api_key_required");
  }
  return { Authorization: `Bearer ${apiKey}` };
}

async function verifyRegisteredHotline(state, { hotlineId, expectedTemplateRef }) {
  let detail;
  let bundle;
  try {
    detail = await requestJson(state.config.platform.base_url, `/v1/catalog/hotlines/${encodeURIComponent(hotlineId)}`, {
      headers: buildResponderRegisterHeaders(state)
    });
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
          headers: buildResponderRegisterHeaders(state)
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

function parseHotlineDefinition(args) {
  const type = String(args.type || "process");
  const hotlineId = String(args["hotline-id"] || "").trim();
  if (!hotlineId) {
    throw new Error("hotline_id_required");
  }
  const definition = {
    hotline_id: hotlineId,
    display_name: String(args["display-name"] || hotlineId),
    enabled: true,
    task_types: getValues(args["task-type"]),
    capabilities: getValues(args.capability),
    tags: getValues(args.tag),
    adapter_type: type,
    timeouts: {
      soft_timeout_s: Number(args["soft-timeout-s"] || 60),
      hard_timeout_s: Number(args["hard-timeout-s"] || 180)
    },
    review_status: "local_only",
    submitted_for_review: false
  };
  if (type === "http") {
    const url = String(args.url || "").trim();
    if (!url) {
      throw new Error("http_adapter_url_required");
    }
    definition.adapter = {
      url,
      method: String(args.method || "POST").toUpperCase()
    };
    return definition;
  }
  const cmd = String(args.cmd || "").trim();
  if (!cmd) {
    throw new Error("process_adapter_cmd_required");
  }
  definition.adapter = {
    cmd,
    cwd: args.cwd ? String(args.cwd) : undefined,
    env: {}
  };
  return definition;
}

function buildProjectHotlineDefinition(args) {
  const rawProjectPath = String(args["project-path"] || "").trim();
  if (!rawProjectPath) {
    throw new Error("project_path_required");
  }
  const projectPath = path.resolve(rawProjectPath);
  if (!fs.existsSync(projectPath)) {
    throw new Error("project_path_not_found");
  }

  const projectName = String(args["project-name"] || path.basename(projectPath) || "Local Project").trim();
  const projectDescription = String(args["project-description"] || args.description || "").trim();
  const adapterType = String(args.type || (args.url ? "http" : "process")).trim();
  const hotlineId = String(args["hotline-id"] || `local.${sanitizeIdSegment(projectName)}.v1`).trim();
  const tags = Array.from(new Set(["local", "project", ...getValues(args.tag)]));
  const taskTypes = getValues(args["task-type"]);
  const capabilities = getValues(args.capability);

  const definition = {
    hotline_id: hotlineId,
    display_name: String(args["display-name"] || projectName).trim(),
    enabled: true,
    task_types: taskTypes.length > 0 ? taskTypes : ["project_task"],
    capabilities: capabilities.length > 0 ? capabilities : [`project.${sanitizeIdSegment(projectName)}`],
    tags,
    adapter_type: adapterType,
    timeouts: {
      soft_timeout_s: Number(args["soft-timeout-s"] || 60),
      hard_timeout_s: Number(args["hard-timeout-s"] || 180)
    },
    review_status: "local_only",
    submitted_for_review: false,
    metadata: {
      project: {
        path: projectPath,
        name: projectName,
        description: projectDescription || null,
        mount_kind: "local_project"
      }
    }
  };

  if (adapterType === "http") {
    const url = String(args.url || "").trim();
    if (!url) {
      throw new Error("http_adapter_url_required");
    }
    definition.adapter = {
      url,
      method: String(args.method || "POST").toUpperCase()
    };
    return definition;
  }

  const cmd = String(args.cmd || "").trim();
  if (!cmd) {
    throw new Error("process_adapter_cmd_required");
  }
  definition.adapter = {
    cmd,
    cwd: args.cwd ? String(args.cwd) : projectPath,
    env: {}
  };
  return definition;
}

function supervisorUrlFromState(state) {
  return `http://127.0.0.1:${state.config.runtime.ports.supervisor}`;
}

async function ensureSupervisorAvailable(baseUrl, env) {
  try {
    const health = await requestJson(baseUrl, "/healthz");
    if (health.status === 200) {
      return { started: false };
    }
  } catch {}

  const child = spawn(process.execPath, [CLI_PATH, "start"], {
    env,
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  await waitFor(async () => {
    const health = await requestJson(baseUrl, "/healthz");
    if (health.status !== 200) {
      throw new Error("supervisor_not_ready");
    }
    return health;
  });
  return { started: true };
}

async function maybeApproveExample({ platformUrl, adminApiKey, responderId }) {
  if (!adminApiKey) {
    return { ok: false, reason: "admin_api_key_missing" };
  }
  const headers = { Authorization: `Bearer ${adminApiKey}` };
  const responder = await requestJson(platformUrl, `/v2/admin/responders/${encodeURIComponent(responderId)}/approve`, {
    method: "POST",
    headers,
    body: { reason: "ops bootstrap local demo approval" }
  });
  const hotline = await requestJson(platformUrl, `/v2/admin/hotlines/${encodeURIComponent(LOCAL_EXAMPLE_HOTLINE_ID)}/approve`, {
    method: "POST",
    headers,
    body: { reason: "ops bootstrap local demo approval" }
  });
  return {
    ok: responder.status === 200 && hotline.status === 200,
    responder,
    hotline
  };
}

async function waitForCatalogVisibility(supervisorUrl, responderId, options) {
  return waitFor(async () => {
    const catalog = await requestJson(
      supervisorUrl,
      `/catalog/hotlines?hotline_id=${encodeURIComponent(LOCAL_EXAMPLE_HOTLINE_ID)}&responder_id=${encodeURIComponent(responderId)}`
    );
    const item = catalog.body?.items?.find(
      (entry) => entry.hotline_id === LOCAL_EXAMPLE_HOTLINE_ID && entry.responder_id === responderId
    );
    if (!item) {
      throw new Error("catalog_not_ready");
    }
    return item;
  }, options);
}

async function commandSetup(args = {}) {
  const state = ensureOpsState();
  ensureResponderIdentity(state, {
    responderId: args["responder-id"] ? String(args["responder-id"]) : null,
    displayName: args["display-name"] ? String(args["display-name"]) : null
  });
  state.env = saveOpsState(state);
  emit({
    ok: true,
    ops_home: path.dirname(state.envFile),
    env_file: state.envFile,
    config_file: state.opsConfigFile,
    config: state.config
  });
}

async function commandStart() {
  const state = ensureOpsState();
  ensureResponderIdentity(state);
  state.env = saveOpsState(state);
  const server = createOpsSupervisorServer();
  await new Promise((resolve) => server.listen(state.config.runtime.ports.supervisor, "127.0.0.1", resolve));
  await server.startManagedServices();
  console.log(`[ops-supervisor] listening on ${state.config.runtime.ports.supervisor}`);
  server.on("close", () => {
    void server.stopManagedServices();
  });
}

async function commandStatus() {
  const state = ensureOpsState();
  try {
    const response = await requestJson(supervisorUrlFromState(state), "/status");
    emit(response.body);
  } catch {
    emit({
      ok: false,
      running: false,
      config: state.config
    });
  }
}

async function commandAuthRegister(args) {
  const state = ensureOpsState();
  const localOnly = args.local === true;
  if (args.platform) {
    state.config.platform.base_url = String(args.platform).trim();
    state.config.platform.enabled = true;
    state.config.platform_console ||= {};
    state.config.platform_console.base_url = state.config.platform.base_url;
    state.env = saveOpsState(state);
  }
  const email = String(args.email || "").trim();
  if (!email) {
    throw new Error("email_required");
  }
  const fallbackRegister = async () => {
    const local = ensureOpsState();
    local.config.platform.base_url = String(args.platform || local.config.platform.base_url).trim();
    local.config.platform.enabled = true;
    local.config.platform_console ||= {};
    local.config.platform_console.base_url = local.config.platform.base_url;
    const direct = await requestJson(local.config.platform.base_url, "/v1/users/register", {
      method: "POST",
      body: { contact_email: email }
    });
    if (direct.status === 201) {
      local.config.caller.api_key = direct.body.api_key;
      local.config.caller.contact_email = direct.body.contact_email || email;
      local.env = saveOpsState(local);
    }
    return direct;
  };
  let response;
  try {
    response = await requestSupervisorJson(state, "/auth/register-caller", {
      method: "POST",
      body: {
        contact_email: email,
        mode: localOnly ? "local_only" : "platform"
      }
    });
    if (!localOnly && response.status === 401 && response.body?.error?.code === "AUTH_SESSION_REQUIRED") {
      response = await fallbackRegister();
    }
  } catch {
    response = localOnly
      ? (() => {
          state.config.caller.contact_email = email;
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
              contact_email: email
            }
          };
        })()
      : await fallbackRegister();
  }
  emit({
    ok: response.status === 201,
    ...response.body
  });
}

async function commandEnableResponder(args) {
  const state = ensureOpsState();
  state.config.responder.enabled = true;
  ensureResponderIdentity(state, {
    responderId: args["responder-id"] ? String(args["responder-id"]) : null,
    displayName: args["display-name"] ? String(args["display-name"]) : null
  });
  state.env = saveOpsState(state);
  try {
    const response = await requestSupervisorJson(state, "/responder/enable", {
      method: "POST",
      body: {
        responder_id: state.config.responder.responder_id,
        display_name: state.config.responder.display_name
      }
    });
    emit(response.body);
  } catch {
    emit({
      ok: true,
      responder: state.config.responder,
      submitted: 0,
      review: null
    });
  }
}

async function commandAddHotline(args) {
  const state = ensureOpsState();
  const definition = parseHotlineDefinition(args);
  const registrationDraft = ensureHotlineRegistrationDraft(state, definition);
  upsertHotline(state, definition);
  state.env = saveOpsState(state);
  let runtime = { synced: false, auth_required: false };
  try {
    const response = await requestSupervisorJson(state, "/responder/hotlines", {
      method: "POST",
      body: definition
    });
    if (response.status === 201) {
      runtime = {
        synced: true,
        auth_required: false,
        ...(response.body?.runtime || {})
      };
    } else if (response.status === 401 && response.body?.error?.code === "AUTH_SESSION_REQUIRED") {
      runtime = { synced: false, auth_required: true };
    }
  } catch {}
  emit({
    ok: true,
    hotline_id: definition.hotline_id,
    adapter_type: definition.adapter_type,
    runtime,
    local_integration_file: registrationDraft.integration_file,
    local_hook_file: registrationDraft.hook_file,
    registration_draft_file: registrationDraft.draft_file,
    registration_draft: registrationDraft.draft
  });
}

async function commandAttachProject(args) {
  const state = ensureOpsState();
  const definition = buildProjectHotlineDefinition(args);
  const registrationDraft = ensureHotlineRegistrationDraft(state, definition);
  upsertHotline(state, definition);
  state.env = saveOpsState(state);
  let runtime = { synced: false, auth_required: false };
  try {
    const response = await requestSupervisorJson(state, "/responder/hotlines", {
      method: "POST",
      body: definition
    });
    if (response.status === 201) {
      runtime = {
        synced: true,
        auth_required: false,
        ...(response.body?.runtime || {})
      };
    } else if (response.status === 401 && response.body?.error?.code === "AUTH_SESSION_REQUIRED") {
      runtime = { synced: false, auth_required: true };
    }
  } catch {}
  emit({
    ok: true,
    hotline_id: definition.hotline_id,
    adapter_type: definition.adapter_type,
    project: definition.metadata.project,
    runtime,
    local_integration_file: registrationDraft.integration_file,
    local_hook_file: registrationDraft.hook_file,
    registration_draft_file: registrationDraft.draft_file,
    registration_draft: registrationDraft.draft
  });
}

async function commandAddExampleHotline() {
  const state = ensureOpsState();
  const definition = buildExampleHotlineDefinition();
  const registrationDraft = ensureHotlineRegistrationDraft(state, definition);
  upsertHotline(state, definition);
  state.env = saveOpsState(state);
  try {
    const response = await requestJson(supervisorUrlFromState(state), "/responder/hotlines/example", {
      method: "POST",
      body: {}
    });
    emit(response.body);
    return;
  } catch {}
  emit({
    ok: true,
    example: true,
    hotline_id: definition.hotline_id,
    adapter_type: definition.adapter_type,
    local_integration_file: registrationDraft.integration_file,
    local_hook_file: registrationDraft.hook_file,
    registration_draft_file: registrationDraft.draft_file,
    registration_draft: registrationDraft.draft
  });
}

async function commandSetHotlineEnabled(args, enabled) {
  const state = ensureOpsState();
  const hotlineId = String(args["hotline-id"] || "").trim();
  if (!hotlineId) {
    throw new Error("hotline_id_required");
  }
  const item = setHotlineEnabled(state, hotlineId, enabled);
  if (!item) {
    throw new Error("hotline_not_found");
  }
  state.env = saveOpsState(state);
  try {
    const response = await requestSupervisorJson(
      state,
      `/responder/hotlines/${encodeURIComponent(hotlineId)}/${enabled ? "enable" : "disable"}`,
      {
        method: "POST",
        body: {}
      }
    );
    emit(response.body);
    return;
  } catch {}
  emit({
    ok: true,
    hotline_id: item.hotline_id,
    enabled: item.enabled !== false
  });
}

async function commandRemoveHotline(args) {
  const state = ensureOpsState();
  const hotlineId = String(args["hotline-id"] || "").trim();
  if (!hotlineId) {
    throw new Error("hotline_id_required");
  }
  const item = removeHotline(state, hotlineId);
  if (!item) {
    throw new Error("hotline_not_found");
  }
  state.env = saveOpsState(state);
  try {
    const response = await requestSupervisorJson(state, `/responder/hotlines/${encodeURIComponent(hotlineId)}`, {
      method: "DELETE"
    });
    emit(response.body);
    return;
  } catch {}
  emit({
    ok: true,
    removed: {
      hotline_id: item.hotline_id
    }
  });
}

function requireHotlineIdArg(args) {
  const hotlineId = String(args["hotline-id"] || "").trim();
  if (!hotlineId) {
    throw new Error("hotline_id_required");
  }
  return hotlineId;
}

async function commandShowDraft(args = {}) {
  const state = ensureOpsState();
  const hotlineId = requireHotlineIdArg(args);
  const hotline = (state.config.responder.hotlines || []).find((item) => item.hotline_id === hotlineId);
  if (!hotline) {
    throw new Error("hotline_not_found");
  }
  try {
    const response = await requestSupervisorJson(state, `/responder/hotlines/${encodeURIComponent(hotlineId)}/draft`);
    if (response.status === 200) {
      emit(response.body);
      return;
    }
  } catch {}

  const registrationDraft = loadHotlineRegistrationDraft(state, hotline);
  emit({
    ok: Boolean(registrationDraft.draft),
    hotline_id: hotline.hotline_id,
    review_status: hotline.review_status || "local_only",
    submitted_for_review: hotline.submitted_for_review === true,
    local_integration_file: hotline?.metadata?.local?.integration_file || null,
    local_hook_file: hotline?.metadata?.local?.hook_file || null,
    draft_file: registrationDraft.draft_file,
    draft: registrationDraft.draft
  });
}

async function commandSubmitReview(args = {}) {
  const state = ensureOpsState();
  const hotlineId = args["hotline-id"] ? requireHotlineIdArg(args) : null;
  if (hotlineId) {
    const hotline = (state.config.responder.hotlines || []).find((item) => item.hotline_id === hotlineId);
    if (!hotline) {
      throw new Error("hotline_not_found");
    }
  }
  const responderIdentity = ensureResponderIdentity(state, {
    responderId: args["responder-id"] ? String(args["responder-id"]) : null,
    displayName: args["display-name"] ? String(args["display-name"]) : null
  });
  state.env = saveOpsState(state);
  const pending = (state.config.responder.hotlines || []).filter(
    (item) => item.submitted_for_review !== true && (!hotlineId || item.hotline_id === hotlineId)
  );
  for (const item of pending) {
    try {
      buildHotlineOnboardingBody(state, item, responderIdentity);
    } catch (error) {
      emit(buildStructuredError(
        error?.code || "HOTLINE_DRAFT_INVALID",
        error instanceof Error ? error.message : "hotline registration draft is invalid",
        { fields: Array.isArray(error?.fields) ? error.fields : [] }
      ));
      return;
    }
  }
  try {
    const response = await requestSupervisorJson(state, "/responder/submit-review", {
      method: "POST",
      body: {
        responder_id: state.config.responder.responder_id,
        display_name: state.config.responder.display_name,
        hotline_id: hotlineId
      }
    });
    if (response.status === 201) {
      emit(response.body);
      return;
    }
  } catch {}
  const results = [];
  for (const item of pending) {
    let onboarding;
    try {
      onboarding = buildHotlineOnboardingBody(state, item, responderIdentity);
    } catch (error) {
      emit(buildStructuredError(
        error?.code || "HOTLINE_DRAFT_INVALID",
        error instanceof Error ? error.message : "hotline registration draft is invalid",
        { fields: Array.isArray(error?.fields) ? error.fields : [] }
      ));
      return;
    }
    const response = await requestJson(state.config.platform.base_url, "/v2/hotlines", {
      method: "POST",
      headers: buildResponderRegisterHeaders(state),
      body: onboarding.body
    });
    if (response.status !== 201) {
      emit(response.body);
      return;
    }
    state.env.RESPONDER_PLATFORM_API_KEY = response.body.responder_api_key || response.body.api_key;
    item.submitted_for_review = true;
    item.review_status = response.body.hotline_review_status || response.body.review_status || "pending";
    const verification = await verifyRegisteredHotline(state, {
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
  state.env = saveOpsState(state);
  emit({
    ok: true,
    responder_id: state.config.responder.responder_id,
    submitted: results.length,
    results
  });
}

async function commandDoctor() {
  const state = ensureOpsState();
  const adapterChecks = (state.config.responder.hotlines || []).map((item) => {
    if (item.adapter_type === "http") {
      const valid = typeof item.adapter?.url === "string" && item.adapter.url.startsWith("http");
      return {
        hotline_id: item.hotline_id,
        adapter_type: item.adapter_type,
        ok: valid,
        detail: valid ? item.adapter.url : "invalid_http_url"
      };
    }
    const cmd = String(item.adapter?.cmd || "").trim();
    const firstToken = cmd.split(/\s+/).filter(Boolean)[0] || "";
    const isAbsolute = firstToken.startsWith("/");
    const valid = Boolean(cmd) && (!isAbsolute || fs.existsSync(firstToken));
    return {
      hotline_id: item.hotline_id,
      adapter_type: item.adapter_type || "process",
      ok: valid,
      detail: valid ? cmd : "process_command_missing_or_not_found"
    };
  });
  try {
    const response = await requestJson(supervisorUrlFromState(state), "/status");
    emit({
      ok: true,
      checks: response.body.runtime,
      debug: response.body.debug,
      adapters: adapterChecks
    });
  } catch (error) {
    emit({
      ok: false,
      message: error instanceof Error ? error.message : "unknown_error",
      config: state.config,
      adapters: adapterChecks
    });
  }
}

async function commandDebugSnapshot() {
  const state = ensureOpsState();
  const response = await requestSupervisorJson(state, "/debug/snapshot");
  emit(response.body);
}

async function commandRunExample(args) {
  const state = ensureOpsState();
  const text = String(args.text || "Summarize this local example request.").trim();
  const response = await requestSupervisorJson(state, "/requests/example", {
    method: "POST",
    body: { text }
  });
  emit({
    ok: response.status === 201,
    ...response.body
  });
}

async function commandBootstrap(args) {
  const steps = [];
  const initialState = ensureOpsState();
  const setupArgs = ["setup"];
  if (args["responder-id"]) {
    setupArgs.push("--responder-id", String(args["responder-id"]));
  }
  if (args["display-name"]) {
    setupArgs.push("--display-name", String(args["display-name"]));
  }

  const platformUrl = String(args.platform || initialState.config.platform.base_url || process.env.PLATFORM_API_BASE_URL || "http://127.0.0.1:8080").trim();
  const env = { ...process.env, PLATFORM_API_BASE_URL: platformUrl };
  const bootstrapUsesPlatform = Boolean(args.platform || process.env.PLATFORM_API_BASE_URL);

  try {
    const setup = await runCliSubcommand(setupArgs, env);
    logBootstrapStep(steps, "setup_ok", true, { ops_home: setup.ops_home });

    let state = ensureOpsState();
    if (bootstrapUsesPlatform) {
      state.config.platform.enabled = true;
      state.config.platform.base_url = platformUrl;
      state.config.platform_console ||= {};
      state.config.platform_console.base_url = platformUrl;
      state.env = saveOpsState(state);
      logBootstrapStep(steps, "platform_enabled", true, { platform_url: platformUrl });
    }
    const email =
      String(args.email || state.config.caller.contact_email || process.env.BOOTSTRAP_CALLER_EMAIL || "").trim() ||
      `ops-user-${Date.now()}@local.test`;
    if (state.config.caller.api_key && state.config.caller.contact_email) {
      logBootstrapStep(steps, "caller_registered", true, {
        caller_email: state.config.caller.contact_email,
        existing: true
      });
    } else {
      const registerArgs = bootstrapUsesPlatform
        ? ["auth", "register", "--email", email, "--platform", platformUrl]
        : ["auth", "register", "--email", email, "--local"];
      const register = await runCliSubcommand(registerArgs, env);
      logBootstrapStep(steps, "caller_registered", register.ok === true, {
        caller_email: register.contact_email || email,
        mode: register.mode || (bootstrapUsesPlatform ? "platform" : "local_only")
      });
      if (register.ok !== true) {
        emit({
          ok: false,
          stage: "caller_register_failed",
          steps,
          response: register
        });
        return;
      }
    }

    state = ensureOpsState();
    const hasExample = (state.config.responder.hotlines || []).some((item) => item.hotline_id === LOCAL_EXAMPLE_HOTLINE_ID);
    if (hasExample) {
      logBootstrapStep(steps, "example_hotline_added", true, {
        hotline_id: LOCAL_EXAMPLE_HOTLINE_ID,
        existing: true
      });
    } else {
      const added = await runCliSubcommand(["add-example-hotline"], env);
      logBootstrapStep(steps, "example_hotline_added", added.ok !== false, {
        hotline_id: added.hotline_id || LOCAL_EXAMPLE_HOTLINE_ID
      });
      if (added.ok === false) {
        emit({
          ok: false,
          stage: "example_hotline_add_failed",
          steps,
          response: added
        });
        return;
      }
    }

    state = ensureOpsState();
    const example = (state.config.responder.hotlines || []).find((item) => item.hotline_id === LOCAL_EXAMPLE_HOTLINE_ID);
    if (bootstrapUsesPlatform) {
      if (example?.submitted_for_review === true) {
        logBootstrapStep(steps, "review_submitted", true, {
          submitted: 0,
          existing: true
        });
      } else {
        const review = await runCliSubcommand(["submit-review"], env);
        const reviewOk = review.ok === true || typeof review.submitted === "number";
        logBootstrapStep(steps, "review_submitted", reviewOk, {
          submitted: review.submitted || 0
        });
        if (!reviewOk) {
          emit({
            ok: false,
            stage: "submit_review_failed",
            steps,
            response: review
          });
          return;
        }
      }
    } else {
      logBootstrapStep(steps, "review_skipped", true, {
        mode: "local_only"
      });
    }

    const enabled = await runCliSubcommand(["enable-responder"], env);
    const responderId = enabled.responder?.responder_id || enabled.responder_id || ensureOpsState().config.responder.responder_id;
    logBootstrapStep(steps, "responder_enabled", enabled.ok === true, { responder_id: responderId });
    if (enabled.ok !== true) {
      emit({
        ok: false,
        stage: "enable_responder_failed",
        steps,
        response: enabled
      });
      return;
    }

    const supervisorUrl = supervisorUrlFromState(ensureOpsState());
    const supervisor = await ensureSupervisorAvailable(supervisorUrl, env);
    logBootstrapStep(steps, "supervisor_started", true, supervisor);

    const adminApiKey = process.env.PLATFORM_ADMIN_API_KEY || process.env.ADMIN_API_KEY || null;
    if (bootstrapUsesPlatform) {
      let catalogVisible = null;
      try {
        catalogVisible = await waitForCatalogVisibility(supervisorUrl, responderId, {
          timeoutMs: 750,
          intervalMs: 150
        });
      } catch {}

      if (adminApiKey) {
        const approved = await maybeApproveExample({
          platformUrl,
          adminApiKey,
          responderId
        });
        if (!approved.ok && !catalogVisible) {
          emit({
            ok: false,
            stage: "awaiting_admin_approval",
            steps,
            responder_id: responderId,
            hotline_id: LOCAL_EXAMPLE_HOTLINE_ID,
            next_action: "Approve the responder and hotline runtime, then rerun delexec-ops bootstrap or delexec-ops run-example.",
            reason: approved.reason || "approval_failed"
          });
          return;
        }
        if (approved.ok) {
          logBootstrapStep(steps, "responder_approved", true);
          logBootstrapStep(steps, "hotline_approved", true);
        }
        catalogVisible = await waitForCatalogVisibility(supervisorUrl, responderId, {
          timeoutMs: 15000,
          intervalMs: 250
        });
      } else if (!catalogVisible) {
        emit({
          ok: false,
          stage: "awaiting_admin_approval",
          steps,
          responder_id: responderId,
          hotline_id: LOCAL_EXAMPLE_HOTLINE_ID,
          next_action: "Approve the responder and hotline runtime, then rerun delexec-ops bootstrap or delexec-ops run-example.",
          reason: "admin_api_key_missing"
        });
        return;
      }
      logBootstrapStep(steps, "catalog_visible", true, { hotline_id: LOCAL_EXAMPLE_HOTLINE_ID });
    } else {
      logBootstrapStep(steps, "local_hotline_ready", true, { hotline_id: LOCAL_EXAMPLE_HOTLINE_ID });
    }

    const started = await requestJson(supervisorUrl, "/requests/example", {
      method: "POST",
      body: {
        text: String(args.text || process.env.BOOTSTRAP_EXAMPLE_TEXT || "Summarize this bootstrap request.").trim()
      }
    });
    if (started.status !== 201 || !started.body?.request_id) {
      if (bootstrapUsesPlatform && !adminApiKey) {
        emit({
          ok: false,
          stage: "awaiting_admin_approval",
          steps,
          responder_id: responderId,
          hotline_id: LOCAL_EXAMPLE_HOTLINE_ID,
          next_action: "Approve the responder and hotline runtime, then rerun delexec-ops bootstrap or delexec-ops run-example.",
          reason: started.body?.error?.code || "request_not_callable"
        });
        return;
      }
      emit({
        ok: false,
        stage: "request_start_failed",
        steps,
        response: started.body || started
      });
      return;
    }

    const requestId = started.body.request_id;
    const final = await waitFor(async () => {
      const current = await requestJson(supervisorUrl, `/requests/${encodeURIComponent(requestId)}`);
      if (!["SUCCEEDED", "FAILED", "UNVERIFIED", "TIMED_OUT"].includes(current.body?.status)) {
        throw new Error("request_not_ready");
      }
      return current.body;
    });
    logBootstrapStep(steps, "request_succeeded", final.status === "SUCCEEDED", {
      request_id: requestId,
      status: final.status
    });

    emit({
      ok: final.status === "SUCCEEDED",
      request_id: requestId,
      status: final.status,
      responder_id: responderId,
      hotline_id: LOCAL_EXAMPLE_HOTLINE_ID,
      supervisor_url: supervisorUrl,
      ui: args["open-ui"] ? await ensureUiAvailable(args, env) : null,
      next_steps: {
        one_click_start: "delexec-ops bootstrap --open-ui",
        reopen_web_ui: "delexec-ops ui start --open",
        local_services: "delexec-ops start",
        health_check: "delexec-ops status"
      },
      steps
    });
  } catch (error) {
    emit({
      ok: false,
      stage: "bootstrap_failed",
      steps,
      error: error instanceof Error ? error.message : "unknown_error"
    });
  }
}

async function commandUiStart(args) {
  const state = ensureOpsState();
  const supervisorUrl = supervisorUrlFromState(state);
  const supervisor = await ensureSupervisorAvailable(supervisorUrl, process.env);
  const ui = await ensureUiAvailable(args, process.env);
  emit({
    ok: true,
    supervisor_url: supervisorUrl,
    supervisor_started: supervisor.started,
    ui,
    next_steps: {
      reopen_web_ui: "delexec-ops ui start --open",
      refresh_status: "delexec-ops status"
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }
  if (args._.length === 0) {
    usage();
    process.exit(1);
  }

  const [group, command] = args._;

  if (group === "setup") {
    await commandSetup(args);
    return;
  }
  if (group === "start") {
    await commandStart();
    return;
  }
  if (group === "status") {
    await commandStatus();
    return;
  }
  if (group === "bootstrap") {
    await commandBootstrap(args);
    return;
  }
  if (group === "ui" && command === "start") {
    await commandUiStart(args);
    return;
  }
  if (group === "enable-responder") {
    await commandEnableResponder(args);
    return;
  }
  if (group === "add-hotline") {
    await commandAddHotline(args);
    return;
  }
  if (group === "attach-project") {
    await commandAttachProject(args);
    return;
  }
  if (group === "add-example-hotline") {
    await commandAddExampleHotline();
    return;
  }
  if (group === "enable-hotline") {
    await commandSetHotlineEnabled(args, true);
    return;
  }
  if (group === "remove-hotline") {
    await commandRemoveHotline(args);
    return;
  }
  if (group === "disable-hotline") {
    await commandSetHotlineEnabled(args, false);
    return;
  }
  if (group === "doctor") {
    await commandDoctor();
    return;
  }
  if (group === "debug-snapshot") {
    await commandDebugSnapshot();
    return;
  }
  if (group === "submit-review") {
    await commandSubmitReview(args);
    return;
  }
  if (group === "run-example") {
    await commandRunExample(args);
    return;
  }
  if (group === "auth" && command === "register") {
    await commandAuthRegister(args);
    return;
  }

  if ((group === "responder" || group === "responder") && command === "init") {
    await commandSetup(args);
    return;
  }
  if ((group === "responder" || group === "responder") && command === "register") {
    await commandSubmitReview(args);
    return;
  }
  if ((group === "responder" || group === "responder") && command === "show-draft") {
    await commandShowDraft(args);
    return;
  }
  if ((group === "responder" || group === "responder") && command === "submit-draft") {
    await commandSubmitReview(args);
    return;
  }
  if ((group === "responder" || group === "responder") && command === "add-hotline") {
    await commandAddHotline(args);
    return;
  }
  if ((group === "responder" || group === "responder") && command === "attach-project") {
    await commandAttachProject(args);
    return;
  }
  if ((group === "responder" || group === "responder") && command === "enable-hotline") {
    await commandSetHotlineEnabled(args, true);
    return;
  }
  if ((group === "responder" || group === "responder") && command === "remove-hotline") {
    await commandRemoveHotline(args);
    return;
  }
  if ((group === "responder" || group === "responder") && command === "disable-hotline") {
    await commandSetHotlineEnabled(args, false);
    return;
  }
  if ((group === "responder" || group === "responder") && command === "start") {
    await commandStart();
    return;
  }
  if ((group === "responder" || group === "responder") && command === "status") {
    await commandStatus();
    return;
  }
  if ((group === "responder" || group === "responder") && command === "doctor") {
    await commandDoctor();
    return;
  }
  if ((group === "responder" || group === "responder") && command === "debug-snapshot") {
    await commandDebugSnapshot();
    return;
  }

  usage();
  throw new Error(`unsupported_command:${group || ""}:${command || ""}`);
}

main().catch((error) => {
  console.error(`[delexec-ops] ${error instanceof Error ? error.message : "unknown_error"}`);
  process.exit(1);
});
