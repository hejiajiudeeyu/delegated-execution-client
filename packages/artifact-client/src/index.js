// Client side of the platform artifact channel (decision A-01).
//
// Before this, artifacts travelled as base64 inside the message envelope, which
// made the transport carry large-file semantics it was never designed for — the
// bottleneck named as risk R2. Now the bytes go through the platform's artifact
// channel and only a descriptor travels in the envelope.
//
// The invariant this module exists to hold: a downloaded artifact is only
// handed back if its bytes hash to the checksum the descriptor claims. A
// caller must never be able to act on bytes that were altered in transit.

import crypto from "node:crypto";

export const CHECKSUM_ALGORITHM = "sha256";

export function checksumOf(buffer) {
  return crypto.createHash(CHECKSUM_ALGORITHM).update(buffer).digest("hex");
}

function joinUrl(baseUrl, pathname) {
  const base = String(baseUrl || "").endsWith("/") ? String(baseUrl) : `${baseUrl}/`;
  return new URL(String(pathname).replace(/^\/+/, ""), base);
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function failure(code, response, body) {
  const error = new Error(`${code}:${response.status}`);
  error.code = code;
  error.status = response.status;
  error.body = body;
  return error;
}

/**
 * Upload one artifact and commit it, returning the descriptor that travels in
 * the envelope. Commit is what makes the bytes usable: an uncommitted artifact
 * never serves content, so a partial upload cannot be mistaken for a delivery.
 *
 * @returns {Promise<object>} the committed descriptor (no storage locators)
 */
export async function uploadArtifact({ platformBaseUrl, apiKey, requestId, role, mediaType, buffer }) {
  if (!platformBaseUrl || !apiKey) {
    throw new Error("artifact_client_platform_credentials_required");
  }
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("artifact_client_buffer_required");
  }

  const authHeaders = { Authorization: `Bearer ${apiKey}` };

  const allocateResponse = await fetch(joinUrl(platformBaseUrl, `/v1/requests/${encodeURIComponent(requestId)}/artifacts`), {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ role, media_type: mediaType })
  });
  const allocated = await readJson(allocateResponse);
  if (allocateResponse.status !== 201) {
    throw failure("artifact_allocate_failed", allocateResponse, allocated);
  }

  const grantHeaders = { Authorization: `Bearer ${allocated.upload_grant}` };
  const uploadResponse = await fetch(joinUrl(platformBaseUrl, `/v1/artifacts/${allocated.artifact_id}/content`), {
    method: "PUT",
    headers: { ...grantHeaders, "content-type": mediaType || "application/octet-stream" },
    body: buffer
  });
  const uploaded = await readJson(uploadResponse);
  if (uploadResponse.status !== 200) {
    throw failure("artifact_upload_failed", uploadResponse, uploaded);
  }

  // Claim the checksum we computed locally rather than echoing the server's.
  // Echoing back what the server just told us would make the commit check
  // tautological and unable to catch corruption in transit.
  const localChecksum = checksumOf(buffer);
  const commitResponse = await fetch(joinUrl(platformBaseUrl, `/v1/artifacts/${allocated.artifact_id}/commit`), {
    method: "POST",
    headers: { ...grantHeaders, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ checksum: { algorithm: CHECKSUM_ALGORITHM, value: localChecksum } })
  });
  const committed = await readJson(commitResponse);
  if (commitResponse.status !== 200) {
    throw failure("artifact_commit_failed", commitResponse, committed);
  }

  return committed;
}

/**
 * Fetch an artifact and verify it against the checksum the platform holds.
 * Throws rather than returning unverified bytes.
 */
export async function downloadArtifact({ platformBaseUrl, apiKey, artifactId }) {
  if (!platformBaseUrl || !apiKey) {
    throw new Error("artifact_client_platform_credentials_required");
  }
  const authHeaders = { Authorization: `Bearer ${apiKey}` };

  const detailResponse = await fetch(joinUrl(platformBaseUrl, `/v1/artifacts/${encodeURIComponent(artifactId)}`), {
    headers: authHeaders
  });
  const descriptor = await readJson(detailResponse);
  if (detailResponse.status !== 200) {
    throw failure("artifact_descriptor_failed", detailResponse, descriptor);
  }

  const contentResponse = await fetch(joinUrl(platformBaseUrl, `/v1/artifacts/${encodeURIComponent(artifactId)}/content`), {
    headers: { Authorization: `Bearer ${descriptor.download_grant}` }
  });
  if (contentResponse.status !== 200) {
    throw failure("artifact_download_failed", contentResponse, await readJson(contentResponse));
  }
  const buffer = Buffer.from(await contentResponse.arrayBuffer());

  const expected = descriptor.checksum?.value;
  const actual = checksumOf(buffer);
  if (!expected || expected !== actual) {
    // Never hand back bytes that do not match what was committed.
    const error = new Error("artifact_checksum_mismatch");
    error.code = "artifact_checksum_mismatch";
    error.expected = expected || null;
    error.actual = actual;
    throw error;
  }

  return { buffer, descriptor };
}

/**
 * Is the platform artifact channel usable for this request?
 * Local-only runs have no platform binding and keep the inline path.
 */
export function canUseArtifactChannel(platform) {
  return Boolean(platform?.baseUrl && platform?.apiKey);
}

/**
 * Upload execution artifacts and return envelope-ready descriptors.
 * Artifacts that fail to upload are reported rather than silently dropped:
 * a missing output must not look like a successful delivery.
 */
export async function uploadExecutionArtifacts({ platform, requestId, artifacts = [], role = "output" }) {
  const descriptors = [];
  const failures = [];
  for (const artifact of artifacts) {
    const buffer = Buffer.from(artifact.content_base64 || "", "base64");
    try {
      const descriptor = await uploadArtifact({
        platformBaseUrl: platform.baseUrl,
        apiKey: platform.apiKey,
        requestId,
        role,
        mediaType: artifact.media_type || "application/octet-stream",
        buffer
      });
      descriptors.push({ ...descriptor, name: artifact.name });
    } catch (error) {
      failures.push({ name: artifact.name, code: error.code || "artifact_upload_failed", message: error.message });
    }
  }
  return { descriptors, failures };
}

/**
 * Resolve envelope descriptors back into the inline attachment shape the
 * existing binding checks already understand, so both transports converge on
 * one verification path.
 */
export async function resolveArtifactDescriptors({ platform, descriptors = [] }) {
  const attachments = [];
  const failures = [];
  for (const descriptor of descriptors) {
    try {
      const { buffer } = await downloadArtifact({
        platformBaseUrl: platform.baseUrl,
        apiKey: platform.apiKey,
        artifactId: descriptor.artifact_id
      });
      attachments.push({
        name: descriptor.name || descriptor.artifact_id,
        media_type: descriptor.media_type,
        byte_size: buffer.length,
        content_base64: buffer.toString("base64")
      });
    } catch (error) {
      failures.push({
        artifact_id: descriptor.artifact_id,
        code: error.code || "artifact_download_failed",
        message: error.message
      });
    }
  }
  return { attachments, failures };
}
