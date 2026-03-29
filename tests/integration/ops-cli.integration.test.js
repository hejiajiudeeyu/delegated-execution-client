import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createPlatformServer, createPlatformState } from "@delexec/platform-api";
import { createOpsSupervisorServer } from "../../apps/ops/src/supervisor.js";
import { closeServer, jsonRequest, listenServer } from "../helpers/http.js";

const execFileAsync = promisify(execFile);

const CLI_PATH = path.resolve(process.cwd(), "apps/ops/src/cli.js");

describe("ops cli integration", () => {
  const cleanupDirs = [];
  const cleanupPids = [];

  afterEach(async () => {
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

    const env = {
      ...process.env,
      DELEXEC_HOME: opsHome
    };

    await execFileAsync(process.execPath, [CLI_PATH, "responder", "init", "--responder-id", "responder_cli_test"], { env });
    await execFileAsync(process.execPath, [CLI_PATH, "responder", "init", "--responder-id", "responder_cli_test"], { env });
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
        "--task-type",
        "summarize",
        "--capability",
        "text.summarize"
      ],
      { env }
    );
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
    );

    const envText = fs.readFileSync(path.join(opsHome, ".env.local"), "utf8");
    const config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));

    expect(envText).toContain("RESPONDER_ID=responder_cli_test");
    expect(envText).toContain("HOTLINE_IDS=cli.process.v1,cli.http.v1");
    expect(config.responder.hotlines).toHaveLength(2);
    expect(config.responder.hotlines[0].adapter_type).toBe("process");
    expect(config.responder.hotlines[1].adapter_type).toBe("http");
  });

  it("submits pending hotlines explicitly and persists responder api key", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-register-"));
    cleanupDirs.push(opsHome);
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "ops-cli-platform", state: platformState });
    const platformUrl = await listenServer(platformServer);

    try {
      const env = {
        ...process.env,
        DELEXEC_HOME: opsHome
      };

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
    } finally {
      await closeServer(platformServer);
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
    await execFileAsync(process.execPath, [CLI_PATH, "remove-hotline", "--hotline-id", "cli.remove.v1"], { env });

    const config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));
    expect(config.responder.hotlines.some((item) => item.hotline_id === "cli.remove.v1")).toBe(false);
  });

  it("installs the official example hotline through the cli", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-example-"));
    cleanupDirs.push(opsHome);

    const env = {
      ...process.env,
      DELEXEC_HOME: opsHome
    };

    const output = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, "add-example-hotline"], { env })).stdout);
    const config = JSON.parse(fs.readFileSync(path.join(opsHome, "ops.config.json"), "utf8"));
    const example = config.responder.hotlines.find((item) => item.hotline_id === "local.summary.v1");

    expect(output.ok).toBe(true);
    expect(example).toBeTruthy();
    expect(example.display_name).toBe("Local Summary Example");
    expect(example.task_types).toEqual(["text_summarize"]);
    expect(example.capabilities).toEqual(["text.summarize"]);
    expect(example.tags).toEqual(["local", "example", "demo"]);
    expect(example.adapter_type).toBe("process");
    expect(example.adapter.cmd).toContain("example-hotline-worker.js");
  });

  it("bootstraps the local client and stops at admin approval when operator credentials are unavailable", async () => {
    const opsHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-bootstrap-awaiting-"));
    cleanupDirs.push(opsHome);

    const supervisorPort = String(56000 + Math.floor(Math.random() * 500));
    const relayPort = String(56500 + Math.floor(Math.random() * 500));
    const callerPort = String(57000 + Math.floor(Math.random() * 500));
    const responderPort = String(57500 + Math.floor(Math.random() * 500));

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
      expect(output.hotline_id).toBe("local.summary.v1");
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

    const supervisorPort = String(58000 + Math.floor(Math.random() * 500));
    const relayPort = String(58500 + Math.floor(Math.random() * 500));
    const callerPort = String(59000 + Math.floor(Math.random() * 500));
    const responderPort = String(59500 + Math.floor(Math.random() * 500));

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
      expect(output.hotline_id).toBe("local.summary.v1");
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

    const cleanRoomEnv = {
      ...process.env,
      DELEXEC_HOME: path.join(installDir, ".ops-home")
    };
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
