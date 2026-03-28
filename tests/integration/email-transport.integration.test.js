import { describe, expect, it } from "vitest";

import {
  InMemoryEmailTransport,
  pollThreadReplies,
  sendTaskEmail
} from "@delexec/transport-email";

describe("email transport integration", () => {
  it("sends and polls by request and direction", async () => {
    const transport = new InMemoryEmailTransport({ minDelayMs: 0, maxDelayMs: 1 });

    await sendTaskEmail(transport, {
      request_id: "req_mail_1",
      thread_id: "thread_1",
      direction: "caller_to_responder",
      payload: { type: "task", body: "hello" }
    });

    await sendTaskEmail(transport, {
      request_id: "req_mail_1",
      thread_id: "thread_1",
      direction: "responder_to_caller",
      payload: { type: "result", body: "ok" }
    });

    const replies = await pollThreadReplies(transport, {
      request_id: "req_mail_1",
      direction: "responder_to_caller"
    });

    expect(replies.length).toBe(1);
    expect(replies[0].payload.type).toBe("result");
  });

  it("supports generic send/poll/ack with JSON body and attachments", async () => {
    const transport = new InMemoryEmailTransport({ minDelayMs: 0, maxDelayMs: 1 });
    const sent = await transport.send({
      request_id: "req_mail_generic_1",
      thread_id: "thread_generic_1",
      from: "responder@example.com",
      to: "caller@example.com",
      type: "task.result",
      body_text: JSON.stringify({ request_id: "req_mail_generic_1", status: "ok" }),
      attachments: [
        {
          name: "report.txt",
          media_type: "text/plain",
          content: "hello attachment"
        }
      ]
    });

    const polled = await transport.poll({ receiver: "caller@example.com" });
    expect(polled.items).toHaveLength(1);
    expect(polled.items[0].message_id).toBe(sent.message_id);
    expect(polled.items[0].body_text).toContain("\"status\":\"ok\"");
    expect(polled.items[0].attachments[0].name).toBe("report.txt");

    const acked = await transport.ack(sent.message_id, { receiver: "caller@example.com" });
    expect(acked.acked).toBe(true);

    const empty = await transport.poll({ receiver: "caller@example.com" });
    expect(empty.items).toHaveLength(0);
  });

  it("can simulate duplicates", async () => {
    const transport = new InMemoryEmailTransport({ duplicateRate: 1 });

    await sendTaskEmail(transport, {
      request_id: "req_mail_dup_1",
      direction: "responder_to_caller",
      payload: { type: "result", body: "dup" }
    });

    const replies = await pollThreadReplies(transport, {
      request_id: "req_mail_dup_1",
      direction: "responder_to_caller"
    });

    expect(replies.length).toBeGreaterThanOrEqual(2);
  });

  it("throws on missing transport interface", async () => {
    await expect(sendTaskEmail({}, { request_id: "req_x" })).rejects.toThrow("TRANSPORT_SEND_NOT_AVAILABLE");
    await expect(pollThreadReplies({}, { request_id: "req_x" })).rejects.toThrow("TRANSPORT_POLL_NOT_AVAILABLE");
  });
});
