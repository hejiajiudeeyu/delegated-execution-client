import crypto from "node:crypto";
import http from "node:http";

import { buildStructuredError, canonicalizeResultPackageForSignature } from "@delexec/contracts";
import {
  createConfiguredHotlineExecutor,
  createExampleFunctionExecutor,
  createFunctionExecutor,
  createSimulatorExecutor,
  createHotlineRouterExecutor,
  deferTask
} from "./executors.js";

function nowIso() {
  return new Date().toISOString();
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization, X-Platform-Api-Key"
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, code, message, { retryable, ...extra } = {}) {
  sendJson(res, statusCode, buildStructuredError(code, message, { retryable, ...extra }));
}

async function postJson(baseUrl, pathname, { method = "POST", headers = {}, body } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null
  };
}

async function postMetricEvent(platform, body) {
  if (!platform?.baseUrl || !platform.apiKey) {
    return { ok: false, skipped: true };
  }

  const response = await postJson(platform.baseUrl, "/v1/metrics/events", {
    headers: {
      Authorization: `Bearer ${platform.apiKey}`
    },
    body
  });

  return { ok: response.status >= 200 && response.status < 300, response };
}

async function registerResponderOnPlatform(platform, body) {
  if (!platform?.baseUrl) {
    throw new Error("responder_platform_base_url_required");
  }

  const response = await postJson(platform.baseUrl, "/v2/responders/register", {
    headers: platform.apiKey
      ? {
          Authorization: `Bearer ${platform.apiKey}`
        }
      : {},
    body
  });

  if (response.status !== 201) {
    const error = new Error("RESPONDER_PLATFORM_REGISTER_FAILED");
    error.response = response;
    throw error;
  }

  return response.body;
}

async function persistResponderState(onStateChanged, state) {
  if (typeof onStateChanged === "function") {
    await onStateChanged(state);
  }
}

function buildResultTiming(task) {
  const acceptedAt = task.accepted_at || task.enqueued_at || nowIso();
  const finishedAt = task.completed_at || nowIso();
  const acceptedMs = Date.parse(acceptedAt);
  const finishedMs = Date.parse(finishedAt);
  const elapsedMs =
    Number.isFinite(acceptedMs) && Number.isFinite(finishedMs) ? Math.max(0, finishedMs - acceptedMs) : task.delay_ms;

  return {
    accepted_at: acceptedAt,
    finished_at: finishedAt,
    elapsed_ms: elapsedMs
  };
}

function buildBaseResultPayload(task) {
  return {
    message_type: "remote_hotline_result",
    request_id: task.request_id,
    result_version: "0.1.0",
    responder_id: task.responder_id,
    hotline_id: task.hotline_id,
    verification: task.verification || null,
    timing: buildResultTiming(task)
  };
}

function buildErrorResultPayload(task, { code, message, retryable = false, schemaValid = true, usage } = {}) {
  return {
    ...buildBaseResultPayload(task),
    status: "error",
    error: {
      code,
      message,
      retryable
    },
    schema_valid: schemaValid,
    usage: usage || { tokens_in: 0, tokens_out: 0 }
  };
}

function buildGuardrailError(code, message) {
  return {
    status: "error",
    error: {
      code,
      message,
      retryable: false
    },
    schema_valid: true,
    usage: { tokens_in: 0, tokens_out: 0 }
  };
}

function buildResultPayload(task, execution) {
  if (!execution || typeof execution !== "object") {
    return buildErrorResultPayload(task, {
      code: "EXECUTOR_INVALID_RESULT",
      message: "Responder executor returned an invalid result object"
    });
  }

  if (execution.status === "error") {
    return buildErrorResultPayload(task, {
      code: execution.error?.code || "EXECUTOR_RUNTIME_ERROR",
      message: execution.error?.message || "Responder executor reported an error",
      retryable: execution.error?.retryable === true,
      schemaValid: execution.schema_valid !== false,
      usage: execution.usage
    });
  }

  if (execution.status !== "ok") {
    return buildErrorResultPayload(task, {
      code: "EXECUTOR_INVALID_RESULT",
      message: "Responder executor must return status 'ok' or 'error'"
    });
  }

  return {
    ...buildBaseResultPayload(task),
    status: "ok",
    output: "output" in execution ? execution.output : null,
    artifacts: sanitizeArtifactsForResult(execution.artifacts),
    schema_valid: execution.schema_valid !== false,
    usage: execution.usage || { tokens_in: 0, tokens_out: 0 }
  };
}

function normalizeArtifactContent(artifact) {
  if (Buffer.isBuffer(artifact?.content)) {
    return artifact.content;
  }
  if (artifact?.content_base64) {
    return Buffer.from(artifact.content_base64, "base64");
  }
  if (typeof artifact?.content === "string") {
    return Buffer.from(artifact.content, "utf8");
  }
  return Buffer.alloc(0);
}

function materializeArtifacts(executionArtifacts = []) {
  return (Array.isArray(executionArtifacts) ? executionArtifacts : []).map((artifact, index) => {
    const content = normalizeArtifactContent(artifact);
    return {
      artifact_id: artifact?.artifact_id || `art_${index + 1}`,
      name: artifact?.name || `artifact-${index + 1}.bin`,
      media_type: artifact?.media_type || "application/octet-stream",
      byte_size: content.length,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
      delivery: {
        kind: "email_attachment"
      },
      content_base64: content.toString("base64")
    };
  });
}

function applyExecutionArtifacts(task, execution = {}) {
  if (!execution || typeof execution !== "object") {
    return execution;
  }
  if (!Array.isArray(execution.artifacts) || execution.artifacts.length === 0) {
    return execution;
  }
  return {
    ...execution,
    artifacts: materializeArtifacts(execution.artifacts)
  };
}

function sanitizeArtifactsForResult(artifacts = []) {
  return (Array.isArray(artifacts) ? artifacts : []).map(({ content_base64, ...artifact }) => artifact);
}

function enforceArtifactSizeLimit(task, execution = {}) {
  const maxAttachmentBytes = Number(process.env.EMAIL_MAX_ATTACHMENT_BYTES || 5 * 1024 * 1024);
  const artifacts = Array.isArray(execution.artifacts) ? execution.artifacts : [];
  const totalBytes = artifacts.reduce((sum, artifact) => sum + Number(artifact.byte_size || 0), 0);
  if (totalBytes <= maxAttachmentBytes) {
    return execution;
  }

  return {
    status: "error",
    error: {
      code: "RESULT_ARTIFACT_TOO_LARGE",
      message: `artifact payload exceeds email limit ${maxAttachmentBytes} bytes`,
      retryable: false
    },
    schema_valid: true,
    usage: execution.usage || { tokens_in: 0, tokens_out: 0 }
  };
}

function signResultPayload(payload, state) {
  const signingBytes = Buffer.from(JSON.stringify(canonicalizeResultPackageForSignature(payload)), "utf8");
  const signature = crypto.sign(null, signingBytes, state.signing.privateKey);
  return {
    ...payload,
    signature_algorithm: "Ed25519",
    signer_public_key_pem: state.signing.publicKeyPem,
    signature_base64: signature.toString("base64")
  };
}

async function sendResultEnvelope(task, state, transport) {
  const target = task.result_delivery?.address || task.return_route || task.reply_to;
  if (!transport || !target || !task.result_package) {
    return;
  }

  await transport.send({
    message_id: `msg_result_${crypto.randomUUID()}`,
    thread_id: task.thread_id || `req:${task.request_id}`,
    from: state.identity.responder_id,
    to: target,
    type: "task.result",
    request_id: task.request_id,
    responder_id: state.identity.responder_id,
    hotline_id: task.hotline_id,
    verification: task.verification || null,
    body_text: JSON.stringify(task.result_package),
    attachments: ((task.execution_artifacts || []) || []).map((artifact) => ({
      name: artifact.name,
      media_type: artifact.media_type,
      content_base64: artifact.content_base64,
      byte_size: artifact.byte_size
    })),
    result_package: task.result_package,
    sent_at: nowIso()
  });
}

async function ackPlatform(task, platform) {
  if (!platform?.baseUrl || !platform.apiKey) {
    return { ok: false, skipped: true };
  }

  const response = await postJson(platform.baseUrl, `/v1/requests/${task.request_id}/ack`, {
    headers: {
      Authorization: `Bearer ${platform.apiKey}`
    },
    body: {
      responder_id: platform.responderId || task.responder_id,
      hotline_id: task.hotline_id,
      eta_hint_s: Math.max(1, Math.ceil(task.delay_ms / 1000))
    }
  });

  return { ok: response.status >= 200 && response.status < 300, response };
}

async function postRequestLifecycleEvent(task, platform, eventType, detail = {}) {
  if (!platform?.baseUrl || !platform.apiKey) {
    return { ok: false, skipped: true };
  }

  const response = await postJson(platform.baseUrl, `/v1/requests/${task.request_id}/events`, {
    headers: {
      Authorization: `Bearer ${platform.apiKey}`
    },
    body: {
      responder_id: platform.responderId || task.responder_id,
      hotline_id: task.hotline_id,
      event_type: eventType,
      ...detail
    }
  });

  return { ok: response.status >= 200 && response.status < 300, response };
}

async function heartbeatPlatform(state, platform, status = "healthy") {
  if (!platform?.baseUrl || !platform.apiKey || !state?.identity?.responder_id) {
    return { ok: false, skipped: true };
  }

  const response = await postJson(platform.baseUrl, `/v1/responders/${state.identity.responder_id}/heartbeat`, {
    headers: {
      Authorization: `Bearer ${platform.apiKey}`
    },
    body: {
      status
    }
  });

  return { ok: response.status >= 200 && response.status < 300, response };
}

async function introspectTaskToken(task, platform) {
  if (!platform?.baseUrl || !platform.apiKey || !task.task_token) {
    return { active: true, skipped: true };
  }

  const response = await postJson(platform.baseUrl, "/v1/tokens/introspect", {
    headers: {
      Authorization: `Bearer ${platform.apiKey}`
    },
    body: {
      task_token: task.task_token
    }
  });

  return response.body || { active: false, error: { code: "AUTH_INTROSPECT_FAILED", message: "token introspection request failed", retryable: true } };
}

function createTaskRecord(input, state, overrides = {}) {
  const requestId = input.request_id || `req_${crypto.randomUUID()}`;
  const acceptedAt = nowIso();
  const payload = input.payload ?? input.task_input ?? null;

  return {
    task_id: input.task_id || `task_${crypto.randomUUID()}`,
    request_id: requestId,
    hotline_id: input.hotline_id || state.identity.hotline_ids[0],
    task_type: input.task_type || null,
    task_input: input.task_input ?? input.payload ?? null,
    payload,
    constraints: input.constraints || null,
    simulate: input.simulate || "success",
    priority: Number(input.priority || 5),
    delay_ms: Number(input.delay_ms || 80),
    lease_ttl_s: Number(input.lease_ttl_s || 30),
    status: "QUEUED",
    acked: true,
    accepted_at: acceptedAt,
    enqueued_at: acceptedAt,
    updated_at: acceptedAt,
    result_package: null,
    result_delivery: overrides.result_delivery ?? input.result_delivery ?? null,
    verification: overrides.verification ?? input.verification ?? null,
    return_route: overrides.return_route ?? input.return_route ?? null,
    reply_to: overrides.reply_to ?? input.reply_to ?? null,
    thread_id: overrides.thread_id ?? input.thread_id ?? `req:${requestId}`,
    task_token: input.task_token || null,
    responder_id: input.responder_id || state.identity.responder_id,
    raw_envelope: input.raw_envelope || null
  };
}

function createExecutorContext(task) {
  return {
    requestId: task.request_id,
    responderId: task.responder_id,
    hotlineId: task.hotline_id,
    taskType: task.task_type,
    taskInput: task.task_input,
    payload: task.payload,
    constraints: task.constraints,
    rawEnvelope: task.raw_envelope,
    task
  };
}

async function reportResponderMetric(platform, task, eventType, detail = {}) {
  const metricKey = `${eventType}:${detail.code || ""}`;
  task.metric_flags ||= {};
  if (task.metric_flags[metricKey]) {
    return;
  }

  task.metric_flags[metricKey] = true;
  await postMetricEvent(platform, {
    source: "responder-controller",
    event_type: eventType,
    request_id: task.request_id,
    responder_id: task.responder_id,
    hotline_id: task.hotline_id,
    ...detail
  });
}

function validateTaskGuardrails(task, { executor, guardrails = {} } = {}) {
  const hardTimeoutS = Number(task.constraints?.hard_timeout_s);
  const softTimeoutS = Number(task.constraints?.soft_timeout_s);
  const hasHardTimeout = Number.isFinite(hardTimeoutS);
  const hasSoftTimeout = Number.isFinite(softTimeoutS);
  const maxHardTimeoutS = Number.isFinite(Number(guardrails.maxHardTimeoutS))
    ? Number(guardrails.maxHardTimeoutS)
    : null;
  const allowedTaskTypes = Array.isArray(guardrails.allowedTaskTypes)
    ? guardrails.allowedTaskTypes
    : Array.isArray(executor?.allowedTaskTypes)
      ? executor.allowedTaskTypes
      : typeof executor?.getAllowedTaskTypes === "function"
        ? executor.getAllowedTaskTypes(task.hotline_id)
      : null;

  if (hasSoftTimeout && softTimeoutS <= 0) {
    return buildGuardrailError("CONTRACT_INVALID_TIMEOUT", "soft_timeout_s must be greater than 0");
  }

  if (hasHardTimeout && hardTimeoutS <= 0) {
    return buildGuardrailError("CONTRACT_INVALID_TIMEOUT", "hard_timeout_s must be greater than 0");
  }

  if (hasSoftTimeout && hasHardTimeout && softTimeoutS > hardTimeoutS) {
    return buildGuardrailError("CONTRACT_INVALID_TIMEOUT", "soft_timeout_s cannot exceed hard_timeout_s");
  }

  if (hasHardTimeout && maxHardTimeoutS && hardTimeoutS > maxHardTimeoutS) {
    return buildGuardrailError(
      "CONTRACT_TIMEOUT_EXCEEDS_RESPONDER_LIMIT",
      `hard_timeout_s exceeds responder limit ${maxHardTimeoutS}`
    );
  }

  if (task.task_type && Array.isArray(allowedTaskTypes) && allowedTaskTypes.length > 0) {
    if (!allowedTaskTypes.includes(task.task_type)) {
      return buildGuardrailError(
        "CONTRACT_TASK_TYPE_UNSUPPORTED",
        `task_type '${task.task_type}' is not allowed by responder guardrail`
      );
    }
  }

  return null;
}

async function finalizeTask(task, state, transport, platform, execution) {
  const executionWithArtifacts = enforceArtifactSizeLimit(task, applyExecutionArtifacts(task, execution));
  task.status = "COMPLETED";
  task.completed_at = nowIso();
  task.updated_at = task.completed_at;
  task.execution_artifacts = Array.isArray(executionWithArtifacts.artifacts) ? executionWithArtifacts.artifacts : [];
  task.result_package = signResultPayload(buildResultPayload(task, executionWithArtifacts), state);
  await sendResultEnvelope(task, state, transport);
  const lifecycleEvent =
    task.result_package.status === "ok"
      ? { eventType: "COMPLETED", detail: { status: "ok", finished_at: task.completed_at } }
      : {
          eventType: "FAILED",
          detail: {
            status: "error",
            error_code: task.result_package.error?.code || "EXEC_UNKNOWN",
            finished_at: task.completed_at
          }
        };
  try {
    await postRequestLifecycleEvent(task, platform, lifecycleEvent.eventType, lifecycleEvent.detail);
  } catch {
    // Completion events are observational only and must not invalidate result delivery.
  }
  await reportResponderMetric(
    platform,
    task,
    task.result_package.status === "ok" ? "responder.task.succeeded" : "responder.task.failed",
    task.result_package.status === "error" ? { code: task.result_package.error?.code || "EXEC_UNKNOWN" } : {}
  );
}

async function failTask(task, state, transport, platform, error) {
  await finalizeTask(task, state, transport, platform, {
    status: "error",
    error: {
      code: "EXECUTOR_RUNTIME_ERROR",
      message: error instanceof Error ? error.message : "unknown_error",
      retryable: false
    },
    schema_valid: true,
    usage: { tokens_in: 0, tokens_out: 0 }
  });
}

export function createResponderState(options = {}) {
  const workerConcurrency = Math.max(1, Number(options.workerConcurrency || process.env.RESPONDER_WORKER_CONCURRENCY || 1));
  const signing = options.signing
    ? {
        privateKey: crypto.createPrivateKey(options.signing.privateKeyPem),
        publicKeyPem: options.signing.publicKeyPem
      }
    : (() => {
        const generated = crypto.generateKeyPairSync("ed25519");
        return {
          privateKey: generated.privateKey,
          publicKeyPem: generated.publicKey.export({ type: "spki", format: "pem" }).toString()
        };
      })();

  return {
    tasks: new Map(),
    requestIndex: new Map(),
    queue: [],
    activeTaskIds: [],
    workerConcurrency,
    signing,
    identity: {
      responder_id: options.responderId || "responder_starlight",
      hotline_ids: options.hotlineIds || ["starlight.creative.studio.v1"]
    },
    hotlines: Array.isArray(options.hotlines) ? options.hotlines : [],
    heartbeat: {
      status: "healthy",
      last_sent_at: null
    }
  };
}

export function serializeResponderState(state) {
  return {
    tasks: Array.from(state.tasks.entries()),
    requestIndex: Array.from(state.requestIndex.entries()),
    queue: [...state.queue],
    activeTaskIds: [...(state.activeTaskIds || [])],
    workerConcurrency: state.workerConcurrency,
    identity: state.identity,
    hotlines: state.hotlines,
    heartbeat: state.heartbeat
  };
}

export function hydrateResponderState(state, snapshot) {
  if (!snapshot) {
    return state;
  }

  state.tasks.clear();
  for (const [taskId, task] of snapshot.tasks || []) {
    state.tasks.set(taskId, task);
  }

  state.requestIndex.clear();
  for (const [requestId, taskId] of snapshot.requestIndex || []) {
    state.requestIndex.set(requestId, taskId);
  }

  state.queue = Array.isArray(snapshot.queue) ? [...snapshot.queue] : [];
  state.activeTaskIds = [];
  state.workerConcurrency = Math.max(1, Number(snapshot.workerConcurrency || state.workerConcurrency || 1));
  state.identity = snapshot.identity || state.identity;
  state.hotlines = Array.isArray(snapshot.hotlines) ? snapshot.hotlines : state.hotlines;
  state.heartbeat = snapshot.heartbeat || state.heartbeat;
  return state;
}

function getTaskByRequestId(state, requestId) {
  const taskId = state.requestIndex.get(requestId);
  return taskId ? state.tasks.get(taskId) || null : null;
}

function rememberTask(state, task) {
  state.tasks.set(task.task_id, task);
  state.requestIndex.set(task.request_id, task.task_id);
}

function workerConcurrencyForState(state, override = null) {
  return Math.max(1, Number(override || state.workerConcurrency || 1));
}

async function runQueuedTask(task, state, { executor, transport = null, platform = null, onStateChanged = null } = {}) {
  await persistResponderState(onStateChanged, state);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(task.delay_ms || 0))));

  try {
    const execution = await executor.execute(createExecutorContext(task));
    if (execution?.deferred === true) {
      task.status = "RUNNING";
      task.updated_at = nowIso();
      task.deferred_reason = execution.reason || "deferred";
      await persistResponderState(onStateChanged, state);
    } else {
      await finalizeTask(task, state, transport, platform, execution);
      await persistResponderState(onStateChanged, state);
    }
  } catch (error) {
    await failTask(task, state, transport, platform, error);
    await persistResponderState(onStateChanged, state);
  } finally {
    state.activeTaskIds = (state.activeTaskIds || []).filter((taskId) => taskId !== task.task_id);
    await persistResponderState(onStateChanged, state);
    scheduleProcessQueue(state, { executor, transport, platform, onStateChanged });
  }
}

function scheduleProcessQueue(state, { executor, transport = null, platform = null, onStateChanged = null, workerConcurrency = null } = {}) {
  const maxWorkers = workerConcurrencyForState(state, workerConcurrency);
  while ((state.activeTaskIds || []).length < maxWorkers) {
    const nextTaskId = state.queue.shift();
    if (!nextTaskId) {
      return;
    }

    const task = state.tasks.get(nextTaskId);
    if (!task) {
      continue;
    }

    task.status = "RUNNING";
    task.started_at = nowIso();
    task.updated_at = task.started_at;
    task.lease_expires_at = new Date(Date.now() + task.lease_ttl_s * 1000).toISOString();
    state.activeTaskIds = [...(state.activeTaskIds || []), task.task_id];

    void runQueuedTask(task, state, {
      executor,
      transport,
      platform,
      onStateChanged
    });
  }
}

async function enqueueTask(
  state,
  task,
  { executor, transport = null, platform = null, onStateChanged = null, workerConcurrency = null } = {}
) {
  rememberTask(state, task);
  state.queue.push(task.task_id);

  state.queue.sort((leftId, rightId) => {
    const left = state.tasks.get(leftId);
    const right = state.tasks.get(rightId);
    if (!left || !right) {
      return 0;
    }
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.enqueued_at.localeCompare(right.enqueued_at);
  });

  await persistResponderState(onStateChanged, state);
  scheduleProcessQueue(state, { executor, transport, platform, onStateChanged, workerConcurrency });
}

async function processResponderInbox(state, {
  executor,
  transport = null,
  platform = null,
  guardrails = {},
  onStateChanged = null,
  receiver = null,
  limit = 10
} = {}) {
  if (!transport) {
    return { accepted: [] };
  }

  const polled = await transport.poll({
    limit,
    receiver: receiver || state.identity.responder_id
  });
  const accepted = [];

  for (const envelope of polled.items) {
    if (envelope.responder_id && envelope.responder_id !== state.identity.responder_id) {
      continue;
    }
    if (envelope.hotline_id && !state.identity.hotline_ids.includes(envelope.hotline_id)) {
      continue;
    }

    await postMetricEvent(platform, {
      source: "responder-controller",
      event_type: "responder.task.received",
      request_id: envelope.request_id || null,
      responder_id: state.identity.responder_id,
      hotline_id: envelope.hotline_id || null
    });

    const existing = getTaskByRequestId(state, envelope.request_id);
    if (existing) {
      if (existing.result_package) {
        await sendResultEnvelope(
          {
            ...existing,
            return_route: envelope.from || existing.return_route,
            reply_to: envelope.from || existing.reply_to,
            thread_id: envelope.thread_id || existing.thread_id
          },
          state,
          transport
        );
      }

      await transport.ack(envelope.message_id);
      accepted.push({
        message_id: envelope.message_id,
        task_id: existing.task_id,
        deduped: true,
        replayed: Boolean(existing.result_package)
      });
      continue;
    }

    const task = createTaskRecord(
      {
        ...envelope,
        raw_envelope: envelope
      },
      state,
      {
        return_route: envelope.from || null,
        reply_to: envelope.from || "caller-controller",
        thread_id: envelope.thread_id || `req:${envelope.request_id}`,
        result_delivery: envelope.result_delivery || null,
        verification: envelope.verification || null
      }
    );

    const introspection = await introspectTaskToken(task, platform);
    if (introspection.active === false) {
      task.status = "COMPLETED";
      task.completed_at = nowIso();
      task.updated_at = task.completed_at;
      task.result_package = signResultPayload(
        buildErrorResultPayload(task, {
          code: introspection.error?.code || introspection.error || "AUTH_TOKEN_INVALID",
          message: introspection.error?.message || "Task token rejected during responder validation"
        }),
        state
      );
      rememberTask(state, task);
      await sendResultEnvelope(task, state, transport);
      await reportResponderMetric(platform, task, "responder.task.rejected", {
        code: introspection.error?.code || introspection.error || "AUTH_TOKEN_INVALID"
      });
      await persistResponderState(onStateChanged, state);
    } else {
      const guardrailError = validateTaskGuardrails(task, { executor, guardrails });
      if (guardrailError) {
        task.status = "COMPLETED";
        task.completed_at = nowIso();
        task.updated_at = task.completed_at;
        task.result_package = signResultPayload(buildResultPayload(task, guardrailError), state);
        rememberTask(state, task);
        await sendResultEnvelope(task, state, transport);
        await reportResponderMetric(platform, task, "responder.task.rejected", {
          code: guardrailError.error.code
        });
        await persistResponderState(onStateChanged, state);
      } else {
        await enqueueTask(state, task, { executor, transport, platform, onStateChanged });
        await reportResponderMetric(platform, task, "responder.task.accepted");
        const acked = await ackPlatform(task, platform);
        task.acked = acked.ok;
        await persistResponderState(onStateChanged, state);
      }
    }

    await transport.ack(envelope.message_id);
    accepted.push({ message_id: envelope.message_id, task_id: task.task_id });
  }

  return { accepted };
}

export function startResponderHeartbeatLoop({
  state,
  platform = null,
  intervalMs = 30000,
  logger = console,
  onStateChanged = null
} = {}) {
  if (!platform?.baseUrl || !platform.apiKey || !state?.identity?.responder_id) {
    return () => {};
  }

  let stopped = false;

  async function sendHeartbeat() {
    if (stopped) {
      return;
    }

    try {
      const result = await heartbeatPlatform(state, platform, state.heartbeat?.status || "healthy");
      if (result.ok) {
        state.heartbeat.last_sent_at = nowIso();
        await persistResponderState(onStateChanged, state);
      }
    } catch (error) {
      logger?.warn?.(
        `[responder-heartbeat] failed for ${state.identity.responder_id}: ${
          error instanceof Error ? error.message : "unknown_error"
        }`
      );
    }
  }

  void sendHeartbeat();
  const timer = setInterval(() => {
    void sendHeartbeat();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function startResponderInboxLoop({
  state,
  executor = createSimulatorExecutor(),
  transport = null,
  platform = null,
  guardrails = {},
  onStateChanged = null,
  intervalMs = 250,
  receiver = null,
  logger = console
} = {}) {
  if (!transport) {
    return () => {};
  }

  let stopped = false;
  let running = false;

  async function pullInbox() {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      await processResponderInbox(state, {
        executor,
        transport,
        platform,
        guardrails,
        onStateChanged,
        receiver
      });
    } catch (error) {
      logger?.warn?.(`[responder-inbox] pull failed: ${error instanceof Error ? error.message : "unknown_error"}`);
    } finally {
      running = false;
    }
  }

  void pullInbox();
  const timer = setInterval(() => {
    void pullInbox();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function createResponderControllerServer({
  state = createResponderState(),
  serviceName = "responder-controller",
  transport = null,
  platform = null,
  executor = createSimulatorExecutor(),
  guardrails = {},
  background = {},
  onStateChanged = null,
  onPlatformConfigured = null
} = {}) {
  const workerConcurrency = workerConcurrencyForState(state, background.workerConcurrency);
  state.workerConcurrency = workerConcurrency;
  const server = http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname;

    try {
      if (method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization, X-Platform-Api-Key"
        });
        res.end();
        return;
      }

      if (method === "GET" && pathname === "/healthz") {
        sendJson(res, 200, { ok: true, service: serviceName });
        return;
      }

      if (method === "GET" && pathname === "/readyz") {
        sendJson(res, 200, { ready: true, service: serviceName });
        return;
      }

      if (method === "GET" && pathname === "/") {
        sendJson(res, 200, {
          service: serviceName,
          status: "running",
          executor: executor.name || "unknown",
          responder_id: state.identity.responder_id,
          hotline_ids: state.identity.hotline_ids,
          worker_concurrency: workerConcurrency,
          configured_hotlines:
            typeof executor?.listHotlines === "function"
              ? executor.listHotlines()
              : Array.isArray(state.hotlines)
                ? state.hotlines
                : [],
          guardrails: {
            max_hard_timeout_s: Number.isFinite(Number(guardrails.maxHardTimeoutS))
              ? Number(guardrails.maxHardTimeoutS)
              : null,
            allowed_task_types: Array.isArray(guardrails.allowedTaskTypes) ? guardrails.allowedTaskTypes : null
          }
        });
        return;
      }

      if (method === "GET" && pathname === "/controller/public-key") {
        sendJson(res, 200, {
          responder_id: state.identity.responder_id,
          public_key_pem: state.signing.publicKeyPem
        });
        return;
      }

      if (method === "POST" && pathname === "/controller/register") {
        try {
          const body = await parseJsonBody(req);
          const responderId = body.responder_id || state.identity.responder_id;
          const hotlineId = body.hotline_id || state.identity.hotline_ids[0];
          const headerApiKey = req.headers["x-platform-api-key"];
          const registerPlatform = {
            ...platform,
            apiKey:
              (typeof headerApiKey === "string" && headerApiKey.trim()) ||
              body.platform_api_key ||
              platform?.apiKey ||
              null
          };
          const registered = await registerResponderOnPlatform(registerPlatform, {
            responder_id: responderId,
            hotline_id: hotlineId,
            display_name: body.display_name || `${responderId} ${hotlineId}`,
            template_ref: body.template_ref || `${hotlineId}@v1`,
            task_delivery_address: body.task_delivery_address || `local://relay/${responderId}/${hotlineId}`,
            responder_public_key_pem: state.signing.publicKeyPem,
            task_types: body.task_types || [],
            capabilities: body.capabilities || [],
            tags: body.tags || [],
            input_schema: body.input_schema || null,
            output_schema: body.output_schema || null,
            contact_email: body.contact_email || null,
            support_email: body.support_email || null
          });

          state.identity.responder_id = registered.responder_id;
          state.identity.hotline_ids = Array.from(new Set([...(state.identity.hotline_ids || []), registered.hotline_id]));
          if (platform) {
            platform.apiKey = registered.api_key || platform.apiKey;
            platform.responderId = registered.responder_id;
          }
          await persistResponderState(onStateChanged, state);
          if (typeof onPlatformConfigured === "function") {
            await onPlatformConfigured({
              platform,
              state,
              registered
            });
          }
          sendJson(res, 201, registered);
        } catch (error) {
          if (error instanceof Error && error.message === "responder_platform_base_url_required") {
            sendError(res, 409, "PLATFORM_NOT_CONFIGURED", "platform base URL is not configured");
            return;
          }
          if (error?.response) {
            sendJson(res, error.response.status, error.response.body || { error: { code: "RESPONDER_PLATFORM_REGISTER_FAILED", message: "registration rejected by platform", retryable: false } });
            return;
          }
          sendError(res, 502, "RESPONDER_PLATFORM_REGISTER_FAILED", error instanceof Error ? error.message : "unknown_error", { retryable: true });
        }
        return;
      }

      if (method === "POST" && pathname === "/controller/tasks") {
        const body = await parseJsonBody(req);
        const task = createTaskRecord(body, state);

        const existing = getTaskByRequestId(state, task.request_id);
        if (existing) {
          sendJson(res, existing.result_package ? 200 : 202, {
            accepted: !existing.result_package,
            deduped: true,
            replayed: Boolean(existing.result_package),
            task_id: existing.task_id,
            request_id: existing.request_id,
            status: existing.status,
            result_package: existing.result_package || null
          });
          return;
        }

        await enqueueTask(state, task, { executor, transport, platform, onStateChanged, workerConcurrency });

        sendJson(res, 202, {
          accepted: true,
          task_id: task.task_id,
          request_id: task.request_id,
          status: task.status,
          queue_policy: {
            mode: "priority_fifo",
            lease_ttl_s: task.lease_ttl_s,
            worker_concurrency: workerConcurrency
          }
        });
        return;
      }

      if (method === "POST" && pathname === "/controller/inbox/pull") {
        if (!transport) {
          sendError(res, 409, "TRANSPORT_NOT_CONFIGURED", "message transport is not configured");
          return;
        }

        const body = await parseJsonBody(req);
        const result = await processResponderInbox(state, {
          executor,
          transport,
          platform,
          guardrails,
          onStateChanged,
          receiver: body.receiver || state.identity.responder_id,
          limit: Number(body.limit || 10)
        });

        sendJson(res, 200, { accepted: result.accepted });
        return;
      }

      if (method === "GET" && pathname === "/controller/queue") {
        const queued = state.queue.map((taskId) => state.tasks.get(taskId)).filter(Boolean);
        const runningIds = new Set(state.activeTaskIds || []);
        const running = Array.from(state.tasks.values()).filter(
          (task) => task.status === "RUNNING" || runningIds.has(task.task_id)
        );
        sendJson(res, 200, { queued, running });
        return;
      }

      const taskMatch = pathname.match(/^\/controller\/tasks\/([^/]+)$/);
      if (method === "GET" && taskMatch) {
        const task = state.tasks.get(taskMatch[1]);
        if (!task) {
          sendError(res, 404, "TASK_NOT_FOUND", "task does not exist");
          return;
        }

        sendJson(res, 200, task);
        return;
      }

      const resultMatch = pathname.match(/^\/controller\/tasks\/([^/]+)\/result$/);
      if (method === "GET" && resultMatch) {
        const task = state.tasks.get(resultMatch[1]);
        if (!task) {
          sendError(res, 404, "TASK_NOT_FOUND", "task does not exist");
          return;
        }

        if (!task.result_package) {
          sendJson(res, 202, { available: false, status: task.status });
          return;
        }

        sendJson(res, 200, { available: true, status: task.status, result_package: task.result_package });
        return;
      }

      const replayMatch = pathname.match(/^\/controller\/tasks\/([^/]+)\/replay$/);
      if (method === "POST" && replayMatch) {
        const task = state.tasks.get(replayMatch[1]);
        if (!task) {
          sendError(res, 404, "TASK_NOT_FOUND", "task does not exist");
          return;
        }

        if (!task.result_package) {
          sendError(res, 409, "RESULT_NOT_READY", "task result is not yet available", { status: task.status });
          return;
        }

        sendJson(res, 200, { replayed: true, result_package: task.result_package });
        return;
      }

      sendError(res, 404, "not_found", "no matching route", { path: pathname });
    } catch (error) {
      if (error.message === "invalid_json") {
        sendError(res, 400, "CONTRACT_INVALID_JSON", "request body is not valid JSON");
        return;
      }

      sendError(res, 500, "RESPONDER_RUNTIME_INTERNAL_ERROR", error instanceof Error ? error.message : "unknown_error", { retryable: true });
    }
  });

  if (background.enabled === true) {
    const stopInboxLoop = startResponderInboxLoop({
      state,
      executor,
      transport,
      platform,
      guardrails,
      onStateChanged,
      intervalMs: Number(background.inboxPollIntervalMs || 250),
      receiver: background.receiver || state.identity.responder_id
    });
    server.on("close", () => {
      stopInboxLoop();
    });
  }

  return server;
}

export {
  createConfiguredHotlineExecutor,
  createExampleFunctionExecutor,
  createFunctionExecutor,
  createSimulatorExecutor,
  createHotlineRouterExecutor,
  deferTask
};
