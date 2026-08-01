// Input artifacts: the caller's document reaching the responder without ever
// entering the envelope (A-01, FR-032), against a real platform-api.
//
// The output half of the channel shipped in CHG-2026-188; this is the half
// that makes a real MinerU call possible at all. A PDF cannot travel as inline
// base64 through the relay, so until the caller can upload input bytes and the
// responder can fetch them, "cross-device document work" has no path.
import crypto from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createPlatformServer, createPlatformState } from "@delexec/platform-api";
import { checksumOf, uploadArtifact } from "../../packages/artifact-client/src/index.js";
import { uploadCallerInputArtifacts, buildDispatchEnvelope } from "../../packages/caller-controller-core/src/index.js";
import { createResponderState } from "../../packages/responder-runtime-core/src/index.js";
import { createResponderControllerServer } from "@delexec/responder-controller";
import { closeServer, jsonRequest, listenServer, waitFor } from "../helpers/http.js";

// Big enough that inlining it would be the wrong answer, and binary so any
// base64/utf8 confusion shows up as a checksum failure rather than silence.
const DOCUMENT = crypto.randomBytes(256 * 1024);

describe("input artifacts", () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()();
    }
  });

  async function startPlatform(requestId) {
    const state = createPlatformState({ adminApiKey: "sk_admin_input_artifacts", bootstrapEnabled: true });
    const server = createPlatformServer({ serviceName: "input-artifacts-test", state });
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

  it("uploads the caller's document and leaves only a descriptor in the envelope", async () => {
    const ctx = await startPlatform("req_input_artifact_dispatch");
    const request = { request_id: ctx.requestId, responder_id: ctx.responder.responder_id, hotline_id: ctx.responder.hotline_id };

    const uploaded = await uploadCallerInputArtifacts(
      request,
      { baseUrl: ctx.baseUrl, apiKey: ctx.callerApiKey },
      {
        input_artifacts: [
          { name: "paper.pdf", media_type: "application/pdf", content_base64: DOCUMENT.toString("base64") }
        ]
      }
    );

    expect(uploaded.descriptors).toHaveLength(1);
    expect(uploaded.descriptors[0].checksum.value).toBe(checksumOf(DOCUMENT));
    expect(uploaded.descriptors[0].role).toBe("input");

    const envelope = buildDispatchEnvelope(request, {
      payload: { note: "parse this" },
      input_artifact_descriptors: uploaded.descriptors
    });

    // The bytes are not in the envelope, and neither is anything that would
    // let a reader go get them without asking the platform.
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain(DOCUMENT.toString("base64").slice(0, 64));
    expect(serialized.length).toBeLessThan(4096);
    for (const forbidden of ["bucket", "object_key", "presigned_url", "local_path"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(envelope.input_artifact_descriptors[0].artifact_id).toBe(uploaded.descriptors[0].artifact_id);
  });

  it("omits the field entirely when the caller sent no input artifacts", async () => {
    // An envelope from the inline path must be byte-for-byte what it was
    // before this feature existed.
    const envelope = buildDispatchEnvelope(
      { request_id: "req_none", responder_id: "r", hotline_id: "h" },
      { payload: {} }
    );
    expect(envelope).not.toHaveProperty("input_artifact_descriptors");
  });

  it("hands the responder's executor the verified bytes", async () => {
    const ctx = await startPlatform("req_input_artifact_execute");
    const descriptor = await uploadArtifact({
      platformBaseUrl: ctx.baseUrl,
      apiKey: ctx.callerApiKey,
      requestId: ctx.requestId,
      role: "input",
      mediaType: "application/pdf",
      buffer: DOCUMENT
    });

    let seen = null;
    const state = createResponderState({
      responderId: ctx.responder.responder_id,
      hotlineIds: [ctx.responder.hotline_id]
    });
    const server = createResponderControllerServer({
      serviceName: "input-artifact-responder",
      state,
      platform: { baseUrl: ctx.baseUrl, apiKey: ctx.responder.api_key },
      executor: {
        name: "capture",
        async execute(context) {
          seen = context.inputArtifacts;
          return { status: "ok", output: { received: (context.inputArtifacts || []).length } };
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

    expect(seen).toHaveLength(1);
    // Byte-identical to what the caller uploaded — the whole point.
    expect(Buffer.from(seen[0].content_base64, "base64").equals(DOCUMENT)).toBe(true);
    expect(seen[0].name).toBe("paper.pdf");
  });

  it("fails the task instead of running the hotline on a document it could not fetch", async () => {
    // Executing anyway would produce a confident result derived from nothing,
    // which is worse than a clean failure.
    const ctx = await startPlatform("req_input_artifact_missing");
    let executed = false;
    const state = createResponderState({
      responderId: ctx.responder.responder_id,
      hotlineIds: [ctx.responder.hotline_id]
    });
    const server = createResponderControllerServer({
      serviceName: "input-artifact-missing-responder",
      state,
      platform: { baseUrl: ctx.baseUrl, apiKey: ctx.responder.api_key },
      executor: {
        name: "should-not-run",
        async execute() {
          executed = true;
          return { status: "ok", output: {} };
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
        input_artifact_descriptors: [
          { artifact_id: "art_does_not_exist", media_type: "application/pdf", name: "ghost.pdf" }
        ]
      }
    });
    expect(created.status).toBe(202);

    const result = await waitFor(async () => {
      const polled = await jsonRequest(responderUrl, `/controller/tasks/${created.body.task_id}/result`);
      if (polled.status !== 200 || polled.body.available !== true) {
        throw new Error("result_not_ready");
      }
      return polled;
    });

    expect(executed).toBe(false);
    expect(result.body.result_package.status).toBe("error");
    expect(result.body.result_package.error.code).toBe("INPUT_ARTIFACT_UNAVAILABLE");
  });

  it("refuses to dispatch when the input upload fails", async () => {
    // Nothing half-happens: the caller gets an error and no task exists.
    const request = { request_id: "req_input_upload_fails", responder_id: "r", hotline_id: "h" };
    await expect(
      uploadCallerInputArtifacts(
        request,
        { baseUrl: "http://127.0.0.1:1", apiKey: "sk_unreachable" },
        { input_artifacts: [{ name: "paper.pdf", media_type: "application/pdf", content_base64: "AAAA" }] }
      )
    ).rejects.toMatchObject({ code: "caller_input_artifact_upload_failed" });
  });

  it("keeps the inline path for local-only runs with no platform binding", async () => {
    const result = await uploadCallerInputArtifacts(
      { request_id: "req_local" },
      { baseUrl: null, apiKey: null },
      { input_artifacts: [{ name: "note.txt", media_type: "text/plain", content_base64: "aGk=" }] }
    );
    expect(result).toMatchObject({ descriptors: [], skipped: true });
  });
});
