// The responder-runtime half of the M1 exit failure matrix.
//
// The exit condition names nine failure modes. Seven are platform behavior and
// live in the platform repo's tests/integration/failure-matrix.integration.test.js;
// these two are purely about what the device does, so they live here:
//
//   2 —— 执行中断连: a finished result whose delivery failed is replayed, not
//        re-executed. For MinerU-scale work, redoing it because a network hop
//        failed is its own kind of wrong answer.
//   9 —— 重试: a retry is a distinct attempt in the journal, so "tried twice"
//        never reads as "owed twice".
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPlatformServer, createPlatformState } from "@delexec/platform-api";
import { JOURNAL_ENTRY, createResponderControllerServer, createResponderState } from "@delexec/responder-controller";
import { createSqliteExecutionJournal } from "../../packages/sqlite-store/src/index.js";
import { closeServer, jsonRequest, listenServer, waitFor } from "../helpers/http.js";

describe("M1 failure matrix (responder runtime)", () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()();
    }
  });

  it("connection lost after execution: the finished result is replayed, not re-executed", async () => {
    const state = createPlatformState({ adminApiKey: "sk_admin_matrix_replay", bootstrapEnabled: true });
    const platformServer = createPlatformServer({ serviceName: "matrix-replay", state });
    const platformUrl = await listenServer(platformServer);
    cleanup.push(() => closeServer(platformServer));

    const responder = state.bootstrap.responders[0];
    const caller = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "matrix-replay@test.local" }
    });
    const requestId = "req_matrix_replay";
    await jsonRequest(platformUrl, "/v1/tokens/task", {
      method: "POST",
      headers: { Authorization: `Bearer ${caller.body.api_key}` },
      body: { request_id: requestId, responder_id: responder.responder_id, hotline_id: responder.hotline_id }
    });

    let executions = 0;
    const responderState = createResponderState({
      responderId: responder.responder_id,
      hotlineIds: [responder.hotline_id]
    });
    const server = createResponderControllerServer({
      serviceName: "matrix-replay-responder",
      state: responderState,
      platform: { baseUrl: platformUrl, apiKey: responder.api_key },
      executor: {
        name: "counting",
        async execute() {
          executions += 1;
          return { status: "ok", output: { run: executions } };
        }
      }
    });
    const responderUrl = await listenServer(server);
    cleanup.push(() => closeServer(server));

    const first = await jsonRequest(responderUrl, "/controller/tasks", {
      method: "POST",
      body: {
        request_id: requestId,
        responder_id: responder.responder_id,
        hotline_id: responder.hotline_id,
        delay_ms: 0
      }
    });
    const done = await waitFor(async () => {
      const polled = await jsonRequest(responderUrl, `/controller/tasks/${first.body.task_id}/result`);
      if (polled.body?.available !== true) {
        throw new Error("not_ready");
      }
      return polled;
    });
    expect(done.body.result_package.status).toBe("ok");

    // The caller never saw the result, so the same request_id arrives again.
    const second = await jsonRequest(responderUrl, "/controller/tasks", {
      method: "POST",
      body: {
        request_id: requestId,
        responder_id: responder.responder_id,
        hotline_id: responder.hotline_id,
        delay_ms: 0
      }
    });
    // 200 with replayed:true, not 202 — the runtime distinguishes "queued this
    // for you" from "you already have an answer, here it is again".
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ deduped: true, replayed: true, accepted: false });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(executions).toBe(1);
    // Same task, same signed result — not a second execution wearing the same id.
    expect(second.body.task_id).toBe(first.body.task_id);
  });

  it("retry: each attempt is journaled separately and none is left open", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-matrix-retry-"));
    const journal = await createSqliteExecutionJournal({
      databasePath: path.join(dir, "state.sqlite"),
      serviceName: "matrix-retry"
    });
    await journal.migrate();
    cleanup.push(() => {
      journal.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const callId = `req_retry_${crypto.randomUUID()}`;
    journal.append({
      bootId: "boot_a",
      callId,
      attemptId: "attempt_1",
      entryType: JOURNAL_ENTRY.ATTEMPT_STARTED,
      recoverability: "restartable"
    });
    // Interrupted, then redone under a new boot with a fresh attempt id.
    journal.append({ bootId: "boot_b", callId, attemptId: "attempt_1", entryType: JOURNAL_ENTRY.ATTEMPT_SUPERSEDED });
    journal.append({
      bootId: "boot_b",
      callId,
      attemptId: "attempt_2",
      entryType: JOURNAL_ENTRY.ATTEMPT_STARTED,
      recoverability: "restartable"
    });
    journal.append({
      bootId: "boot_b",
      callId,
      attemptId: "attempt_2",
      entryType: JOURNAL_ENTRY.ATTEMPT_TERMINAL,
      observedExecution: "delivered"
    });

    const entries = journal.listEntries({ callId });
    expect(new Set(entries.map((entry) => entry.attempt_id)).size).toBe(2);
    // The superseded attempt is closed but not terminal — nobody observed how
    // it ended, and recording it as delivered or failed would be a claim.
    const superseded = entries.filter((entry) => entry.attempt_id === "attempt_1");
    expect(superseded.map((entry) => entry.entry_type)).toEqual([
      JOURNAL_ENTRY.ATTEMPT_STARTED,
      JOURNAL_ENTRY.ATTEMPT_SUPERSEDED
    ]);
    expect(superseded.every((entry) => entry.observed_execution === null)).toBe(true);

    // Nothing left open, so a later boot does not reopen a call that finished.
    expect(journal.listInterruptedAttempts({ excludeBootId: "boot_c" })).toHaveLength(0);
  });
});
