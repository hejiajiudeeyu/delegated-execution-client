// A worker declares its own contract, and the declaration has to be publishable.
//
// Before this, the client inferred a hotline's contract from its id
// (`hotlineId.includes("mineru")`) and the guess described a `pdf_path`
// local-file interface the worker had not accepted since the artifact channel
// landed. A declaration that lives away from the implementation goes stale
// without anyone noticing, because nothing breaks when it does.
//
// The load-bearing test here is the first one: the worker's own declaration is
// checked against the platform's publication bar, so the two cannot drift apart
// without a test going red.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validateHotlineContract } from "@delexec/contracts";

import { HOTLINE_CONTRACT } from "../../apps/ops/src/mineru-hotline-worker.js";
import { readProcessAdapterContract } from "../../apps/ops/src/config.js";

const WORKER = path.resolve(fileURLToPath(new URL("../../apps/ops/src/mineru-hotline-worker.js", import.meta.url)));

describe("the MinerU worker's declared contract", () => {
  it("passes the platform's publication bar", () => {
    // If this fails, the hotline cannot be approved — which is the point:
    // the worker finds out here rather than an operator finding out at
    // approval time.
    expect(validateHotlineContract(HOTLINE_CONTRACT)).toEqual({ valid: true, errors: [] });
  });

  it("describes the artifact channel, not a local file path", () => {
    // The interface this replaced. A caller reading the old declaration would
    // have sent an absolute path to a file on someone else's machine.
    expect(JSON.stringify(HOTLINE_CONTRACT.input_schema)).not.toContain("pdf_path");
    expect(HOTLINE_CONTRACT.input_attachments.accepts_files).toBe(true);
    expect(HOTLINE_CONTRACT.input_attachments.accepted_mime_types).toContain("application/pdf");
    expect(HOTLINE_CONTRACT.input_attachments.file_roles[0]).toMatchObject({ role: "source_document", required: true });
  });

  it("declares the outputs the worker actually emits", () => {
    const required = HOTLINE_CONTRACT.output_schema.required;
    expect(required).toContain("markdown_sha256");
    expect(required).toContain("block_count");
    expect(required).toContain("source_document");
    expect(HOTLINE_CONTRACT.output_attachments.possible_mime_types).toEqual(
      expect.arrayContaining(["text/markdown", "image/png"])
    );
  });

  it("says what it is not for", () => {
    expect(HOTLINE_CONTRACT.not_recommended_for.join(" ")).toMatch(/does not read|Formats other than PDF/);
    expect(HOTLINE_CONTRACT.limitations.length).toBeGreaterThan(0);
  });
});

describe("asking a process adapter for its contract", () => {
  it("reads the declaration a worker prints for --contract", () => {
    const contract = readProcessAdapterContract({
      adapter_type: "process",
      adapter: { cmd: `node ${JSON.stringify(WORKER)}` }
    });
    expect(contract).toMatchObject({ contract_version: 1 });
    expect(contract.input_schema).toEqual(HOTLINE_CONTRACT.input_schema);
  });

  it("does not mistake an ordinary result payload for a contract", () => {
    // A worker with no --contract support ignores the flag, reads empty stdin
    // and prints its normal JSON result. That is valid JSON, so without a
    // positive signal it would be adopted as a contract.
    const contract = readProcessAdapterContract({
      adapter_type: "process",
      adapter: { cmd: `node -e ${JSON.stringify('process.stdout.write(JSON.stringify({status:"ok",output:{}}))')}` }
    });
    expect(contract).toBeNull();
  });

  it("treats an unparseable or failing worker as one that did not answer", () => {
    expect(
      readProcessAdapterContract({ adapter_type: "process", adapter: { cmd: "node -e \"process.stdout.write('not json')\"" } })
    ).toBeNull();
    expect(readProcessAdapterContract({ adapter_type: "process", adapter: { cmd: "exit 3" } })).toBeNull();
  });

  it("has nothing to ask when the hotline is not a process adapter", () => {
    expect(readProcessAdapterContract({ adapter_type: "http", adapter: { url: "http://x" } })).toBeNull();
    expect(readProcessAdapterContract({})).toBeNull();
  });

  it("is not fooled by a worker that answers with a version it does not have", () => {
    const contract = readProcessAdapterContract({
      adapter_type: "process",
      adapter: { cmd: `node -e ${JSON.stringify('process.stdout.write(JSON.stringify({contract_version:0}))')}` }
    });
    expect(contract).toBeNull();
  });
});

describe("the worker itself", () => {
  it("answers --contract without reading stdin and without side effects", () => {
    const result = spawnSync("node", [WORKER, "--contract"], { encoding: "utf8", timeout: 10000 });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.contract_version).toBe(1);
    expect(validateHotlineContract(parsed).valid).toBe(true);
  });
});
