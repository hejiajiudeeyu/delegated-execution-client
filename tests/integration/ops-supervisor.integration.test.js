import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPlatformServer, createPlatformState } from "@delexec/platform-api";
import { createOpsSupervisorServer } from "../../apps/ops/src/supervisor.js";
import { closeServer, jsonRequest, listenServer, waitFor } from "../helpers/http.js";

describe("ops supervisor integration", () => {
  const cleanupDirs = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts embedded local relay and supports local-only caller registration", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-home-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(18000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(19000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(20000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(21000 + Math.floor(Math.random() * 1000));

    process.env.DELEXEC_HOME = opsHome;

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      await waitFor(async () => {
        const status = await jsonRequest(supervisorUrl, "/status");
        if (!status.body?.runtime?.caller?.running || !status.body?.runtime?.relay?.running) {
          throw new Error("runtime_not_ready");
        }
        if (status.body.runtime.caller.health?.status !== 200 || status.body.runtime.relay.health?.status !== 200) {
          throw new Error("health_not_ready");
        }
        return status;
      });

      const registered = await jsonRequest(supervisorUrl, "/auth/register-caller", {
        method: "POST",
        body: { contact_email: "ops-supervisor@test.local", mode: "local_only" }
      });
      expect(registered.status).toBe(201);
      expect(registered.body.mode).toBe("local_only");

      const currentStatus = await jsonRequest(supervisorUrl, "/status");
      expect(currentStatus.body.runtime.relay.launch_mode).toBe("embedded_local");
      expect(currentStatus.body.caller.registered).toBe(true);
      expect(currentStatus.body.caller.registration_mode).toBe("local_only");

      const requests = await waitFor(async () => {
        const current = await jsonRequest(supervisorUrl, "/requests");
        if (current.status !== 200) {
          throw new Error("requests_not_ready");
        }
        return current;
      });
      expect(Array.isArray(requests.body.items)).toBe(true);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      delete process.env.DELEXEC_HOME;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("starts relay from an external command instead of a direct package entry", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-external-relay-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(36000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(37000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(38000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(39000 + Math.floor(Math.random() * 1000));

    const relayScript = path.join(opsHome, "external-relay.mjs");
    fs.writeFileSync(
      relayScript,
      `import http from "node:http";
const port = Number(process.env.PORT || 0);
const server = http.createServer((req, res) => {
  if ((req.method || "GET") === "GET" && (req.url || "/") === "/healthz") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: process.env.SERVICE_NAME || "external-relay" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true }));
});
server.listen(port, "127.0.0.1");
`,
      "utf8"
    );

    process.env.OPS_RELAY_BIN = process.execPath;
    process.env.OPS_RELAY_ARGS = JSON.stringify([relayScript]);
    process.env.DELEXEC_HOME = opsHome;

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      const status = await waitFor(async () => {
        const current = await jsonRequest(supervisorUrl, "/status");
        if (current.body?.runtime?.relay?.health?.status !== 200) {
          throw new Error("relay_not_ready");
        }
        return current;
      });

      expect(status.body.runtime.relay.managed).toBe(true);
      expect(status.body.runtime.relay.launch_mode).toBe("configured_command");
      expect(status.body.runtime.relay.health.status).toBe(200);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      delete process.env.DELEXEC_HOME;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
      delete process.env.OPS_RELAY_BIN;
      delete process.env.OPS_RELAY_ARGS;
    }
  });

  it("separates responder enable from review submission", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-review-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(22000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(23000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(24000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(25000 + Math.floor(Math.random() * 1000));

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-ops-review-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      const registered = await jsonRequest(supervisorUrl, "/auth/register-caller", {
        method: "POST",
        body: { contact_email: "ops-review@test.local", mode: "platform" }
      });
      expect(registered.status).toBe(201);

      const added = await jsonRequest(supervisorUrl, "/responder/hotlines", {
        method: "POST",
        body: {
          hotline_id: "ops.review.v1",
          display_name: "Ops Review",
          task_types: ["text_classify"],
          capabilities: ["text.classify"],
          adapter_type: "process",
          adapter: { cmd: "node worker.js" }
        }
      });
      expect(added.status).toBe(201);

      const enabled = await jsonRequest(supervisorUrl, "/responder/enable", {
        method: "POST",
        body: { responder_id: "responder_ops_review" }
      });
      expect(enabled.status).toBe(200);
      expect(enabled.body.submitted).toBe(0);

      const statusBeforeReview = await jsonRequest(supervisorUrl, "/status");
      expect(statusBeforeReview.body.responder.pending_review_count).toBe(0);

      const platformEnabled = await jsonRequest(supervisorUrl, "/platform/settings", {
        method: "PUT",
        body: { enabled: true }
      });
      expect(platformEnabled.status).toBe(200);

      const submitted = await jsonRequest(supervisorUrl, "/responder/submit-review", {
        method: "POST",
        body: {}
      });
      expect(submitted.status).toBe(201);
      expect(submitted.body.submitted).toBe(1);
      expect(submitted.body.results[0].verification.catalog_visible).toBe(true);
      expect(submitted.body.results[0].verification.template_ref_matches).toBe(true);
      expect(submitted.body.results[0].verification.template_bundle_available).toBe(true);

      const statusAfterReview = await jsonRequest(supervisorUrl, "/status");
      expect(statusAfterReview.body.responder.pending_review_count).toBe(0);
      expect(statusAfterReview.body.responder.review_summary.pending).toBe(1);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      await closeServer(platformServer);
      delete process.env.DELEXEC_HOME;
      delete process.env.PLATFORM_API_BASE_URL;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("exposes responder draft inspection and single-hotline draft submission", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-draft-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(26000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(27000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(28000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(29000 + Math.floor(Math.random() * 1000));

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-ops-draft-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      const registered = await jsonRequest(supervisorUrl, "/auth/register-caller", {
        method: "POST",
        body: { contact_email: "ops-draft@test.local", mode: "platform" }
      });
      expect(registered.status).toBe(201);

      await jsonRequest(supervisorUrl, "/responder/hotlines", {
        method: "POST",
        body: {
          hotline_id: "ops.draft.one.v1",
          display_name: "Ops Draft One",
          task_types: ["text_summarize"],
          capabilities: ["text.summarize"],
          adapter_type: "process",
          adapter: { cmd: "node worker.js" }
        }
      });
      await jsonRequest(supervisorUrl, "/responder/hotlines", {
        method: "POST",
        body: {
          hotline_id: "ops.draft.two.v1",
          display_name: "Ops Draft Two",
          task_types: ["text_summarize"],
          capabilities: ["text.summarize"],
          adapter_type: "process",
          adapter: { cmd: "node worker.js" }
        }
      });

      const draft = await jsonRequest(supervisorUrl, "/responder/hotlines/ops.draft.one.v1/draft");
      expect(draft.status).toBe(200);
      expect(draft.body.ok).toBe(true);
      expect(draft.body.hotline_id).toBe("ops.draft.one.v1");
      expect(draft.body.draft_file).toContain("ops.draft.one.v1.registration.json");
      expect(draft.body.local_integration_file).toContain("ops.draft.one.v1.integration.json");
      expect(draft.body.local_hook_file).toContain("ops.draft.one.v1.hooks.json");
      expect(fs.existsSync(draft.body.local_integration_file)).toBe(true);
      expect(fs.existsSync(draft.body.local_hook_file)).toBe(true);

      const platformEnabled = await jsonRequest(supervisorUrl, "/platform/settings", {
        method: "PUT",
        body: { enabled: true }
      });
      expect(platformEnabled.status).toBe(200);

      const submitted = await jsonRequest(supervisorUrl, "/responder/hotlines/ops.draft.one.v1/submit-review", {
        method: "POST",
        body: {}
      });
      expect(submitted.status).toBe(201);
      expect(submitted.body.submitted).toBe(1);
      expect(submitted.body.results[0].verification.ok).toBe(true);

      const status = await jsonRequest(supervisorUrl, "/status");
      expect(status.body.responder.pending_review_count).toBe(1);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      await closeServer(platformServer);
      delete process.env.DELEXEC_HOME;
      delete process.env.PLATFORM_API_BASE_URL;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("rejects single-hotline draft submission when any input field lacks caller guidance", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-invalid-guidance-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(30000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(31000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(32000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(33000 + Math.floor(Math.random() * 1000));

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-ops-invalid-guidance-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      const registered = await jsonRequest(supervisorUrl, "/auth/register-caller", {
        method: "POST",
        body: { contact_email: "ops-invalid-guidance@test.local", mode: "platform" }
      });
      expect(registered.status).toBe(201);

      await jsonRequest(supervisorUrl, "/responder/hotlines", {
        method: "POST",
        body: {
          hotline_id: "ops.invalid.guidance.v1",
          display_name: "Ops Invalid Guidance",
          task_types: ["text_summarize"],
          capabilities: ["text.summarize"],
          adapter_type: "process",
          adapter: { cmd: "node worker.js" }
        }
      });

      const draftFile = path.join(opsHome, "hotline-registration-drafts", "ops.invalid.guidance.v1.registration.json");
      const draft = JSON.parse(fs.readFileSync(draftFile, "utf8"));
      const invalidField = Object.keys(draft.input_schema.properties || {})[0];
      draft.input_schema.properties[invalidField].description = "Source text.";
      fs.writeFileSync(draftFile, `${JSON.stringify(draft, null, 2)}\n`);

      const platformEnabled = await jsonRequest(supervisorUrl, "/platform/settings", {
        method: "PUT",
        body: { enabled: true }
      });
      expect(platformEnabled.status).toBe(200);

      const submitted = await jsonRequest(supervisorUrl, "/responder/hotlines/ops.invalid.guidance.v1/submit-review", {
        method: "POST",
        body: {}
      });
      expect(submitted.status).toBe(400);
      expect(submitted.body.error.code).toBe("HOTLINE_INPUT_GUIDANCE_REQUIRED");
      expect(submitted.body.fields).toContain(invalidField);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      await closeServer(platformServer);
      delete process.env.DELEXEC_HOME;
      delete process.env.PLATFORM_API_BASE_URL;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("toggles a local hotline on the responder side", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-toggle-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(32000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(33000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(34000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(35000 + Math.floor(Math.random() * 1000));

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-ops-toggle-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      const added = await jsonRequest(supervisorUrl, "/responder/hotlines", {
        method: "POST",
        body: {
          hotline_id: "ops.toggle.v1",
          adapter_type: "process",
          adapter: { cmd: "node worker.js" }
        }
      });
      expect(added.status).toBe(201);

      const disabled = await jsonRequest(supervisorUrl, "/responder/hotlines/ops.toggle.v1/disable", {
        method: "POST",
        body: {}
      });
      expect(disabled.status).toBe(200);
      expect(disabled.body.enabled).toBe(false);

      const enabled = await jsonRequest(supervisorUrl, "/responder/hotlines/ops.toggle.v1/enable", {
        method: "POST",
        body: {}
      });
      expect(enabled.status).toBe(200);
      expect(enabled.body.enabled).toBe(true);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      await closeServer(platformServer);
      delete process.env.DELEXEC_HOME;
      delete process.env.PLATFORM_API_BASE_URL;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("requires a local session for protected routes once the encrypted secret store is initialized", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-session-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(26000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(27000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(28000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(29000 + Math.floor(Math.random() * 1000));

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-ops-session-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;

    try {
      const setupSession = await jsonRequest(supervisorUrl, "/auth/session/setup", {
        method: "POST",
        body: { passphrase: "local-passphrase" }
      });
      expect(setupSession.status).toBe(201);
      expect(setupSession.body.session.authenticated).toBe(true);

      const denied = await jsonRequest(supervisorUrl, "/runtime/transport");
      expect(denied.status).toBe(401);

      const localHotlineUpdate = await jsonRequest(supervisorUrl, "/responder/hotlines", {
        method: "POST",
        body: {
          hotline_id: "ops.local-config.v1",
          adapter_type: "process",
          adapter: { cmd: "node worker.js" }
        }
      });
      expect(localHotlineUpdate.status).toBe(201);
      expect(localHotlineUpdate.body.runtime.hotline_configured).toBe(true);

      const sessionHeaders = {
        "X-Ops-Session": setupSession.body.token
      };
      const allowed = await jsonRequest(supervisorUrl, "/runtime/transport", {
        headers: sessionHeaders
      });
      expect(allowed.status).toBe(200);
      expect(allowed.body.type).toBe("local");

      const logout = await jsonRequest(supervisorUrl, "/auth/session/logout", {
        method: "POST",
        headers: sessionHeaders,
        body: {}
      });
      expect(logout.status).toBe(200);
      expect(logout.body.session.authenticated).toBe(false);

      const deniedAgain = await jsonRequest(supervisorUrl, "/runtime/transport");
      expect(deniedAgain.status).toBe(401);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      await closeServer(platformServer);
      delete process.env.DELEXEC_HOME;
      delete process.env.PLATFORM_API_BASE_URL;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("removes a local hotline from responder config", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-remove-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(36000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(37000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(38000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(39000 + Math.floor(Math.random() * 1000));

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-ops-remove-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      await jsonRequest(supervisorUrl, "/responder/hotlines", {
        method: "POST",
        body: {
          hotline_id: "ops.remove.v1",
          adapter_type: "process",
          adapter: { cmd: "node worker.js" }
        }
      });

      const removed = await jsonRequest(supervisorUrl, "/responder/hotlines/ops.remove.v1", {
        method: "DELETE"
      });
      expect(removed.status).toBe(200);
      expect(removed.body.removed.hotline_id).toBe("ops.remove.v1");

      const list = await jsonRequest(supervisorUrl, "/responder/hotlines");
      expect(list.body.items.some((item) => item.hotline_id === "ops.remove.v1")).toBe(false);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      await closeServer(platformServer);
      delete process.env.DELEXEC_HOME;
      delete process.env.PLATFORM_API_BASE_URL;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("writes service logs and exposes a debug snapshot", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-debug-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(40000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(41000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(42000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(43000 + Math.floor(Math.random() * 1000));

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-ops-debug-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      const snapshot = await waitFor(async () => {
        const current = await jsonRequest(supervisorUrl, "/debug/snapshot");
        if (!Array.isArray(current.body?.log_tail?.caller) || current.body.log_tail.caller.length === 0) {
          throw new Error("caller_log_not_ready");
        }
        return current;
      });
      expect(snapshot.status).toBe(200);
      expect(snapshot.body.status.debug.logs_dir).toContain(opsHome);
      expect(Array.isArray(snapshot.body.recent_events)).toBe(true);

      const runtimeLogs = await jsonRequest(supervisorUrl, "/runtime/logs?service=caller");
      expect(runtimeLogs.status).toBe(200);
      expect(runtimeLogs.body.file).toContain(path.join("logs", "caller.log"));
      expect(runtimeLogs.body.logs.length).toBeGreaterThan(0);

      const runtimeAlerts = await jsonRequest(supervisorUrl, "/runtime/alerts?service=caller");
      expect(runtimeAlerts.status).toBe(200);
      expect(Array.isArray(runtimeAlerts.body.alerts)).toBe(true);

      expect(fs.existsSync(path.join(opsHome, "logs", "caller.log"))).toBe(true);
      expect(fs.existsSync(path.join(opsHome, "logs", "supervisor.events.jsonl"))).toBe(true);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      await closeServer(platformServer);
      delete process.env.DELEXEC_HOME;
      delete process.env.PLATFORM_API_BASE_URL;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("stores transport config with redacted secrets and tests emailengine connection", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-transport-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(44000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(45000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(46000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(47000 + Math.floor(Math.random() * 1000));

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-ops-transport-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;

    const emailEngineServer = await (async () => {
      const http = await import("node:http");
      const server = http.createServer((req, res) => {
        if (req.url === "/v1/account/caller%40example.com" && req.headers.authorization === "Bearer ee-secret") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ account: "caller@example.com" }));
          return;
        }
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
      });
      const url = await listenServer(server);
      return { server, url };
    })();

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });

    try {
      const initial = await jsonRequest(supervisorUrl, "/runtime/transport");
      expect(initial.status).toBe(200);
      expect(initial.body.type).toBe("local");

      const saved = await jsonRequest(supervisorUrl, "/runtime/transport", {
        method: "PUT",
        body: {
          type: "email",
          email: {
            provider: "emailengine",
            sender: "caller@example.com",
            receiver: "responder@example.com",
            poll_interval_ms: 7000,
            emailengine: {
              base_url: emailEngineServer.url,
              account: "caller@example.com",
              access_token: "ee-secret"
            }
          }
        }
      });
      expect(saved.status).toBe(200);
      expect(saved.body.type).toBe("email");
      expect(saved.body.email.provider).toBe("emailengine");
      expect(saved.body.email.emailengine.access_token_configured).toBe(true);
      expect(saved.body.email.emailengine.access_token).toBeUndefined();

      const tested = await jsonRequest(supervisorUrl, "/runtime/transport/test", {
        method: "POST",
        body: {}
      });
      expect(tested.status).toBe(200);
      expect(tested.body.ok).toBe(true);
      expect(tested.body.kind).toBe("emailengine");

      const envText = fs.readFileSync(path.join(opsHome, ".env.local"), "utf8");
      expect(envText).toContain("TRANSPORT_EMAILENGINE_ACCESS_TOKEN=ee-secret");
      expect(envText).toContain(`TRANSPORT_EMAILENGINE_BASE_URL=${emailEngineServer.url}`);
      expect(envText).toContain("TRANSPORT_TYPE=email");
    } finally {
      await closeServer(emailEngineServer.server);
      await closeServer(supervisor);
      await closeServer(platformServer);
      delete process.env.DELEXEC_HOME;
      delete process.env.PLATFORM_API_BASE_URL;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("tests gmail transport and keeps caller runtime running with configured adapter", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-gmail-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(48000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(49000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(50000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(51000 + Math.floor(Math.random() * 1000));

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-ops-gmail-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;

    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input.url);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ access_token: "gmail-access-token" });
          },
          async json() {
            return { access_token: "gmail-access-token" };
          }
        };
      }
      if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/caller%40example.com/profile")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ emailAddress: "caller@example.com" });
          },
          async json() {
            return { emailAddress: "caller@example.com" };
          }
        };
      }
      return originalFetch(input, init);
    }));

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });

    try {
      const saved = await jsonRequest(supervisorUrl, "/runtime/transport", {
        method: "PUT",
        body: {
          type: "email",
          email: {
            provider: "gmail",
            sender: "caller@example.com",
            receiver: "responder@example.com",
            poll_interval_ms: 5000,
            gmail: {
              client_id: "gmail-client-id",
              user: "caller@example.com",
              client_secret: "gmail-client-secret",
              refresh_token: "gmail-refresh-token"
            }
          }
        }
      });
      expect(saved.status).toBe(200);
      expect(saved.body.email.gmail.client_secret_configured).toBe(true);
      expect(saved.body.email.gmail.refresh_token_configured).toBe(true);

      const tested = await jsonRequest(supervisorUrl, "/runtime/transport/test", {
        method: "POST",
        body: {}
      });
      expect(tested.status).toBe(200);
      expect(tested.body.ok).toBe(true);
      expect(tested.body.kind).toBe("gmail");

      await supervisor.startManagedServices();
      const status = await waitFor(async () => {
        const current = await jsonRequest(supervisorUrl, "/status");
        if (current.body?.runtime?.caller?.running !== true) {
          throw new Error("caller_not_running");
        }
        return current;
      });
      expect(status.body.runtime.caller.running).toBe(true);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      await closeServer(platformServer);
      delete process.env.DELEXEC_HOME;
      delete process.env.PLATFORM_API_BASE_URL;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("installs the official example hotline and completes a local-only self-call", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "ops-supervisor-example-"));
    cleanupDirs.push(opsHome);
    process.env.OPS_PORT_SUPERVISOR = String(52000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RELAY = String(53000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_CALLER = String(54000 + Math.floor(Math.random() * 1000));
    process.env.OPS_PORT_RESPONDER = String(55000 + Math.floor(Math.random() * 1000));

    process.env.DELEXEC_HOME = opsHome;

    const supervisor = createOpsSupervisorServer();
    supervisor.listen(0, "127.0.0.1");
    await new Promise((resolve) => supervisor.once("listening", resolve));
    const supervisorUrl = `http://127.0.0.1:${supervisor.address().port}`;
    await jsonRequest(supervisorUrl, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      await jsonRequest(supervisorUrl, "/auth/register-caller", {
        method: "POST",
        body: { contact_email: "ops-example@test.local", mode: "local_only" }
      });

      const added = await jsonRequest(supervisorUrl, "/responder/hotlines/example", {
        method: "POST",
        body: {}
      });
      expect(added.status).toBe(201);
      expect(added.body.hotline_id).toBe("local.delegated-execution.workspace-summary.v1");

      const enabled = await jsonRequest(supervisorUrl, "/responder/enable", {
        method: "POST",
        body: { responder_id: "responder_ops_example" }
      });
      expect(enabled.status).toBe(200);

      const started = await jsonRequest(supervisorUrl, "/requests/example", {
        method: "POST",
        body: { text: "Summarize this local example request." }
      });
      expect(started.status).toBe(201);
      expect(started.body.hotline_id).toBe("local.delegated-execution.workspace-summary.v1");
      expect(started.body.draft_ready).toBe(true);
      expect(started.body.draft_file).toContain("local.delegated-execution.workspace-summary.v1.registration.json");

      const result = await waitFor(async () => {
        const current = await jsonRequest(supervisorUrl, `/requests/${started.body.request_id}/result`);
        if (current.body?.available !== true) {
          throw new Error("result_not_ready");
        }
        return current;
      });
      expect(result.body.status).toBe("SUCCEEDED");
      expect(result.body.result_package?.status).toBe("ok");
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      delete process.env.DELEXEC_HOME;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });
});
