// FR-036, responder side: while a task runs, the device says what it is
// doing — fetching input, executing, uploading output — against a real
// platform-api. The beats are observations with a hard ceiling on their own
// importance: every path that posts one swallows failure, because a progress
// report that can fail a task would make visibility cost more than the
// blindness it cures.
import crypto from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createPlatformServer, createPlatformState } from "@delexec/platform-api";
import { uploadArtifact } from "../../packages/artifact-client/src/index.js";
import { createResponderState } from "../../packages/responder-runtime-core/src/index.js";
import { createResponderControllerServer } from "@delexec/responder-controller";
import { closeServer, jsonRequest, listenServer, waitFor } from "../helpers/http.js";

const DOCUMENT = crypto.randomBytes(64 * 1024);

describe("progress reporting", () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()();
    }
  });

  async function startPlatform(requestId) {
    const state = createPlatformState({ adminApiKey: "sk_admin_progress_reporting", bootstrapEnabled: true });
    const server = createPlatformServer({ serviceName: "progress-reporting-test", state });
    const baseUrl = await listenServer(server);
    cleanup.push(() => closeServer(server));

    const caller = await jsonRequest(baseUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: `${requestId}@test.local` }
    });
    expect(caller.status).toBe(201);

    const responder = state.bootstrap.responders[0];
    const token = await jsonRequest(baseUrl, "/v1/tokens/task", {
      method: "POST",
      headers: { Authorization: `Bearer ${caller.body.api_key}` },
      body: { request_id: requestId, responder_id: responder.responder_id, hotline_id: responder.hotline_id }
    });
    expect(token.status).toBe(201);

    return { state, baseUrl, callerApiKey: caller.body.api_key, responder, requestId };
  }

  it("narrates a full artifact journey: input_fetching, executing, output_uploading", async () => {
    const ctx = await startPlatform("req_progress_journey");
    const descriptor = await uploadArtifact({
      platformBaseUrl: ctx.baseUrl,
      apiKey: ctx.callerApiKey,
      requestId: ctx.requestId,
      role: "input",
      mediaType: "application/pdf",
      buffer: DOCUMENT
    });

    const state = createResponderState({
      responderId: ctx.responder.responder_id,
      hotlineIds: [ctx.responder.hotline_id]
    });
    // A stub transport with a delivery target, so the result envelope path —
    // and with it the output artifact upload the last beat narrates — runs
    // exactly as it does cross-device.
    const sentEnvelopes = [];
    const server = createResponderControllerServer({
      serviceName: "progress-journey-responder",
      state,
      transport: { async send(message) { sentEnvelopes.push(message); } },
      platform: { baseUrl: ctx.baseUrl, apiKey: ctx.responder.api_key },
      executor: {
        name: "narrating",
        async execute(context, hooks) {
          // A hotline that knows where it is may say so mid-run.
          await hooks.reportProgress({ percent: 42, message: "page 4 of 10" });
          return {
            status: "ok",
            output: { pages: 10 },
            artifacts: [{ name: "out.md", media_type: "text/markdown", content_base64: Buffer.from("# done").toString("base64") }]
          };
        }
      }
    });
    const responderUrl = await listenServer(server);
    cleanup.push(() => closeServer(server));

    const created = await jsonRequest(responderUrl, "/controller/tasks", {
      method: "POST",
      body: {
        request_id: ctx.requestId,
        responder_id: ctx.responder.responder_id,
        hotline_id: ctx.responder.hotline_id,
        delay_ms: 0,
        reply_to: "caller@progress.test",
        input_artifact_descriptors: [{ ...descriptor, name: "paper.pdf" }]
      }
    });
    expect(created.status).toBe(202);

    await waitFor(async () => {
      const polled = await jsonRequest(responderUrl, `/controller/tasks/${created.body.task_id}/result`);
      if (polled.status !== 200 || polled.body.available !== true) {
        throw new Error("result_not_ready");
      }
      return polled;
    });

    const events = await jsonRequest(ctx.baseUrl, `/v1/requests/${ctx.requestId}/events`, {
      headers: { Authorization: `Bearer ${ctx.callerApiKey}` }
    });
    expect(events.status).toBe(200);

    const beats = events.body.events.filter((event) => event.event_type === "PROGRESS").map((event) => event.progress);
    expect(beats.map((beat) => beat.stage)).toEqual(["input_fetching", "executing", "executing", "output_uploading"]);
    // One attempt, one monotonic sequence.
    expect(beats.map((beat) => beat.seq)).toEqual([0, 1, 2, 3]);
    expect(new Set(beats.map((beat) => beat.attempt_id)).size).toBe(1);
    expect(beats[2]).toMatchObject({ percent: 42, message: "page 4 of 10" });
    // The narration changed nothing about the outcome: the envelope went out
    // carrying descriptors, not bytes, exactly as before this feature.
    expect(events.body.events.some((event) => event.event_type === "COMPLETED")).toBe(true);
    expect(sentEnvelopes).toHaveLength(1);
    expect(sentEnvelopes[0].artifact_descriptors).toHaveLength(1);
    expect(sentEnvelopes[0].attachments).toHaveLength(0);
  });

  it("skips the input beat when there is nothing to fetch", async () => {
    const ctx = await startPlatform("req_progress_no_input");
    const state = createResponderState({
      responderId: ctx.responder.responder_id,
      hotlineIds: [ctx.responder.hotline_id]
    });
    const server = createResponderControllerServer({
      serviceName: "progress-no-input-responder",
      state,
      platform: { baseUrl: ctx.baseUrl, apiKey: ctx.responder.api_key },
      executor: {
        name: "plain",
        async execute() {
          return { status: "ok", output: { done: true } };
        }
      }
    });
    const responderUrl = await listenServer(server);
    cleanup.push(() => closeServer(server));

    const created = await jsonRequest(responderUrl, "/controller/tasks", {
      method: "POST",
      body: {
        request_id: ctx.requestId,
        responder_id: ctx.responder.responder_id,
        hotline_id: ctx.responder.hotline_id,
        delay_ms: 0
      }
    });
    expect(created.status).toBe(202);

    await waitFor(async () => {
      const polled = await jsonRequest(responderUrl, `/controller/tasks/${created.body.task_id}/result`);
      if (polled.status !== 200 || polled.body.available !== true) {
        throw new Error("result_not_ready");
      }
      return polled;
    });

    const events = await jsonRequest(ctx.baseUrl, `/v1/requests/${ctx.requestId}/events`, {
      headers: { Authorization: `Bearer ${ctx.callerApiKey}` }
    });
    const stages = events.body.events
      .filter((event) => event.event_type === "PROGRESS")
      .map((event) => event.progress.stage);
    // No input artifacts and no output artifacts: the only honest beat is
    // "executing". Claiming to fetch or upload nothing would be noise.
    expect(stages).toEqual(["executing"]);
  });

  it("keeps local-only runs silent: no platform binding, no beats, same result", async () => {
    const state = createResponderState({ responderId: "responder_local", hotlineIds: ["local.hotline.v1"] });
    let hookResult = null;
    const server = createResponderControllerServer({
      serviceName: "progress-local-responder",
      state,
      executor: {
        name: "local",
        async execute(context, hooks) {
          // The hook exists and is safe to call even with nowhere to post.
          hookResult = await hooks.reportProgress({ percent: 50 });
          return { status: "ok", output: { done: true } };
        }
      }
    });
    const responderUrl = await listenServer(server);
    cleanup.push(() => closeServer(server));

    const created = await jsonRequest(responderUrl, "/controller/tasks", {
      method: "POST",
      body: { request_id: "req_local_progress", delay_ms: 0 }
    });
    expect(created.status).toBe(202);

    const result = await waitFor(async () => {
      const polled = await jsonRequest(responderUrl, `/controller/tasks/${created.body.task_id}/result`);
      if (polled.status !== 200 || polled.body.available !== true) {
        throw new Error("result_not_ready");
      }
      return polled;
    });

    expect(result.body.result_package.status).toBe("ok");
    expect(hookResult).toMatchObject({ ok: false, skipped: true });
  });
});
