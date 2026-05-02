import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createPlatformServer, createPlatformState } from "@delexec/platform-api";
import { createOpsSupervisorServer } from "../../apps/ops/src/supervisor.js";
import { closeServer, jsonRequest, listenServer, reserveFreePorts } from "../helpers/http.js";

const execFileAsync = promisify(execFile);

const CLI_PATH = path.resolve(process.cwd(), "apps/ops/src/cli.js");
const OPS_ENV_KEYS = [
  "DELEXEC_HOME",
  "OPS_PORT_SUPERVISOR",
  "OPS_PORT_RELAY",
  "OPS_PORT_CALLER",
  "OPS_PORT_RESPONDER",
  "OPS_RELAY_BIN",
  "OPS_RELAY_ARGS",
  "PLATFORM_API_BASE_URL",
  "PLATFORM_ADMIN_API_KEY",
  "ADMIN_API_KEY",
  "CALLER_PLATFORM_API_KEY",
  "PLATFORM_API_KEY",
  "CALLER_CONTACT_EMAIL",
  "RESPONDER_ID",
  "RESPONDER_PLATFORM_API_KEY",
  "RESPONDER_SIGNING_PUBLIC_KEY_PEM",
  "RESPONDER_SIGNING_PRIVATE_KEY_PEM",
  "HOTLINE_IDS",
  "TRANSPORT_TYPE",
  "TRANSPORT_BASE_URL",
  "TRANSPORT_PROVIDER",
  "TRANSPORT_EMAIL_PROVIDER",
  "TRANSPORT_EMAIL_MODE",
  "TRANSPORT_EMAIL_SENDER",
  "TRANSPORT_EMAIL_RECEIVER",
  "TRANSPORT_EMAIL_POLL_INTERVAL_MS",
  "TRANSPORT_EMAILENGINE_BASE_URL",
  "TRANSPORT_EMAILENGINE_ACCOUNT",
  "TRANSPORT_EMAILENGINE_ACCESS_TOKEN",
  "TRANSPORT_GMAIL_CLIENT_ID",
  "TRANSPORT_GMAIL_USER",
  "TRANSPORT_GMAIL_CLIENT_SECRET",
  "TRANSPORT_GMAIL_REFRESH_TOKEN"
];

function clearOpsEnv() {
  for (const key of OPS_ENV_KEYS) {
    delete process.env[key];
  }
}

clearOpsEnv();

async function createIsolatedCliEnv(opsHome) {
  const [supervisorPort] = await reserveFreePorts(1);
  return {
    ...process.env,
    DELEXEC_HOME: opsHome,
    OPS_PORT_SUPERVISOR: String(supervisorPort)
  };
}

describe("ops cli integration", () => {
  const cleanupDirs = [];
  const cleanupPids = [];

  afterEach(async () => {
    clearOpsEnv();
    while (cleanupPids.length > 0) {
      const pid = cleanupPids.pop();
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("initializes ops config idempotently and adds process/http hotlines", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-home-"));
    cleanupDirs.push(opsHome);
    const workerCwd = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-worker-cwd-"));
    cleanupDirs.push(workerCwd);

    const env = {
      ...process.env,
      DELEXEC_HOME: opsHome
    };

    await execFileAsync(process.execPath, [CLI_PATH, "responder", "init", "--responder-id", "responder_cli_test"], { env });
    await execFileAsync(process.execPath, [CLI_PATH, "responder", "init", "--responder-id", "responder_cli_test"], { env });
    const processAdded = JSON.parse(
      (
        await execFileAsync(
          process.execPath,
          [
            CLI_PATH,
            "responder",
            "add-hotline",
            "--type",
            "process",
            "--hotline-id",
            "cli.process.v1",
            "--cmd",
            "node worker.js",
            "--cwd",
            workerCwd,
            "--env",
            "PROCESS_MODE=worker",
            "--env",
            "PROCESS_PROFILE=mineru_like",
            "--task-type",
            "summarize",
            "--capability",
            "text.summarize"
          ],
          { env }
        )
      ).stdout
    );
    const httpAdded = JSON.parse(
      (
        await execFileAsync(
          process.execPath,
          [
            CLI_PATH,
            "responder",
            "add-hotline",
            "--type",
            "http",
            "--hotline-id",
            "cli.http.v1",
            "--url",
            "http://127.0.0.1:9191/invoke",
            "--capability",
            "text.classify"
          ],
          { env }
        )
      ).stdout
    );

    const envText = fs.readFileSync(path.join(opsHome, ".env.local"), "utf8");
    const config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));
    const processIntegrationFile = path.join(opsHome, "hotline-integrations", "cli.process.v1.integration.json");
    const processHookFile = path.join(opsHome, "hotline-hooks", "cli.process.v1.hooks.json");
    const httpIntegrationFile = path.join(opsHome, "hotline-integrations", "cli.http.v1.integration.json");

    expect(envText).toContain("RESPONDER_ID=responder_cli_test");
    expect(envText).toContain("HOTLINE_IDS=cli.process.v1,cli.http.v1");
    expect(config.responder.hotlines).toHaveLength(2);
    expect(config.responder.hotlines[0].adapter_type).toBe("process");
    expect(config.responder.hotlines[1].adapter_type).toBe("http");
    expect(processAdded.local_integration_file).toBe(processIntegrationFile);
    expect(processAdded.local_hook_file).toBe(processHookFile);
    expect(httpAdded.local_integration_file).toBe(httpIntegrationFile);
    expect(fs.existsSync(processIntegrationFile)).toBe(true);
    expect(fs.existsSync(processHookFile)).toBe(true);
    expect(fs.existsSync(httpIntegrationFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(processIntegrationFile, "utf8")).adapter.cmd).toBe("node worker.js");
    expect(JSON.parse(fs.readFileSync(processIntegrationFile, "utf8")).adapter.cwd).toBe(workerCwd);
    expect(JSON.parse(fs.readFileSync(processIntegrationFile, "utf8")).adapter.env).toEqual({
      PROCESS_MODE: "worker",
      PROCESS_PROFILE: "mineru_like"
    });
    expect(JSON.parse(fs.readFileSync(httpIntegrationFile, "utf8")).adapter.url).toBe("http://127.0.0.1:9191/invoke");
  });

  it("generates a pdf-parse draft profile for local document parse hotlines", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-pdf-parse-"));
    cleanupDirs.push(opsHome);

    const env = {
      ...process.env,
      DELEXEC_HOME: opsHome
    };

    const added = JSON.parse(
      (
        await execFileAsync(
          process.execPath,
          [
            CLI_PATH,
            "add-hotline",
            "--type",
            "process",
            "--hotline-id",
            "local.mineru.pdf.parse.v1",
            "--display-name",
            "MinerU Local PDF Parse",
            "--cmd",
            "node mineru-worker.js",
            "--task-type",
            "document_parse",
            "--capability",
            "document.parse.pdf",
            "--tag",
            "local",
            "--tag",
            "mineru",
            "--tag",
            "pdf",
            "--tag",
            "parse"
          ],
          { env }
        )
      ).stdout
    );

    const draft = JSON.parse(fs.readFileSync(added.registration_draft_file, "utf8"));
    expect(draft.draft_meta.generated_profile).toBe("document_parse_pdf");
    expect(draft.input_schema.required).toEqual(["pdf_path"]);
    expect(draft.input_schema.properties.pdf_path.description).toContain("Absolute path");
    expect(draft.output_schema.required).toEqual(["markdown_file"]);
    expect(draft.output_summary).toContain("markdown");
  });

  it("submits pending hotlines explicitly and persists responder api key", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-register-"));
    cleanupDirs.push(opsHome);
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "ops-cli-platform", state: platformState });
    const platformUrl = await listenServer(platformServer);

    try {
      const env = await createIsolatedCliEnv(opsHome);

      const auth = JSON.parse(
        (
          await execFileAsync(
            process.execPath,
            [CLI_PATH, "auth", "register", "--email", "ops-cli@test.local", "--platform", platformUrl],
            { env }
          )
        ).stdout
      );
      expect(auth.ok).toBe(true);

      await execFileAsync(process.execPath, [CLI_PATH, "responder", "init", "--responder-id", "responder_cli_register"], { env });
      await execFileAsync(
        process.execPath,
        [
          CLI_PATH,
          "responder",
          "add-hotline",
          "--type",
          "process",
          "--hotline-id",
          "cli.register.v1",
          "--cmd",
          "node worker.js"
        ],
        { env }
      );

      const draftFile = path.join(opsHome, "hotline-registration-drafts", "cli.register.v1.registration.json");
      const draft = JSON.parse(fs.readFileSync(draftFile, "utf8"));
      draft.description = "CLI registration draft description";
      draft.summary = "CLI registration draft summary";
      draft.template_ref = "docs/templates/hotlines/cli.register.v1/";
      draft.input_summary = "Paste the source text you want summarized. Add extra guidance only if the summary should focus on specific points.";
      draft.output_summary = "You will receive a concise summary that can be reused in status updates or quick reviews.";
      draft.input_schema = {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: {
            type: "string",
            description: "Paste the text you want summarized. Include enough surrounding context so the summary is understandable on its own."
          }
        }
      };
      draft.output_schema = {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: {
          summary: {
            type: "string",
            description: "Concise summary returned to the caller."
          }
        }
      };
      fs.writeFileSync(draftFile, `${JSON.stringify(draft, null, 2)}\n`);

      const enabled = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, "enable-responder"], { env })).stdout);
      expect(enabled.ok).toBe(true);
      expect(enabled.submitted).toBe(0);

      const output = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, "submit-review"], { env })).stdout);
      expect(output.ok).toBe(true);
      expect(output.submitted).toBe(1);

      const envText = fs.readFileSync(path.join(opsHome, ".env.local"), "utf8");
      const config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));
      expect(envText).toContain("RESPONDER_PLATFORM_API_KEY=sk_responder_");
      expect(config.responder.hotlines[0].submitted_for_review).toBe(true);
      expect(config.responder.hotlines[0].review_status).toBe("pending");
      expect(output.results[0].draft_file).toBe(draftFile);
      expect(output.results[0].verification.catalog_visible).toBe(true);
      expect(output.results[0].verification.template_ref_matches).toBe(true);
      expect(output.results[0].verification.template_bundle_available).toBe(true);
      expect(platformState.catalog.get("cli.register.v1").description).toBe("CLI registration draft description");
      expect(platformState.catalog.get("cli.register.v1").summary).toBe("CLI registration draft summary");
      expect(platformState.catalog.get("cli.register.v1").template_ref).toBe("docs/templates/hotlines/cli.register.v1/");
      expect(platformState.catalog.get("cli.register.v1").input_summary).toBe(
        "Paste the source text you want summarized. Add extra guidance only if the summary should focus on specific points."
      );
      expect(platformState.catalog.get("cli.register.v1").output_summary).toBe(
        "You will receive a concise summary that can be reused in status updates or quick reviews."
      );
    } finally {
      await closeServer(platformServer);
    }
  });

  it("shows a responder draft and submits a single hotline draft", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-cli-draft-"));
    cleanupDirs.push(opsHome);
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "ops-cli-draft", state: platformState });
    const platformUrl = await listenServer(platformServer);

    try {
      const env = {
        ...(await createIsolatedCliEnv(opsHome)),
        PLATFORM_API_BASE_URL: platformUrl
      };
      await execFileAsync(process.execPath, [CLI_PATH, "responder", "init", "--responder-id", "responder_cli_draft"], { env });
      await execFileAsync(process.execPath, [CLI_PATH, "auth", "register", "--email", "ops-cli-draft@test.local", "--platform", platformUrl], { env });

      await execFileAsync(
        process.execPath,
        [CLI_PATH, "responder", "add-hotline", "--type", "process", "--hotline-id", "cli.draft.one.v1", "--cmd", "node worker.js"],
        { env }
      );
      await execFileAsync(
        process.execPath,
        [CLI_PATH, "responder", "add-hotline", "--type", "process", "--hotline-id", "cli.draft.two.v1", "--cmd", "node worker.js"],
        { env }
      );

      const draftView = JSON.parse(
        (await execFileAsync(process.execPath, [CLI_PATH, "responder", "show-draft", "--hotline-id", "cli.draft.one.v1"], { env })).stdout
      );
      expect(draftView.ok).toBe(true);
      expect(draftView.hotline_id).toBe("cli.draft.one.v1");
      expect(draftView.draft_file).toContain("cli.draft.one.v1.registration.json");
      expect(draftView.draft.hotline_id).toBe("cli.draft.one.v1");

      const submitted = JSON.parse(
        (await execFileAsync(process.execPath, [CLI_PATH, "responder", "submit-draft", "--hotline-id", "cli.draft.one.v1"], { env })).stdout
      );
      expect(submitted.ok).toBe(true);
      expect(submitted.submitted).toBe(1);
      expect(submitted.results[0].verification.ok).toBe(true);

      const config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));
      const first = config.responder.hotlines.find((item) => item.hotline_id === "cli.draft.one.v1");
      const second = config.responder.hotlines.find((item) => item.hotline_id === "cli.draft.two.v1");
      expect(first.submitted_for_review).toBe(true);
      expect(second.submitted_for_review).toBe(false);
    } finally {
      await closeServer(platformServer);
    }
  });

  it("rejects submit-review when any input field is missing caller guidance", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-cli-invalid-guidance-"));
    cleanupDirs.push(opsHome);
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "ops-cli-invalid-guidance", state: platformState });
    const platformUrl = await listenServer(platformServer);

    try {
      const env = {
        ...process.env,
        DELEXEC_HOME: opsHome,
        PLATFORM_API_BASE_URL: platformUrl
      };
      await execFileAsync(process.execPath, [CLI_PATH, "responder", "init", "--responder-id", "responder_cli_invalid_guidance"], { env });
      await execFileAsync(
        process.execPath,
        [CLI_PATH, "auth", "register", "--email", "ops-cli-invalid-guidance@test.local", "--platform", platformUrl],
        { env }
      );
      await execFileAsync(
        process.execPath,
        [CLI_PATH, "responder", "add-hotline", "--type", "process", "--hotline-id", "cli.invalid.guidance.v1", "--cmd", "node worker.js"],
        { env }
      );

      const draftFile = path.join(opsHome, "hotline-registration-drafts", "cli.invalid.guidance.v1.registration.json");
      const draft = JSON.parse(fs.readFileSync(draftFile, "utf8"));
      const invalidField = Object.keys(draft.input_schema.properties || {})[0];
      draft.input_schema.properties[invalidField].description = "Source text.";
      fs.writeFileSync(draftFile, `${JSON.stringify(draft, null, 2)}\n`);

      const output = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, "submit-review"], { env })).stdout);
      expect(output.error.code).toBe("HOTLINE_INPUT_GUIDANCE_REQUIRED");
      expect(output.fields).toContain(invalidField);
    } finally {
      await closeServer(platformServer);
    }
  });

  it("rejects single submit-draft when any input field is missing caller guidance", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-cli-invalid-single-draft-"));
    cleanupDirs.push(opsHome);
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "ops-cli-invalid-single-draft", state: platformState });
    const platformUrl = await listenServer(platformServer);

    try {
      const env = {
        ...process.env,
        DELEXEC_HOME: opsHome,
        PLATFORM_API_BASE_URL: platformUrl
      };
      await execFileAsync(process.execPath, [CLI_PATH, "responder", "init", "--responder-id", "responder_cli_invalid_single"], { env });
      await execFileAsync(
        process.execPath,
        [CLI_PATH, "auth", "register", "--email", "ops-cli-invalid-single@test.local", "--platform", platformUrl],
        { env }
      );
      await execFileAsync(
        process.execPath,
        [CLI_PATH, "responder", "add-hotline", "--type", "process", "--hotline-id", "cli.invalid.single.v1", "--cmd", "node worker.js"],
        { env }
      );

      const draftFile = path.join(opsHome, "hotline-registration-drafts", "cli.invalid.single.v1.registration.json");
      const draft = JSON.parse(fs.readFileSync(draftFile, "utf8"));
      const invalidField = Object.keys(draft.input_schema.properties || {})[0];
      draft.input_schema.properties[invalidField].description = "Source text that should be summarized.";
      fs.writeFileSync(draftFile, `${JSON.stringify(draft, null, 2)}\n`);

      const output = JSON.parse(
        (await execFileAsync(process.execPath, [CLI_PATH, "responder", "submit-draft", "--hotline-id", "cli.invalid.single.v1"], { env }))
          .stdout
      );
      expect(output.error.code).toBe("HOTLINE_INPUT_GUIDANCE_REQUIRED");
      expect(output.fields).toContain(invalidField);
    } finally {
      await closeServer(platformServer);
    }
  });

  it("reuses the cached local ops session token for submit-review when the secret store is locked", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-session-submit-"));
    cleanupDirs.push(opsHome);
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "ops-cli-session-submit", state: platformState });
    const platformUrl = await listenServer(platformServer);

    const supervisorPort = String(60000 + Math.floor(Math.random() * 300));
    const relayPort = String(60310 + Math.floor(Math.random() * 300));
    const callerPort = String(60620 + Math.floor(Math.random() * 300));
    const responderPort = String(60930 + Math.floor(Math.random() * 300));

    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;
    process.env.OPS_PORT_SUPERVISOR = supervisorPort;
    process.env.OPS_PORT_RELAY = relayPort;
    process.env.OPS_PORT_CALLER = callerPort;
    process.env.OPS_PORT_RESPONDER = responderPort;

    const supervisor = createOpsSupervisorServer();
    await new Promise((resolve) => supervisor.listen(Number(supervisorPort), "127.0.0.1", resolve));

    try {
      const env = {
        ...process.env,
        DELEXEC_HOME: opsHome,
        PLATFORM_API_BASE_URL: platformUrl,
        OPS_PORT_SUPERVISOR: supervisorPort,
        OPS_PORT_RELAY: relayPort,
        OPS_PORT_CALLER: callerPort,
        OPS_PORT_RESPONDER: responderPort
      };

      const auth = JSON.parse(
        (
          await execFileAsync(
            process.execPath,
            [CLI_PATH, "auth", "register", "--email", "ops-cli-session@test.local", "--platform", platformUrl],
            { env }
          )
        ).stdout
      );
      expect(auth.ok).toBe(true);

      await execFileAsync(process.execPath, [CLI_PATH, "setup", "--responder-id", "responder_cli_session"], { env });
      await execFileAsync(
        process.execPath,
        [CLI_PATH, "add-hotline", "--type", "process", "--hotline-id", "cli.session.v1", "--cmd", "node worker.js"],
        { env }
      );

      const sessionSetup = await jsonRequest(`http://127.0.0.1:${supervisorPort}`, "/auth/session/setup", {
        method: "POST",
        body: { passphrase: "local-passphrase" }
      });
      expect(sessionSetup.status).toBe(201);

      const sessionFile = JSON.parse(fs.readFileSync(path.join(opsHome, "run", "session.json"), "utf8"));
      expect(sessionFile.token).toBe(sessionSetup.body.token);

      const output = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, "submit-review"], { env })).stdout);
      expect(output.ok).toBe(true);
      expect(output.submitted).toBe(1);
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

  it("toggles local hotline enabled state through the cli", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-toggle-"));
    cleanupDirs.push(opsHome);

    const env = {
      ...process.env,
      DELEXEC_HOME: opsHome
    };

    await execFileAsync(process.execPath, [CLI_PATH, "setup", "--responder-id", "responder_cli_toggle"], { env });
    await execFileAsync(
      process.execPath,
      [CLI_PATH, "add-hotline", "--type", "process", "--hotline-id", "cli.toggle.v1", "--cmd", "node worker.js"],
      { env }
    );
    await execFileAsync(process.execPath, [CLI_PATH, "disable-hotline", "--hotline-id", "cli.toggle.v1"], { env });

    let config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));
    expect(config.responder.hotlines[0].enabled).toBe(false);

    await execFileAsync(process.execPath, [CLI_PATH, "enable-hotline", "--hotline-id", "cli.toggle.v1"], { env });
    config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));
    expect(config.responder.hotlines[0].enabled).toBe(true);
  });

  it("removes a local hotline through the cli", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-remove-"));
    cleanupDirs.push(opsHome);

    const env = {
      ...process.env,
      DELEXEC_HOME: opsHome
    };

    await execFileAsync(process.execPath, [CLI_PATH, "setup", "--responder-id", "responder_cli_remove"], { env });
    await execFileAsync(
      process.execPath,
      [CLI_PATH, "add-hotline", "--type", "process", "--hotline-id", "cli.remove.v1", "--cmd", "node worker.js"],
      { env }
    );
    const draftFile = path.join(opsHome, "hotline-registration-drafts", "cli.remove.v1.registration.json");
    const integrationFile = path.join(opsHome, "hotline-integrations", "cli.remove.v1.integration.json");
    const hookFile = path.join(opsHome, "hotline-hooks", "cli.remove.v1.hooks.json");
    expect(fs.existsSync(draftFile)).toBe(true);
    expect(fs.existsSync(integrationFile)).toBe(true);
    expect(fs.existsSync(hookFile)).toBe(true);
    await execFileAsync(process.execPath, [CLI_PATH, "remove-hotline", "--hotline-id", "cli.remove.v1"], { env });

    const config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));
    expect(config.responder.hotlines.some((item) => item.hotline_id === "cli.remove.v1")).toBe(false);
    expect(fs.existsSync(draftFile)).toBe(false);
    expect(fs.existsSync(integrationFile)).toBe(false);
    expect(fs.existsSync(hookFile)).toBe(false);
  });

  it("installs the official example hotline through the cli", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-example-"));
    cleanupDirs.push(opsHome);

    const env = await createIsolatedCliEnv(opsHome);

    const output = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, "add-example-hotline"], { env })).stdout);
    const config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));
    const example = config.responder.hotlines.find((item) => item.hotline_id === "local.delegated-execution.workspace-summary.v1");

    expect(output.ok).toBe(true);
    expect(example).toBeTruthy();
    expect(example.display_name).toBe("Delegated Execution Workspace Summary");
    expect(example.task_types).toEqual(["text_summarize"]);
    expect(example.capabilities).toEqual(["text.summarize"]);
    expect(example.tags).toEqual(["local", "example", "demo"]);
    expect(example.adapter_type).toBe("process");
    expect(example.adapter.cmd).toContain("example-hotline-worker.js");
  });

  it("registers a local-only caller through the cli without platform credentials", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-local-register-"));
    cleanupDirs.push(opsHome);

    const env = await createIsolatedCliEnv(opsHome);

    const output = JSON.parse(
      (await execFileAsync(process.execPath, [CLI_PATH, "auth", "register", "--local", "--email", "local-only@test.local"], { env }))
        .stdout
    );
    const config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));
    const envText = fs.readFileSync(path.join(opsHome, ".env.local"), "utf8");

    expect(output.ok).toBe(true);
    expect(output.mode).toBe("local_only");
    expect(config.caller.contact_email).toBe("local-only@test.local");
    expect(config.caller.registration_mode).toBe("local_only");
    expect(config.caller.api_key_configured).toBe(false);
    expect(envText).toContain("CALLER_CONTACT_EMAIL=local-only@test.local");
    expect(envText).not.toContain("CALLER_PLATFORM_API_KEY=");
  });

  it("bootstraps the local client and stops at admin approval when operator credentials are unavailable", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-bootstrap-awaiting-"));
    cleanupDirs.push(opsHome);

    const [supervisorPort, relayPort, callerPort, responderPort] = (await reserveFreePorts(4)).map(String);

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "ops-cli-bootstrap-awaiting", state: platformState });
    const platformUrl = await listenServer(platformServer);

    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;
    process.env.OPS_PORT_SUPERVISOR = supervisorPort;
    process.env.OPS_PORT_RELAY = relayPort;
    process.env.OPS_PORT_CALLER = callerPort;
    process.env.OPS_PORT_RESPONDER = responderPort;

    const supervisor = createOpsSupervisorServer();
    await new Promise((resolve) => supervisor.listen(Number(supervisorPort), "127.0.0.1", resolve));
    await jsonRequest(`http://127.0.0.1:${supervisorPort}`, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      const env = {
        ...process.env,
        DELEXEC_HOME: opsHome,
        PLATFORM_API_BASE_URL: platformUrl,
        OPS_PORT_SUPERVISOR: supervisorPort,
        OPS_PORT_RELAY: relayPort,
        OPS_PORT_CALLER: callerPort,
        OPS_PORT_RESPONDER: responderPort
      };

      const output = JSON.parse(
        (await execFileAsync(process.execPath, [CLI_PATH, "bootstrap", "--email", "bootstrap-awaiting@test.local"], { env })).stdout
      );

      expect(output.ok).toBe(false);
      expect(output.stage).toBe("awaiting_admin_approval");
      expect(output.hotline_id).toBe("local.delegated-execution.workspace-summary.v1");
      expect(output.steps.map((item) => item.step)).toContain("review_submitted");
      expect(output.steps.map((item) => item.step)).toContain("responder_enabled");
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

  it("bootstraps the local client end-to-end when operator approval is available", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-bootstrap-success-"));
    cleanupDirs.push(opsHome);

    const [supervisorPort, relayPort, callerPort, responderPort] = (await reserveFreePorts(4)).map(String);

    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "ops-cli-bootstrap-success", state: platformState });
    const platformUrl = await listenServer(platformServer);

    process.env.DELEXEC_HOME = opsHome;
    process.env.PLATFORM_API_BASE_URL = platformUrl;
    process.env.PLATFORM_ADMIN_API_KEY = platformState.adminApiKey;
    process.env.OPS_PORT_SUPERVISOR = supervisorPort;
    process.env.OPS_PORT_RELAY = relayPort;
    process.env.OPS_PORT_CALLER = callerPort;
    process.env.OPS_PORT_RESPONDER = responderPort;

    const supervisor = createOpsSupervisorServer();
    await new Promise((resolve) => supervisor.listen(Number(supervisorPort), "127.0.0.1", resolve));
    await jsonRequest(`http://127.0.0.1:${supervisorPort}`, "/setup", { method: "POST", body: {} });
    await supervisor.startManagedServices();

    try {
      const env = {
        ...process.env,
        DELEXEC_HOME: opsHome,
        PLATFORM_API_BASE_URL: platformUrl,
        PLATFORM_ADMIN_API_KEY: platformState.adminApiKey,
        OPS_PORT_SUPERVISOR: supervisorPort,
        OPS_PORT_RELAY: relayPort,
        OPS_PORT_CALLER: callerPort,
        OPS_PORT_RESPONDER: responderPort
      };

      const output = JSON.parse(
        (
          await execFileAsync(
            process.execPath,
            [CLI_PATH, "bootstrap", "--email", "bootstrap-success@test.local", "--text", "Summarize this bootstrap request."],
            { env }
          )
        ).stdout
      );

      expect(output.ok).toBe(true);
      expect(output.status).toBe("SUCCEEDED");
      expect(output.hotline_id).toBe("local.delegated-execution.workspace-summary.v1");
      expect(output.steps.find((item) => item.step === "request_succeeded")?.ok).toBe(true);
    } finally {
      await supervisor.stopManagedServices();
      await closeServer(supervisor);
      await closeServer(platformServer);
      delete process.env.DELEXEC_HOME;
      delete process.env.PLATFORM_API_BASE_URL;
      delete process.env.PLATFORM_ADMIN_API_KEY;
      delete process.env.OPS_PORT_SUPERVISOR;
      delete process.env.OPS_PORT_RELAY;
      delete process.env.OPS_PORT_CALLER;
      delete process.env.OPS_PORT_RESPONDER;
    }
  });

  it("starts the web ui through the cli and returns reopen commands", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-ui-"));
    cleanupDirs.push(opsHome);

    const supervisorPort = String(60000 + Math.floor(Math.random() * 500));
    const relayPort = String(60500 + Math.floor(Math.random() * 500));
    const callerPort = String(61000 + Math.floor(Math.random() * 500));
    const responderPort = String(61500 + Math.floor(Math.random() * 500));
    const uiPort = String(62000 + Math.floor(Math.random() * 500));

    const uiServerScript = path.join(opsHome, "ui-server.mjs");
    fs.writeFileSync(
      uiServerScript,
      `import http from "node:http";
const host = process.env.DELEXEC_OPS_UI_HOST || "127.0.0.1";
const port = Number(process.env.DELEXEC_OPS_UI_PORT || 4173);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<html><body>ops console ok</body></html>");
});
server.listen(port, host);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
      "utf8"
    );

    const env = {
      ...process.env,
      DELEXEC_HOME: opsHome,
      OPS_PORT_SUPERVISOR: supervisorPort,
      OPS_PORT_RELAY: relayPort,
      OPS_PORT_CALLER: callerPort,
      OPS_PORT_RESPONDER: responderPort,
      DELEXEC_OPS_UI_BIN: process.execPath,
      DELEXEC_OPS_UI_ARGS: JSON.stringify([uiServerScript])
    };

    const supervisor = createOpsSupervisorServer();
    await new Promise((resolve) => supervisor.listen(Number(supervisorPort), "127.0.0.1", resolve));

    try {
      const output = JSON.parse(
        (await execFileAsync(process.execPath, [CLI_PATH, "ui", "start", "--port", uiPort, "--no-browser"], { env })).stdout
      );

      expect(output.ok).toBe(true);
      expect(output.supervisor_url).toBe(`http://127.0.0.1:${supervisorPort}`);
      expect(output.ui.url).toBe(`http://127.0.0.1:${uiPort}`);
      expect(output.ui.started).toBe(true);
      expect(output.next_steps.reopen_web_ui).toBe("delexec-ops ui start --open");
      expect(typeof output.ui.pid).toBe("number");
      cleanupPids.push(output.ui.pid);
    } finally {
      await closeServer(supervisor);
    }
  });

  it("starts the bundled ops console workspace through the cli on the requested port", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-ui-workspace-"));
    cleanupDirs.push(opsHome);

    const [supervisorPort, relayPort, callerPort, responderPort, uiPort] = (await reserveFreePorts(5)).map(String);

    const env = {
      ...process.env,
      DELEXEC_HOME: opsHome,
      OPS_PORT_SUPERVISOR: supervisorPort,
      OPS_PORT_RELAY: relayPort,
      OPS_PORT_CALLER: callerPort,
      OPS_PORT_RESPONDER: responderPort
    };

    const supervisor = createOpsSupervisorServer();
    await new Promise((resolve) => supervisor.listen(Number(supervisorPort), "127.0.0.1", resolve));

    try {
      const output = JSON.parse(
        (await execFileAsync(process.execPath, [CLI_PATH, "ui", "start", "--host", "127.0.0.1", "--port", uiPort, "--no-browser"], { env })).stdout
      );

      expect(output.ok).toBe(true);
      expect(output.supervisor_url).toBe(`http://127.0.0.1:${supervisorPort}`);
      expect(output.ui.url).toBe(`http://127.0.0.1:${uiPort}`);
      expect(output.ui.started).toBe(true);
      expect(output.ui.launch_mode).toBe("workspace_vite");
      expect(typeof output.ui.pid).toBe("number");
      cleanupPids.push(output.ui.pid);

      const response = await fetch(output.ui.url);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<div id=\"root\"></div>");
    } finally {
      await closeServer(supervisor);
    }
  });

  it("packs into a clean-room installable cli tarball", async () => {
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-pack-"));
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-clean-room-"));
    cleanupDirs.push(packDir);
    cleanupDirs.push(installDir);

    const packed = await execFileAsync("npm", ["pack", "--workspace", "@delexec/ops"], {
      cwd: process.cwd(),
      env: process.env
    });
    const tarballName = packed.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    const tarballPath = path.join(process.cwd(), tarballName);
    const copiedTarballPath = path.join(packDir, tarballName);
    fs.copyFileSync(tarballPath, copiedTarballPath);
    fs.rmSync(tarballPath, { force: true });

    await execFileAsync("npm", ["init", "-y"], {
      cwd: installDir,
      env: process.env
    });
    await execFileAsync("npm", ["install", copiedTarballPath], {
      cwd: installDir,
      env: process.env
    });

    const cleanRoomEnv = await createIsolatedCliEnv(path.join(installDir, ".ops-home"));
    const cliPath = path.join(installDir, "node_modules/.bin/delexec-ops");

    await execFileAsync(cliPath, ["responder", "init", "--responder-id", "responder_cli_test"], {
      cwd: installDir,
      env: cleanRoomEnv
    });

    const doctor = await execFileAsync(cliPath, ["doctor"], {
      cwd: installDir,
      env: cleanRoomEnv
    });
    const output = JSON.parse(doctor.stdout);
    expect(output.config.platform.base_url).toBe("http://127.0.0.1:8080");
    expect(output.config.responder.responder_id).toBe("responder_cli_test");
  });
});
