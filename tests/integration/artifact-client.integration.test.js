// The client half of the artifact channel, exercised against a real
// platform-api. The property that matters: bytes cross the channel and come
// back byte-identical, and anything that does not verify is refused rather
// than returned.
import crypto from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createPlatformServer, createPlatformState } from "@delexec/platform-api";
import {
  canUseArtifactChannel,
  checksumOf,
  downloadArtifact,
  resolveArtifactDescriptors,
  uploadArtifact,
  uploadExecutionArtifacts
} from "../../packages/artifact-client/src/index.js";
import { closeServer, jsonRequest, listenServer } from "../helpers/http.js";

const PAYLOAD = Buffer.from("mineru output page 1\n".repeat(64), "utf8");

describe("artifact channel client", () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()();
    }
  });

  async function startPlatform() {
    const state = createPlatformState({ adminApiKey: "sk_admin_artifact_client", bootstrapEnabled: true });
    const server = createPlatformServer({ serviceName: "artifact-client-test", state });
    const baseUrl = await listenServer(server);
    cleanup.push(() => closeServer(server));

    const caller = await jsonRequest(baseUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "artifact-client@test.local" }
    });
    const apiKey = caller.body.api_key;

    const responder = state.bootstrap.responders[0];
    const requestId = "req_artifact_client_1";
    const token = await jsonRequest(baseUrl, "/v1/tokens/task", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { request_id: requestId, responder_id: responder.responder_id, hotline_id: responder.hotline_id }
    });
    expect(token.status).toBe(201);

    return { state, baseUrl, apiKey, requestId };
  }

  it("uploads, commits and downloads an artifact byte-identically", async () => {
    const { baseUrl, apiKey, requestId } = await startPlatform();

    const descriptor = await uploadArtifact({
      platformBaseUrl: baseUrl,
      apiKey,
      requestId,
      role: "output",
      mediaType: "text/plain",
      buffer: PAYLOAD
    });

    expect(descriptor.lifecycle_state).toBe("committed");
    expect(descriptor.checksum.value).toBe(checksumOf(PAYLOAD));
    // A-01: the descriptor that travels carries no storage locator
    for (const forbidden of ["bucket", "object_key", "presigned_url", "url", "local_path"]) {
      expect(descriptor, forbidden).not.toHaveProperty(forbidden);
    }

    const { buffer, descriptor: fetched } = await downloadArtifact({
      platformBaseUrl: baseUrl,
      apiKey,
      artifactId: descriptor.artifact_id
    });
    expect(buffer.equals(PAYLOAD)).toBe(true);
    expect(fetched.artifact_id).toBe(descriptor.artifact_id);
  });

  it("refuses bytes that do not match the committed checksum", async () => {
    const { state, baseUrl, apiKey, requestId } = await startPlatform();
    const descriptor = await uploadArtifact({
      platformBaseUrl: baseUrl,
      apiKey,
      requestId,
      role: "output",
      mediaType: "text/plain",
      buffer: PAYLOAD
    });

    // corrupt the stored checksum so the download can no longer verify
    state.artifacts.get(descriptor.artifact_id).checksum = { algorithm: "sha256", value: "0".repeat(64) };

    await expect(
      downloadArtifact({ platformBaseUrl: baseUrl, apiKey, artifactId: descriptor.artifact_id })
    ).rejects.toMatchObject({ code: "artifact_checksum_mismatch" });
  });

  it("claims a locally computed checksum so corruption in transit is caught", async () => {
    const { baseUrl, apiKey, requestId } = await startPlatform();
    // If the client echoed the server's checksum the commit check would be
    // tautological; committing a locally computed one is what makes it real.
    const descriptor = await uploadArtifact({
      platformBaseUrl: baseUrl,
      apiKey,
      requestId,
      role: "output",
      mediaType: "application/octet-stream",
      buffer: PAYLOAD
    });
    expect(descriptor.checksum.value).toBe(crypto.createHash("sha256").update(PAYLOAD).digest("hex"));
  });

  it("round-trips execution artifacts into envelope descriptors and back", async () => {
    const { baseUrl, apiKey, requestId } = await startPlatform();
    const platform = { baseUrl, apiKey };

    const { descriptors, failures } = await uploadExecutionArtifacts({
      platform,
      requestId,
      artifacts: [
        { name: "page-1.md", media_type: "text/markdown", content_base64: PAYLOAD.toString("base64") },
        { name: "page-2.md", media_type: "text/markdown", content_base64: Buffer.from("second").toString("base64") }
      ]
    });
    expect(failures).toEqual([]);
    expect(descriptors).toHaveLength(2);
    expect(descriptors[0].name).toBe("page-1.md");

    const resolved = await resolveArtifactDescriptors({ platform, descriptors });
    expect(resolved.failures).toEqual([]);
    expect(resolved.attachments).toHaveLength(2);
    // the resolved shape matches what the inline path already produces
    expect(Buffer.from(resolved.attachments[0].content_base64, "base64").equals(PAYLOAD)).toBe(true);
    expect(resolved.attachments[0].name).toBe("page-1.md");
    expect(resolved.attachments[0].byte_size).toBe(PAYLOAD.length);
  });

  it("reports a failed upload rather than dropping the artifact silently", async () => {
    const { baseUrl, requestId } = await startPlatform();
    const platform = { baseUrl, apiKey: "sk_caller_not_valid" };

    const { descriptors, failures } = await uploadExecutionArtifacts({
      platform,
      requestId,
      artifacts: [{ name: "page-1.md", media_type: "text/markdown", content_base64: PAYLOAD.toString("base64") }]
    });

    expect(descriptors).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe("page-1.md");
  });

  it("refuses to run without platform credentials instead of failing obscurely", async () => {
    await expect(
      uploadArtifact({ platformBaseUrl: null, apiKey: null, requestId: "r", role: "output", buffer: Buffer.from("x") })
    ).rejects.toThrow(/platform_credentials_required/);

    expect(canUseArtifactChannel({ baseUrl: "http://x", apiKey: "k" })).toBe(true);
    expect(canUseArtifactChannel({ baseUrl: "http://x" })).toBe(false);
    expect(canUseArtifactChannel(null)).toBe(false);
  });

  it("keeps a stranger from reading another request's artifact", async () => {
    const { baseUrl, apiKey, requestId } = await startPlatform();
    const descriptor = await uploadArtifact({
      platformBaseUrl: baseUrl,
      apiKey,
      requestId,
      role: "output",
      mediaType: "text/plain",
      buffer: PAYLOAD
    });

    const stranger = await jsonRequest(baseUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "artifact-stranger@test.local" }
    });

    await expect(
      downloadArtifact({ platformBaseUrl: baseUrl, apiKey: stranger.body.api_key, artifactId: descriptor.artifact_id })
    ).rejects.toMatchObject({ code: "artifact_descriptor_failed", status: 403 });
  });
});
