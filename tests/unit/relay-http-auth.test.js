// The relay now authenticates its business routes, so the transport must be
// able to carry a bearer credential — and must keep working without one for a
// local in-process relay on a trusted network.
import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createRelayHttpTransportAdapter } from "../../packages/transports/relay-http/src/index.js";
import { buildTransportEnvUpdates } from "../../apps/ops/src/config.js";

function startCapturingRelay(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization || null,
        body: chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
      });
      handler(req, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

describe("relay http transport auth", () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await new Promise((resolve) => cleanup.pop().close(resolve));
    }
  });

  it("sends the bearer token on every relay verb", async () => {
    const { server, seen, baseUrl } = await startCapturingRelay((req, res) => {
      res.writeHead(req.url.includes("/send") ? 201 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items: [], acked: true, ok: true }));
    });
    cleanup.push(server);

    const transport = createRelayHttpTransportAdapter({
      baseUrl,
      receiver: "responder_a",
      authToken: "rrt_test_token"
    });

    await transport.send({ message_id: "m1", to: "responder_a" });
    await transport.poll({ limit: 1 });
    await transport.ack("m1");
    await transport.peek({ thread_id: "t1" });
    await transport.health();

    expect(seen).toHaveLength(5);
    for (const call of seen) {
      expect(call.authorization, call.url).toBe("Bearer rrt_test_token");
    }
  });

  it("omits the header entirely when no token is configured", async () => {
    const { server, seen, baseUrl } = await startCapturingRelay((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items: [] }));
    });
    cleanup.push(server);

    const transport = createRelayHttpTransportAdapter({ baseUrl, receiver: "responder_a" });
    await transport.poll({ limit: 1 });

    expect(seen[0].authorization).toBeNull();
  });

  it("passes a lease id on ack only when one was tracked", async () => {
    const { server, seen, baseUrl } = await startCapturingRelay((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ acked: true }));
    });
    cleanup.push(server);

    const transport = createRelayHttpTransportAdapter({ baseUrl, receiver: "responder_a" });
    await transport.ack("m1");
    await transport.ack("m2", { leaseId: "lease_abc" });

    expect(seen[0].body).not.toHaveProperty("lease_id");
    expect(seen[1].body.lease_id).toBe("lease_abc");
  });

  it("propagates the transport token to spawned services", () => {
    const updates = buildTransportEnvUpdates(
      { type: "relay_http", relay_http: { base_url: "http://relay.local:8090", auth_token: "rrt_from_config" } },
      {}
    );
    expect(updates.TRANSPORT_AUTH_TOKEN).toBe("rrt_from_config");

    // and an env-provided token is picked up when config carries none
    const fromEnv = buildTransportEnvUpdates(
      { type: "relay_http", relay_http: { base_url: "http://relay.local:8090" } },
      { TRANSPORT_AUTH_TOKEN: "rrt_from_env" }
    );
    expect(fromEnv.TRANSPORT_AUTH_TOKEN).toBe("rrt_from_env");
  });

  it("does not attach a relay token to non-relay transports", () => {
    const updates = buildTransportEnvUpdates({ type: "local" }, {});
    expect(updates.TRANSPORT_AUTH_TOKEN).toBeNull();
  });
});
