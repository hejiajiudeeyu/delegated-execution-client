import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createCallerControllerServer } from "@delexec/caller-controller";
import { createCallerControllerServer as createCallerControllerCoreServer } from "@delexec/caller-controller-core";
import { canonicalizeResultPackageForSignature } from "@delexec/contracts";
import { createPlatformServer, createPlatformState } from "@delexec/platform-api";
import { createResponderControllerServer, createResponderState } from "@delexec/responder-controller";
import { createFunctionExecutor } from "@delexec/responder-runtime-core";
import { InMemoryEmailTransport } from "@delexec/transport-email";
import { createLocalTransportAdapter, createLocalTransportHub } from "@delexec/transport-local";
import { closeServer, jsonRequest, listenServer, waitFor } from "../helpers/http.js";

describe("caller-controller integration", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    server = createCallerControllerServer({
      serviceName: "caller-controller-test",
      config: {
        timeout_confirmation_mode: "ask_by_default",
        hard_timeout_auto_finalize: true,
        poll_interval_active_s: 1,
        poll_interval_backoff_s: 1
      }
    });
    baseUrl = await listenServer(server);
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("auto-finalizes hard timeout", async () => {
    const requestId = "req_caller_timeout_1";
    const created = await jsonRequest(baseUrl, "/controller/requests", {
      method: "POST",
      body: {
        request_id: requestId,
        soft_timeout_s: 1,
        hard_timeout_s: 1
      }
    });
    expect(created.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 1300));

    const queried = await jsonRequest(baseUrl, `/controller/requests/${requestId}`);
    expect(queried.status).toBe(200);
    expect(queried.body.status).toBe("TIMED_OUT");
  });

  it("accepts timeout decision to continue waiting", async () => {
    const requestId = "req_caller_continue_1";
    await jsonRequest(baseUrl, "/controller/requests", {
      method: "POST",
      body: {
        request_id: requestId,
        soft_timeout_s: 1,
        hard_timeout_s: 2
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const decision = await jsonRequest(baseUrl, `/controller/requests/${requestId}/timeout-decision`, {
      method: "POST",
      body: {
        continue_wait: true
      }
    });

    expect(decision.status).toBe(200);
    expect(decision.body.timeout_decision).toBe("continue_wait");
    expect(decision.body.status).not.toBe("TIMED_OUT");
  });

  it("times out sent requests that miss ack_deadline", async () => {
    const requestId = "req_caller_ack_deadline_1";
    const created = await jsonRequest(baseUrl, "/controller/requests", {
      method: "POST",
      body: {
        request_id: requestId,
        ack_deadline_s: 1,
        soft_timeout_s: 30,
        hard_timeout_s: 60
      }
    });
    expect(created.status).toBe(201);

    const marked = await jsonRequest(baseUrl, `/controller/requests/${requestId}/mark-sent`, {
      method: "POST"
    });
    expect(marked.status).toBe(200);
    expect(marked.body.status).toBe("SENT");
    expect(marked.body.ack_deadline_at).toBeTypeOf("string");

    await new Promise((resolve) => setTimeout(resolve, 1300));

    const queried = await jsonRequest(baseUrl, `/controller/requests/${requestId}`);
    expect(queried.status).toBe(200);
    expect(queried.body.status).toBe("TIMED_OUT");
    expect(queried.body.last_error_code).toBe("DELIVERY_OR_ACCEPTANCE_TIMEOUT");
  });

  it("rejects second result write after terminal state", async () => {
    const requestId = "req_caller_terminal_1";
    await jsonRequest(baseUrl, "/controller/requests", {
      method: "POST",
      body: {
        request_id: requestId,
        soft_timeout_s: 5,
        hard_timeout_s: 20
      }
    });

    const first = await jsonRequest(baseUrl, `/controller/requests/${requestId}/result`, {
      method: "POST",
      body: {
        request_id: requestId,
        status: "ok",
        output: { summary: "done" },
        schema_valid: true
      }
    });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("SUCCEEDED");

    const second = await jsonRequest(baseUrl, `/controller/requests/${requestId}/result`, {
      method: "POST",
      body: {
        request_id: requestId,
        status: "ok",
        output: { summary: "second" },
        schema_valid: true
      }
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("REQUEST_ALREADY_TERMINAL");
  });

  it("supports timeout decision to stop waiting", async () => {
    const requestId = "req_caller_stop_1";
    await jsonRequest(baseUrl, "/controller/requests", {
      method: "POST",
      body: {
        request_id: requestId,
        soft_timeout_s: 30,
        hard_timeout_s: 60
      }
    });

    const decision = await jsonRequest(baseUrl, `/controller/requests/${requestId}/timeout-decision`, {
      method: "POST",
      body: {
        continue_wait: false
      }
    });

    expect(decision.status).toBe(200);
    expect(decision.body.status).toBe("TIMED_OUT");
    expect(decision.body.last_error_code).toBe("EXEC_TIMEOUT_MANUAL_STOP");
  });

  it("pulls result packages from transport inbox", async () => {
    const hub = createLocalTransportHub();
    const transport = createLocalTransportAdapter({ hub, receiver: "caller-controller" });
    const inboxServer = createCallerControllerServer({
      serviceName: "caller-controller-inbox-test",
      transport
    });
    const inboxUrl = await listenServer(inboxServer);

    try {
      const requestId = "req_caller_inbox_1";
      await jsonRequest(inboxUrl, "/controller/requests", {
        method: "POST",
        body: {
          request_id: requestId,
          expected_signer_public_key_pem: null
        }
      });

      await transport.send({
        message_id: "msg_result_1",
        to: "caller-controller",
        result_package: {
          request_id: requestId,
          status: "error",
          error: { code: "EXEC_INTERNAL_ERROR", message: "boom" },
          schema_valid: true
        }
      });

      const pulled = await jsonRequest(inboxUrl, "/controller/inbox/pull", {
        method: "POST",
        body: {}
      });
      expect(pulled.status).toBe(200);
      expect(pulled.body.accepted).toEqual([{ message_id: "msg_result_1", request_id: requestId }]);

      const final = await jsonRequest(inboxUrl, `/controller/requests/${requestId}`);
      expect(final.body.status).toBe("FAILED");
      expect(final.body.last_error_code).toBe("EXEC_INTERNAL_ERROR");
    } finally {
      await closeServer(inboxServer);
    }
  });

  it("supports direct core import for embedded dispatch", async () => {
    const hub = createLocalTransportHub();
    const callerTransport = createLocalTransportAdapter({ hub, receiver: "caller-controller" });
    const responderTransport = createLocalTransportAdapter({ hub, receiver: "responder_embed" });
    const coreServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-core-test",
      transport: callerTransport
    });
    const coreUrl = await listenServer(coreServer);

    try {
      const requestId = "req_caller_core_dispatch_1";
      const created = await jsonRequest(coreUrl, "/controller/requests", {
        method: "POST",
        body: {
          request_id: requestId,
          responder_id: "responder_embed",
          hotline_id: "embed.runtime.v1"
        }
      });
      expect(created.status).toBe(201);

      const dispatched = await jsonRequest(coreUrl, `/controller/requests/${requestId}/dispatch`, {
        method: "POST",
        body: {
          task_token: "task_token_embed_1",
          payload: { prompt: "hello-embedded-caller" },
          priority: 2,
          delay_ms: 15
        }
      });
      expect(dispatched.status).toBe(202);

      const queue = await responderTransport.peek();
      expect(queue.items).toHaveLength(1);
      expect(queue.items[0]).toMatchObject({
        request_id: requestId,
        responder_id: "responder_embed",
        hotline_id: "embed.runtime.v1",
        task_token: "task_token_embed_1",
        payload: { prompt: "hello-embedded-caller" },
        priority: 2,
        delay_ms: 15
      });
    } finally {
      await closeServer(coreServer);
    }
  });

  it("returns stable result reads for terminal requests", async () => {
    const requestId = "req_caller_result_read_1";
    await jsonRequest(baseUrl, "/controller/requests", {
      method: "POST",
      body: {
        request_id: requestId,
        soft_timeout_s: 5,
        hard_timeout_s: 20
      }
    });

    const before = await jsonRequest(baseUrl, `/controller/requests/${requestId}/result`);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({
      available: false,
      status: "CREATED",
      result_package: null
    });

    await jsonRequest(baseUrl, `/controller/requests/${requestId}/result`, {
      method: "POST",
      body: {
        request_id: requestId,
        status: "ok",
        output: { summary: "done" },
        schema_valid: true
      }
    });

    const after = await jsonRequest(baseUrl, `/controller/requests/${requestId}/result`);
    expect(after.status).toBe(200);
    expect(after.body.available).toBe(true);
    expect(after.body.status).toBe("SUCCEEDED");
    expect(after.body.result_package.output).toEqual({ summary: "done" });
  });

  it("builds task contract drafts from prepared requests", async () => {
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-caller-contract-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const bootstrapResponder = platformState.bootstrap.responders[0];

    const registered = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-contract@test.local" }
    });
    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-contract-test",
      platform: {
        baseUrl: platformUrl,
        apiKey: registered.body.api_key
      }
    });
    const callerUrl = await listenServer(callerServer);

    try {
      const requestId = "req_caller_contract_1";
      const created = await jsonRequest(callerUrl, "/controller/requests", {
        method: "POST",
        body: {
          request_id: requestId,
          caller_id: "caller_contract",
          responder_id: bootstrapResponder.responder_id,
          hotline_id: bootstrapResponder.hotline_id,
          soft_timeout_s: 90,
          hard_timeout_s: 300
        }
      });
      expect(created.status).toBe(201);

      const prepared = await jsonRequest(callerUrl, `/controller/requests/${requestId}/prepare`, {
        method: "POST",
        body: {}
      });
      expect(prepared.status).toBe(200);

      const drafted = await jsonRequest(callerUrl, `/controller/requests/${requestId}/contract-draft`, {
        method: "POST",
        body: {
          task_type: "text_classification",
          input: {
            text: "The package arrived damaged and I want a full refund."
          },
          output_schema: {
            type: "object",
            required: ["label", "confidence"],
            properties: {
              label: { type: "string" },
              confidence: { type: "number" }
            }
          },
          result_delivery: {
            kind: "local",
            address: "caller-controller"
          },
          source_run_id: "run_caller_contract_001"
        }
      });
      expect(drafted.status).toBe(200);
      expect(drafted.body.contract).toMatchObject({
        request_id: requestId,
        contract_version: "0.1.0",
        caller: {
          caller_id: "caller_contract",
          result_delivery: {
            kind: "local",
            address: "caller-controller"
          }
        },
        responder: {
          responder_id: bootstrapResponder.responder_id,
          hotline_id: bootstrapResponder.hotline_id
        },
        task: {
          task_type: "text_classification",
          input: {
            text: "The package arrived damaged and I want a full refund."
          }
        },
        constraints: {
          soft_timeout_s: 90,
          hard_timeout_s: 300
        },
        token: prepared.body.task_token
      });
      expect(drafted.body.contract.trace.thread_hint).toBe(prepared.body.delivery_meta.task_delivery.thread_hint);
      expect(drafted.body.contract.trace.source_run_id).toBe("run_caller_contract_001");
    } finally {
      await closeServer(callerServer);
      await closeServer(platformServer);
    }
  });

  it("reports caller metrics for dispatch, ack, and result", async () => {
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-caller-metrics-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const registered = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-metrics@test.local" }
    });
    const responder = platformState.bootstrap.responders[0];
    const hub = createLocalTransportHub();
    const callerTransport = createLocalTransportAdapter({ hub, receiver: "caller-controller" });
    const responderTransport = createLocalTransportAdapter({ hub, receiver: responder.responder_id });
    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-metrics-test",
      transport: callerTransport,
      platform: {
        baseUrl: platformUrl,
        apiKey: registered.body.api_key
      }
    });
    const responderServer = createResponderControllerServer({
      serviceName: "responder-controller-caller-metrics-test",
      transport: responderTransport,
      platform: {
        baseUrl: platformUrl,
        apiKey: responder.api_key,
        responderId: responder.responder_id
      },
      state: createResponderState({
        responderId: responder.responder_id,
        hotlineIds: [responder.hotline_id],
        signing: responder.signing
      })
    });
    const callerUrl = await listenServer(callerServer);
    const responderUrl = await listenServer(responderServer);

    try {
      const requestId = "req_caller_metrics_1";
      await jsonRequest(callerUrl, "/controller/requests", {
        method: "POST",
        body: {
          request_id: requestId,
          caller_id: "caller_metrics",
          responder_id: responder.responder_id,
          hotline_id: responder.hotline_id
        }
      });

      await jsonRequest(callerUrl, `/controller/requests/${requestId}/prepare`, {
        method: "POST",
        body: {}
      });
      await jsonRequest(callerUrl, `/controller/requests/${requestId}/dispatch`, {
        method: "POST",
        body: {
          payload: { prompt: "metrics-test" },
          delay_ms: 20
        }
      });

      await jsonRequest(responderUrl, "/controller/inbox/pull", {
        method: "POST",
        body: {}
      });
      await waitFor(async () => {
        const queue = await callerTransport.peek();
        if (queue.items.length === 0) {
          throw new Error("caller_metrics_result_not_ready");
        }
        return queue;
      });
      await jsonRequest(callerUrl, `/controller/requests/${requestId}/sync-events`, {
        method: "POST"
      });
      await jsonRequest(callerUrl, "/controller/inbox/pull", {
        method: "POST",
        body: {}
      });

      const metrics = await jsonRequest(platformUrl, "/v1/metrics/summary", {
        headers: {
          Authorization: `Bearer ${registered.body.api_key}`
        }
      });
      expect(metrics.status).toBe(200);
      expect(metrics.body.by_type["caller.request.dispatched"]).toBeGreaterThanOrEqual(1);
      expect(metrics.body.by_type["caller.request.acked"]).toBeGreaterThanOrEqual(1);
      expect(metrics.body.by_type["caller.request.succeeded"]).toBeGreaterThanOrEqual(1);
    } finally {
      await closeServer(callerServer);
      await closeServer(responderServer);
      await closeServer(platformServer);
    }
  });

  it("captures platform COMPLETED observation without overriding final result source", async () => {
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-caller-platform-observation-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const registered = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-platform-observation@test.local" }
    });
    const responder = platformState.bootstrap.responders[0];
    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-platform-observation-test",
      platform: {
        baseUrl: platformUrl,
        apiKey: registered.body.api_key
      }
    });
    const callerUrl = await listenServer(callerServer);

    try {
      const requestId = "req_caller_platform_observation_1";
      const created = await jsonRequest(callerUrl, "/controller/requests", {
        method: "POST",
        body: {
          request_id: requestId,
          responder_id: responder.responder_id,
          hotline_id: responder.hotline_id
        }
      });
      expect(created.status).toBe(201);

      const prepared = await jsonRequest(callerUrl, `/controller/requests/${requestId}/prepare`, {
        method: "POST",
        body: {}
      });
      expect(prepared.status).toBe(200);

      const responderEvent = await jsonRequest(platformUrl, `/v1/requests/${requestId}/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${responder.api_key}`
        },
        body: {
          responder_id: responder.responder_id,
          hotline_id: responder.hotline_id,
          event_type: "COMPLETED",
          status: "ok",
          finished_at: "2026-03-11T10:00:00Z"
        }
      });
      expect(responderEvent.status).toBe(202);

      const synced = await jsonRequest(callerUrl, `/controller/requests/${requestId}/sync-events`, {
        method: "POST"
      });
      expect(synced.status).toBe(200);

      const current = await jsonRequest(callerUrl, `/controller/requests/${requestId}`);
      expect(current.status).toBe(200);
      expect(current.body.platform_completed_at).toBe("2026-03-11T10:00:00Z");
      expect(current.body.platform_failed_at).toBe(null);
      expect(current.body.platform_last_event.event_type).toBe("COMPLETED");
      expect(current.body.status).toBe("CREATED");

      const final = await jsonRequest(callerUrl, `/controller/requests/${requestId}/result`, {
        method: "POST",
        body: {
          request_id: requestId,
          result_version: "0.1.0",
          responder_id: responder.responder_id,
          hotline_id: responder.hotline_id,
          status: "ok",
          output: { summary: "done" },
          schema_valid: true,
          verification: prepared.body.delivery_meta.verification
        }
      });
      expect(final.status).toBe(200);
      expect(final.body.status).toBe("SUCCEEDED");
    } finally {
      await closeServer(callerServer);
      await closeServer(platformServer);
    }
  });

  it("orchestrates catalog, prepare, dispatch, and ACK sync through platform", async () => {
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-caller-orch-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const hub = createLocalTransportHub();
    const bootstrapResponder = platformState.bootstrap.responders[0];
    const callerTransport = createLocalTransportAdapter({ hub, receiver: "caller-controller" });
    const responderTransport = createLocalTransportAdapter({ hub, receiver: bootstrapResponder.responder_id });
    const responderServer = createResponderControllerServer({
      serviceName: "responder-controller-caller-orch-test",
      transport: responderTransport,
      platform: {
        baseUrl: platformUrl,
        apiKey: bootstrapResponder.api_key,
        responderId: bootstrapResponder.responder_id
      },
      state: createResponderState({
        responderId: bootstrapResponder.responder_id,
        hotlineIds: [bootstrapResponder.hotline_id],
        signing: bootstrapResponder.signing
      })
    });
    const responderUrl = await listenServer(responderServer);

    const registered = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-orch@test.local" }
    });
    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-orch-test",
      transport: callerTransport,
      platform: {
        baseUrl: platformUrl,
        apiKey: registered.body.api_key
      },
      config: {
        timeout_confirmation_mode: "ask_by_default",
        hard_timeout_auto_finalize: true,
        poll_interval_active_s: 1,
        poll_interval_backoff_s: 1
      }
    });
    const callerUrl = await listenServer(callerServer);

    try {
      const catalog = await jsonRequest(callerUrl, "/controller/hotlines?status=enabled");
      expect(catalog.status).toBe(200);
      expect(catalog.body.items.length).toBeGreaterThan(0);
      const selected = catalog.body.items[0];

      const requestId = "req_caller_orchestrated_1";
      const created = await jsonRequest(callerUrl, "/controller/requests", {
        method: "POST",
        body: {
          request_id: requestId,
          soft_timeout_s: 5,
          hard_timeout_s: 10
        }
      });
      expect(created.status).toBe(201);

      const prepared = await jsonRequest(callerUrl, `/controller/requests/${requestId}/prepare`, {
        method: "POST",
        body: {
          responder_id: selected.responder_id,
          hotline_id: selected.hotline_id
        }
      });
      expect(prepared.status).toBe(200);
      expect(prepared.body.task_token).toBeTypeOf("string");
      expect(prepared.body.delivery_meta.task_delivery.address).toBeTypeOf("string");
      expect(prepared.body.delivery_meta.task_delivery.address.startsWith("local://")).toBe(true);
      expect(prepared.body.delivery_meta.result_delivery).toEqual({ kind: "local", address: "caller-controller", thread_hint: `req:${requestId}` });
      expect(prepared.body.request.expected_signer_public_key_pem).toBe(selected.responder_public_key_pem);

      const dispatched = await jsonRequest(callerUrl, `/controller/requests/${requestId}/dispatch`, {
        method: "POST",
        body: {
          simulate: "success",
          delay_ms: 20
        }
      });
      expect(dispatched.status).toBe(202);
      expect(dispatched.body.envelope.to).toBe(prepared.body.delivery_meta.task_delivery.address);

      const responderQueue = await responderTransport.peek();
      expect(responderQueue.items).toHaveLength(1);
      expect(responderQueue.items[0].to).toBe(prepared.body.delivery_meta.task_delivery.address);

      const pulled = await jsonRequest(responderUrl, "/controller/inbox/pull", {
        method: "POST",
        body: {}
      });
      expect(pulled.status).toBe(200);
      expect(pulled.body.accepted).toHaveLength(1);

      const synced = await waitFor(async () => {
        const polled = await jsonRequest(callerUrl, `/controller/requests/${requestId}/sync-events`, {
          method: "POST",
          body: {}
        });
        if (polled.body.acked !== true) {
          throw new Error("ack_not_synced");
        }
        return polled;
      });
      expect(synced.status).toBe(200);
      expect(synced.body.request.status).toBe("ACKED");

      const inbox = await waitFor(async () => {
        const polled = await jsonRequest(callerUrl, "/controller/inbox/pull", {
          method: "POST",
          body: {}
        });
        if (polled.body.accepted.length !== 1) {
          throw new Error("caller_result_not_ready");
        }
        return polled;
      });
      expect(inbox.body.accepted[0].request_id).toBe(requestId);

      const final = await jsonRequest(callerUrl, `/controller/requests/${requestId}`);
      expect(final.status).toBe(200);
      expect(final.body.status).toBe("SUCCEEDED");
    } finally {
      await closeServer(callerServer);
      await closeServer(responderServer);
      await closeServer(platformServer);
    }
  });

  it("filters controller catalog by capability through platform", async () => {
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-caller-capability-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const registered = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-capability@test.local" }
    });

    const responderRegistration = await jsonRequest(platformUrl, "/v2/responders/register", {
      method: "POST",
      body: {
        responder_id: "responder_legalworks",
        hotline_id: "legalworks.contract.extractor.v1",
        display_name: "LegalWorks Contract Extractor",
        responder_public_key_pem: platformState.bootstrap.responders[0].signing.publicKeyPem,
        capabilities: ["contract.extract"],
        task_types: ["contract_extract"],
        tags: ["legal"]
      }
    });
    expect(responderRegistration.status).toBe(201);
    expect(responderRegistration.body.review_status).toBe("pending");

    const approved = await jsonRequest(platformUrl, "/v2/admin/hotlines/legalworks.contract.extractor.v1/approve", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${platformState.adminApiKey}`
      },
      body: { reason: "ready for discovery" }
    });
    expect(approved.status).toBe(200);

    const approveResponder = await jsonRequest(platformUrl, "/v2/admin/responders/responder_legalworks/approve", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${platformState.adminApiKey}`
      },
      body: { reason: "responder ready for discovery" }
    });
    expect(approveResponder.status).toBe(200);

    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-capability-test",
      platform: {
        baseUrl: platformUrl,
        apiKey: registered.body.api_key
      }
    });
    const callerUrl = await listenServer(callerServer);

    try {
      const catalog = await jsonRequest(callerUrl, "/controller/hotlines?capability=contract.extract");
      expect(catalog.status).toBe(200);
      expect(catalog.body.items).toHaveLength(1);
      expect(catalog.body.items[0].hotline_id).toBe("legalworks.contract.extractor.v1");
    } finally {
      await closeServer(callerServer);
      await closeServer(platformServer);
    }
  });

  it("parses signed result JSON from email body and validates attachments", async () => {
    const platformState = createPlatformState();
    const bootstrap = platformState.bootstrap.responders[0];
    const catalogItem = platformState.catalog.get(bootstrap.hotline_id);
    catalogItem.task_delivery_address = "responder@example.com";

    const platformServer = createPlatformServer({ serviceName: "platform-caller-email-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const emailTransport = new InMemoryEmailTransport({ minDelayMs: 0, maxDelayMs: 1 });
    const caller = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-email@test.local" }
    });

    const responderServer = createResponderControllerServer({
      serviceName: "responder-controller-email-test",
      transport: emailTransport,
      platform: {
        baseUrl: platformUrl,
        apiKey: bootstrap.api_key,
        responderId: bootstrap.responder_id
      },
      state: createResponderState({
        responderId: bootstrap.responder_id,
        hotlineIds: [bootstrap.hotline_id],
        signing: bootstrap.signing
      }),
      executor: createFunctionExecutor(async () => ({
        status: "ok",
        output: { summary: "email-ok" },
        artifacts: [
          {
            name: "report.txt",
            media_type: "text/plain",
            content: "hello from attachment"
          }
        ]
      }))
    });
    const responderUrl = await listenServer(responderServer);

    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-email-test",
      transport: emailTransport,
      platform: {
        baseUrl: platformUrl,
        apiKey: caller.body.api_key
      }
    });
    const callerUrl = await listenServer(callerServer);

    try {
      const requestId = "req_caller_email_1";
      const created = await jsonRequest(callerUrl, "/controller/requests", {
        method: "POST",
        body: {
          request_id: requestId,
          responder_id: bootstrap.responder_id,
          hotline_id: bootstrap.hotline_id,
          result_delivery: {
            kind: "email",
            address: "caller@example.com"
          }
        }
      });
      expect(created.status).toBe(201);

      const prepared = await jsonRequest(callerUrl, `/controller/requests/${requestId}/prepare`, {
        method: "POST",
        body: {
          responder_id: bootstrap.responder_id,
          hotline_id: bootstrap.hotline_id
        }
      });
      expect(prepared.status).toBe(200);
      expect(prepared.body.delivery_meta.task_delivery.address).toBe("responder@example.com");
      expect(prepared.body.delivery_meta.result_delivery.address).toBe("caller@example.com");
      expect(prepared.body.delivery_meta.verification.display_code).toBeTypeOf("string");

      const dispatched = await jsonRequest(callerUrl, `/controller/requests/${requestId}/dispatch`, {
        method: "POST",
        body: {
          simulate: "success",
          delay_ms: 10
        }
      });
      expect(dispatched.status).toBe(202);

      const responderPulled = await jsonRequest(responderUrl, "/controller/inbox/pull", {
        method: "POST",
        body: {
          receiver: "responder@example.com"
        }
      });
      expect(responderPulled.status).toBe(200);
      expect(responderPulled.body.accepted).toHaveLength(1);

      const callerInbox = await waitFor(async () => {
        const polled = await jsonRequest(callerUrl, "/controller/inbox/pull", {
          method: "POST",
          body: {
            receiver: "caller@example.com"
          }
        });
        if (polled.body.accepted.length !== 1) {
          throw new Error("caller_email_result_not_ready");
        }
        return polled;
      });
      expect(callerInbox.status).toBe(200);

      const final = await jsonRequest(callerUrl, `/controller/requests/${requestId}`);
      expect(final.status).toBe(200);
      expect(final.body.status).toBe("SUCCEEDED");
      expect(final.body.result_package.output.summary).toBe("email-ok");
      expect(final.body.result_package.verification.display_code).toBe(prepared.body.delivery_meta.verification.display_code);
      expect(final.body.result_package.artifacts).toHaveLength(1);
      expect(final.body.result_package.artifacts[0]).toMatchObject({
        name: "report.txt",
        media_type: "text/plain",
        delivery: {
          kind: "email_attachment"
        }
      });
    } finally {
      await closeServer(callerServer);
      await closeServer(responderServer);
      await closeServer(platformServer);
    }
  });

  it("marks email result as UNVERIFIED when display_code mismatches", async () => {
    const platformState = createPlatformState();
    const bootstrap = platformState.bootstrap.responders[0];
    const catalogItem = platformState.catalog.get(bootstrap.hotline_id);
    catalogItem.task_delivery_address = "responder@example.com";

    const platformServer = createPlatformServer({ serviceName: "platform-caller-email-code-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const emailTransport = new InMemoryEmailTransport({ minDelayMs: 0, maxDelayMs: 1 });
    const caller = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-email-code@test.local" }
    });
    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-email-code-test",
      transport: emailTransport,
      platform: {
        baseUrl: platformUrl,
        apiKey: caller.body.api_key
      }
    });
    const callerUrl = await listenServer(callerServer);

    try {
      const requestId = "req_caller_email_bad_code_1";
      await jsonRequest(callerUrl, "/controller/requests", {
        method: "POST",
        body: {
          request_id: requestId,
          responder_id: bootstrap.responder_id,
          hotline_id: bootstrap.hotline_id,
          result_delivery: {
            kind: "email",
            address: "caller@example.com"
          }
        }
      });

      const prepared = await jsonRequest(callerUrl, `/controller/requests/${requestId}/prepare`, {
        method: "POST",
        body: {
          responder_id: bootstrap.responder_id,
          hotline_id: bootstrap.hotline_id
        }
      });
      expect(prepared.status).toBe(200);

      const wrongPayload = {
        message_type: "remote_hotline_result",
        request_id: requestId,
        result_version: "0.1.0",
        responder_id: bootstrap.responder_id,
        hotline_id: bootstrap.hotline_id,
        verification: {
          display_code: "WRONGCODE"
        },
        status: "ok",
        output: {
          summary: "bad-code"
        },
        artifacts: [],
        timing: {
          accepted_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          elapsed_ms: 1
        },
        usage: {
          tokens_in: 1,
          tokens_out: 1
        }
      };
      const signer = createResponderState({
        responderId: bootstrap.responder_id,
        hotlineIds: [bootstrap.hotline_id],
        signing: bootstrap.signing
      });
      const bytes = Buffer.from(JSON.stringify(canonicalizeResultPackageForSignature(wrongPayload)), "utf8");
      wrongPayload.signature_algorithm = "Ed25519";
      wrongPayload.signature_base64 = crypto.sign(null, bytes, signer.signing.privateKey).toString("base64");

      await emailTransport.send({
        request_id: requestId,
        thread_id: `req:${requestId}`,
        from: "responder@example.com",
        to: "caller@example.com",
        type: "task.result",
        body_text: JSON.stringify(wrongPayload)
      });

      const inbox = await jsonRequest(callerUrl, "/controller/inbox/pull", {
        method: "POST",
        body: {
          receiver: "caller@example.com"
        }
      });
      expect(inbox.status).toBe(200);
      expect(inbox.body.accepted).toHaveLength(1);

      const final = await jsonRequest(callerUrl, `/controller/requests/${requestId}`);
      expect(final.body.status).toBe("UNVERIFIED");
      expect(final.body.last_error_code).toBe("RESULT_CONTEXT_MISMATCH");
    } finally {
      await closeServer(callerServer);
      await closeServer(platformServer);
    }
  });

  it("marks email result as UNVERIFIED when attachment hash mismatches", async () => {
    const platformState = createPlatformState();
    const bootstrap = platformState.bootstrap.responders[0];
    const catalogItem = platformState.catalog.get(bootstrap.hotline_id);
    catalogItem.task_delivery_address = "responder@example.com";

    const platformServer = createPlatformServer({ serviceName: "platform-caller-email-artifact-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const emailTransport = new InMemoryEmailTransport({ minDelayMs: 0, maxDelayMs: 1 });
    const caller = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-email-artifact@test.local" }
    });
    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-email-artifact-test",
      transport: emailTransport,
      platform: {
        baseUrl: platformUrl,
        apiKey: caller.body.api_key
      }
    });
    const callerUrl = await listenServer(callerServer);

    try {
      const requestId = "req_caller_email_bad_artifact_1";
      await jsonRequest(callerUrl, "/controller/requests", {
        method: "POST",
        body: {
          request_id: requestId,
          responder_id: bootstrap.responder_id,
          hotline_id: bootstrap.hotline_id,
          result_delivery: {
            kind: "email",
            address: "caller@example.com"
          }
        }
      });

      const prepared = await jsonRequest(callerUrl, `/controller/requests/${requestId}/prepare`, {
        method: "POST",
        body: {
          responder_id: bootstrap.responder_id,
          hotline_id: bootstrap.hotline_id
        }
      });
      expect(prepared.status).toBe(200);

      const signer = createResponderState({
        responderId: bootstrap.responder_id,
        hotlineIds: [bootstrap.hotline_id],
        signing: bootstrap.signing
      });
      const goodContent = Buffer.from("hello artifact", "utf8");
      const payload = {
        message_type: "remote_hotline_result",
        request_id: requestId,
        result_version: "0.1.0",
        responder_id: bootstrap.responder_id,
        hotline_id: bootstrap.hotline_id,
        verification: {
          display_code: prepared.body.delivery_meta.verification.display_code
        },
        status: "ok",
        output: {
          summary: "artifact-bad"
        },
        artifacts: [
          {
            artifact_id: "art_1",
            name: "report.txt",
            media_type: "text/plain",
            byte_size: goodContent.length,
            sha256: crypto.createHash("sha256").update(goodContent).digest("hex"),
            delivery: {
              kind: "email_attachment"
            }
          }
        ],
        timing: {
          accepted_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          elapsed_ms: 1
        },
        usage: {
          tokens_in: 1,
          tokens_out: 1
        }
      };
      const bytes = Buffer.from(JSON.stringify(canonicalizeResultPackageForSignature(payload)), "utf8");
      payload.signature_algorithm = "Ed25519";
      payload.signature_base64 = crypto.sign(null, bytes, signer.signing.privateKey).toString("base64");

      await emailTransport.send({
        request_id: requestId,
        thread_id: `req:${requestId}`,
        from: "responder@example.com",
        to: "caller@example.com",
        type: "task.result",
        body_text: JSON.stringify(payload),
        attachments: [
          {
            name: "report.txt",
            media_type: "text/plain",
            content: "tampered artifact"
          }
        ]
      });

      const inbox = await jsonRequest(callerUrl, "/controller/inbox/pull", {
        method: "POST",
        body: {
          receiver: "caller@example.com"
        }
      });
      expect(inbox.status).toBe(200);
      expect(inbox.body.accepted).toHaveLength(1);

      const final = await jsonRequest(callerUrl, `/controller/requests/${requestId}`);
      expect(final.body.status).toBe("UNVERIFIED");
      expect(final.body.last_error_code).toBe("RESULT_ARTIFACT_INVALID");
    } finally {
      await closeServer(callerServer);
      await closeServer(platformServer);
    }
  });

  it("marks malformed email body as UNVERIFIED", async () => {
    const platformState = createPlatformState();
    const bootstrap = platformState.bootstrap.responders[0];
    const catalogItem = platformState.catalog.get(bootstrap.hotline_id);
    catalogItem.task_delivery_address = "responder@example.com";

    const platformServer = createPlatformServer({ serviceName: "platform-caller-email-json-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const emailTransport = new InMemoryEmailTransport({ minDelayMs: 0, maxDelayMs: 1 });
    const caller = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-email-json@test.local" }
    });
    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-email-json-test",
      transport: emailTransport,
      platform: {
        baseUrl: platformUrl,
        apiKey: caller.body.api_key
      }
    });
    const callerUrl = await listenServer(callerServer);

    try {
      const requestId = "req_caller_email_bad_json_1";
      await jsonRequest(callerUrl, "/controller/requests", {
        method: "POST",
        body: {
          request_id: requestId,
          responder_id: bootstrap.responder_id,
          hotline_id: bootstrap.hotline_id,
          result_delivery: {
            kind: "email",
            address: "caller@example.com"
          }
        }
      });
      await jsonRequest(callerUrl, `/controller/requests/${requestId}/prepare`, {
        method: "POST",
        body: {
          responder_id: bootstrap.responder_id,
          hotline_id: bootstrap.hotline_id
        }
      });

      await emailTransport.send({
        request_id: requestId,
        thread_id: `req:${requestId}`,
        from: "responder@example.com",
        to: "caller@example.com",
        type: "task.result",
        body_text: "{not-json"
      });

      const inbox = await jsonRequest(callerUrl, "/controller/inbox/pull", {
        method: "POST",
        body: {
          receiver: "caller@example.com"
        }
      });
      expect(inbox.status).toBe(200);
      expect(inbox.body.accepted).toHaveLength(1);

      const final = await jsonRequest(callerUrl, `/controller/requests/${requestId}`);
      expect(final.body.status).toBe("UNVERIFIED");
      expect(final.body.last_error_code).toBe("RESULT_BODY_INVALID_JSON");
    } finally {
      await closeServer(callerServer);
      await closeServer(platformServer);
    }
  });

  it("registers responder identities through caller-controller using the caller api key", async () => {
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-caller-responder-register-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const caller = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-responder-register@test.local" }
    });
    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-responder-register-test",
      platform: {
        baseUrl: platformUrl
      }
    });
    const callerUrl = await listenServer(callerServer);

    try {
      const registered = await jsonRequest(callerUrl, "/controller/responder/register", {
        method: "POST",
        headers: {
          "X-Platform-Api-Key": caller.body.api_key
        },
        body: {
          responder_id: "responder_from_caller",
          hotline_id: "caller.enabled.v1",
          display_name: "Caller Enabled Responder",
          responder_public_key_pem: platformState.bootstrap.responders[0].signing.publicKeyPem,
          capabilities: ["text.classify"]
        }
      });
      expect(registered.status).toBe(201);
      expect(registered.body.owner_user_id).toBe(caller.body.user_id);
      expect(platformState.users.get(caller.body.user_id).roles).toEqual(["caller", "responder"]);
      expect(registered.body.review_status).toBe("pending");
    } finally {
      await closeServer(callerServer);
      await closeServer(platformServer);
    }
  });

  it("marks mismatched result context as UNVERIFIED", async () => {
    const requestId = "req_caller_context_1";
    await jsonRequest(baseUrl, "/controller/requests", {
      method: "POST",
      body: {
        request_id: requestId,
        responder_id: "responder_foxlab",
        hotline_id: "foxlab.text.classifier.v1",
        soft_timeout_s: 5,
        hard_timeout_s: 20
      }
    });

    const result = await jsonRequest(baseUrl, `/controller/requests/${requestId}/result`, {
      method: "POST",
      body: {
        request_id: requestId,
        result_version: "0.1.0",
        responder_id: "responder_northwind",
        hotline_id: "northwind.copywriter.v1",
        status: "ok",
        output: { summary: "wrong-responder" },
        schema_valid: true
      }
    });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("UNVERIFIED");
    expect(result.body.last_error_code).toBe("RESULT_CONTEXT_MISMATCH");
  });

  it("uses batched platform event sync for active background requests", async () => {
    const platformState = createPlatformState();
    const platformServer = createPlatformServer({ serviceName: "platform-caller-batch-sync-test", state: platformState });
    const platformUrl = await listenServer(platformServer);
    const caller = await jsonRequest(platformUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: "caller-batch-sync@test.local" }
    });
    const responder = platformState.bootstrap.responders[0];
    const originalFetch = global.fetch;
    let batchCalls = 0;

    global.fetch = vi.fn(async (input, init) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(target);
      if (url.origin === new URL(platformUrl).origin && url.pathname === "/v1/requests/events/batch") {
        batchCalls += 1;
      }
      return originalFetch(input, init);
    });

    const callerServer = createCallerControllerCoreServer({
      serviceName: "caller-controller-batch-sync-test",
      platform: {
        baseUrl: platformUrl,
        apiKey: caller.body.api_key
      },
      background: {
        enabled: true,
        eventsSyncIntervalMs: 25
      }
    });
    const callerUrl = await listenServer(callerServer);

    try {
      for (const requestId of ["req_caller_batch_sync_1", "req_caller_batch_sync_2"]) {
        const created = await jsonRequest(callerUrl, "/controller/requests", {
          method: "POST",
          body: {
            request_id: requestId,
            responder_id: responder.responder_id,
            hotline_id: responder.hotline_id,
            soft_timeout_s: 20,
            hard_timeout_s: 40
          }
        });
        expect(created.status).toBe(201);

        const markedSent = await jsonRequest(callerUrl, `/controller/requests/${requestId}/mark-sent`, {
          method: "POST"
        });
        expect(markedSent.status).toBe(200);

        const issued = await jsonRequest(platformUrl, "/v1/tokens/task", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${caller.body.api_key}`
          },
          body: {
            request_id: requestId,
            responder_id: responder.responder_id,
            hotline_id: responder.hotline_id
          }
        });
        expect(issued.status).toBe(201);

        const acked = await jsonRequest(platformUrl, `/v1/requests/${requestId}/ack`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${responder.api_key}`
          },
          body: {
            responder_id: responder.responder_id,
            hotline_id: responder.hotline_id,
            eta_hint_s: 3
          }
        });
        expect(acked.status).toBe(202);
      }

      const completed = await jsonRequest(platformUrl, "/v1/requests/req_caller_batch_sync_1/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${responder.api_key}`
        },
        body: {
          responder_id: responder.responder_id,
          hotline_id: responder.hotline_id,
          event_type: "COMPLETED",
          status: "ok",
          finished_at: "2026-03-18T12:00:00.000Z"
        }
      });
      expect(completed.status).toBe(202);

      await waitFor(async () => {
        const first = await jsonRequest(callerUrl, "/controller/requests/req_caller_batch_sync_1");
        const second = await jsonRequest(callerUrl, "/controller/requests/req_caller_batch_sync_2");
        if (first.body.status !== "ACKED" || second.body.status !== "ACKED") {
          throw new Error("ack_sync_pending");
        }
        if (!first.body.platform_completed_at) {
          throw new Error("completion_sync_pending");
        }
        return { first, second };
      });

      expect(batchCalls).toBeGreaterThan(0);
    } finally {
      global.fetch = originalFetch;
      await closeServer(callerServer);
      await closeServer(platformServer);
    }
  });
});
