import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureOpsState, saveOpsState } from "../../apps/ops/src/config.js";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_DELEXEC_HOME = process.env.DELEXEC_HOME;
const ORIGINAL_TRANSPORT_TYPE = process.env.TRANSPORT_TYPE;
const ORIGINAL_TRANSPORT_BASE_URL = process.env.TRANSPORT_BASE_URL;

describe("ops config runtime transport overrides", () => {
  const cleanupDirs = [];

  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME;
    if (ORIGINAL_DELEXEC_HOME === undefined) {
      delete process.env.DELEXEC_HOME;
    } else {
      process.env.DELEXEC_HOME = ORIGINAL_DELEXEC_HOME;
    }
    if (ORIGINAL_TRANSPORT_TYPE === undefined) {
      delete process.env.TRANSPORT_TYPE;
    } else {
      process.env.TRANSPORT_TYPE = ORIGINAL_TRANSPORT_TYPE;
    }
    if (ORIGINAL_TRANSPORT_BASE_URL === undefined) {
      delete process.env.TRANSPORT_BASE_URL;
    } else {
      process.env.TRANSPORT_BASE_URL = ORIGINAL_TRANSPORT_BASE_URL;
    }
    while (cleanupDirs.length > 0) {
      fs.rmSync(cleanupDirs.pop(), { recursive: true, force: true });
    }
  });

  it("applies relay_http overrides from the current shell environment", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-ops-config-"));
    cleanupDirs.push(fakeHome);
    process.env.HOME = fakeHome;
    delete process.env.DELEXEC_HOME;
    process.env.TRANSPORT_TYPE = "relay_http";
    process.env.TRANSPORT_BASE_URL = "http://127.0.0.1:8090";

    const state = ensureOpsState();

    expect(state.config.runtime.transport.type).toBe("relay_http");
    expect(state.config.runtime.transport.relay_http.base_url).toBe("http://127.0.0.1:8090");

    saveOpsState(state);

    const envFile = fs.readFileSync(path.join(fakeHome, ".delexec", ".env.local"), "utf8");
    expect(envFile).toContain("TRANSPORT_TYPE=relay_http");
    expect(envFile).toContain("TRANSPORT_BASE_URL=http://127.0.0.1:8090");
  });
});
