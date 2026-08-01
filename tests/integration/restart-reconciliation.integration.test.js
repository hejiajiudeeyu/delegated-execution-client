// The responder half of restart reconciliation (A-03, PRD Flow E), against a
// real platform-api.
//
// The scenario throughout: a previous boot started an attempt and died without
// writing a terminal row. What the new boot does about that is decided by the
// hotline version's recoverability class, and the conservative default is the
// one that must hold — unknown work is reported failed, never re-run, never
// left silently open on the platform side.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PRICING_MODEL, TRUST_TIER } from "@delexec/contracts";
import { createPlatformServer, createPlatformState } from "@delexec/platform-api";
import {
  JOURNAL_ENTRY,
  createResponderState,
  reconcileInterruptedAttempts
} from "../../packages/responder-runtime-core/src/index.js";
import { createSqliteExecutionJournal } from "../../packages/sqlite-store/src/index.js";
import { closeServer, jsonRequest, listenServer } from "../helpers/http.js";

const DEAD_BOOT = "boot_that_died";

describe("restart reconciliation", () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()();
    }
  });

  async function openJournal() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-reconcile-"));
    const journal = await createSqliteExecutionJournal({
      databasePath: path.join(dir, "state.sqlite"),
      serviceName: "responder-controller"
    });
    await journal.migrate();
    cleanup.push(() => {
      journal.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    return journal;
  }

  async function startPlatform(requestId) {
    const state = createPlatformState({ adminApiKey: "sk_admin_reconcile", bootstrapEnabled: true });
    const responder = state.bootstrap.responders[0];
    const item = state.catalog.get(responder.hotline_id);
    item.pricing_hint = {
      pricing_model: PRICING_MODEL.FIXED_PRICE,
      currency: "PTS",
      fixed_price_cents: 0,
      base_price_cents: null,
      variable_unit: null,
      variable_unit_description: null,
      variable_unit_price_cents: null,
      max_total_cents: 0,
      free_tier: null,
      billing_disclosure_url: "https://callanything.xyz/marketplace/responders/test",
      trust_tier: TRUST_TIER.UNTRUSTED
    };

    const server = createPlatformServer({ serviceName: "reconcile-client-test", state });
    const baseUrl = await listenServer(server);
    cleanup.push(() => closeServer(server));

    const caller = await jsonRequest(baseUrl, "/v1/users/register", {
      method: "POST",
      body: { contact_email: `${requestId}@test.local` }
    });
    expect(caller.status).toBe(201);

    const token = await jsonRequest(baseUrl, "/v1/tokens/task", {
      method: "POST",
      headers: { Authorization: `Bearer ${caller.body.api_key}` },
      body: {
        request_id: requestId,
        responder_id: responder.responder_id,
        hotline_id: responder.hotline_id
      }
    });
    expect(token.status).toBe(201);

    return { platformState: state, baseUrl, responder, caller: caller.body };
  }

  /**
   * A responder state whose signing key the platform already trusts, holding a
   * journal that remembers an attempt a dead process started.
   */
  async function bootAfterCrash(requestId, { recoverability = "non_recoverable", withPlatform = true } = {}) {
    const platformCtx = withPlatform ? await startPlatform(requestId) : null;
    const journal = await openJournal();

    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    if (platformCtx) {
      const record = platformCtx.platformState.responders.get(platformCtx.responder.responder_id);
      record.responder_public_key_pem = publicKeyPem;
      record.responder_public_keys_pem = [publicKeyPem];
    }

    const state = createResponderState({
      signing: { privateKeyPem, publicKeyPem },
      responderId: platformCtx?.responder.responder_id || "responder_starlight",
      hotlineIds: [platformCtx?.responder.hotline_id || "starlight.creative.studio.v1"],
      journal
    });

    // What the dead process left behind: a start with no ending.
    journal.append({
      bootId: DEAD_BOOT,
      callId: requestId,
      attemptId: "attempt_from_dead_boot",
      entryType: JOURNAL_ENTRY.ATTEMPT_STARTED,
      recoverability,
      detail: { hotline_id: state.identity.hotline_ids[0], task_id: "task_dead" }
    });

    const platform = platformCtx
      ? { baseUrl: platformCtx.baseUrl, apiKey: platformCtx.responder.api_key }
      : { baseUrl: "http://127.0.0.1:1", apiKey: "sk_unreachable" };

    return { ...(platformCtx || {}), journal, state, platform, requestId };
  }

  it("reports an interrupted non-recoverable attempt to the platform as failed", async () => {
    const ctx = await bootAfterCrash("req_reconcile_client_basic");

    const summary = await reconcileInterruptedAttempts({ state: ctx.state, platform: ctx.platform });

    expect(summary.inspected).toBe(1);
    expect(summary.reported).toEqual([
      { call_id: "req_reconcile_client_basic", attempt_id: "attempt_from_dead_boot" }
    ]);
    expect(summary.rerun).toHaveLength(0);
    expect(summary.unreported).toHaveLength(0);

    // The platform agrees the call is closed, and says why.
    const request = ctx.platformState.requests.get("req_reconcile_client_basic");
    const reconciled = request.events.find((event) => event.event_type === "RECONCILED");
    expect(reconciled).toMatchObject({
      attempt_id: "attempt_from_dead_boot",
      boot_id: DEAD_BOOT,
      observed_execution: "failed"
    });
    expect(reconciled.reconciled_by_boot_id).toBe(ctx.state.boot_id);
  });

  it("does not report the same attempt again on the next boot", async () => {
    const ctx = await bootAfterCrash("req_reconcile_client_once");
    await reconcileInterruptedAttempts({ state: ctx.state, platform: ctx.platform });

    // A third boot sees the journal with the reconciled row already in it.
    const nextBoot = createResponderState({ journal: ctx.journal });
    const summary = await reconcileInterruptedAttempts({ state: nextBoot, platform: ctx.platform });

    expect(summary.inspected).toBe(0);
    expect(summary.reported).toHaveLength(0);
  });

  it("leaves the attempt open when the platform cannot be reached", async () => {
    // The dangerous failure would be treating "I could not tell anyone" as
    // "handled". A restart during an outage must not erase the call.
    const ctx = await bootAfterCrash("req_reconcile_client_offline", { withPlatform: false });

    const summary = await reconcileInterruptedAttempts({ state: ctx.state, platform: ctx.platform });

    expect(summary.inspected).toBe(1);
    expect(summary.reported).toHaveLength(0);
    expect(summary.unreported).toHaveLength(1);

    const entries = ctx.journal.listEntries({ attemptId: "attempt_from_dead_boot" });
    expect(entries.map((entry) => entry.entry_type)).toEqual([JOURNAL_ENTRY.ATTEMPT_STARTED]);

    // And the next boot still sees it as work owed.
    const nextBoot = createResponderState({ journal: ctx.journal });
    expect(ctx.journal.listInterruptedAttempts({ excludeBootId: nextBoot.boot_id })).toHaveLength(1);
  });

  it("re-runs a restartable attempt instead of reporting it failed", async () => {
    const ctx = await bootAfterCrash("req_reconcile_client_restartable", { recoverability: "restartable" });

    // The task record survives in the snapshot; reconciliation re-queues it.
    const task = {
      task_id: "task_dead",
      request_id: "req_reconcile_client_restartable",
      attempt_id: "attempt_from_dead_boot",
      hotline_id: ctx.state.identity.hotline_ids[0],
      responder_id: ctx.state.identity.responder_id,
      status: "RUNNING",
      lease_ttl_s: 30,
      delay_ms: 0
    };
    ctx.state.tasks.set(task.task_id, task);
    ctx.state.requestIndex.set(task.request_id, task.task_id);

    // Deferred rather than completed: this test is about what reconciliation
    // decides, and letting the re-run finish would drag result delivery into it.
    const summary = await reconcileInterruptedAttempts({
      state: ctx.state,
      platform: ctx.platform,
      executor: { execute: async () => ({ deferred: true, reason: "held_open_by_test" }) }
    });

    expect(summary.reported).toHaveLength(0);
    expect(summary.rerun).toHaveLength(1);

    // A fresh attempt id, so "tried twice" never reads as "reported twice".
    const newAttemptId = task.attempt_id;
    expect(newAttemptId).not.toBe("attempt_from_dead_boot");

    // The dead attempt is closed as superseded — not terminal, because nobody
    // ever saw how it ended.
    expect(ctx.journal.listEntries({ attemptId: "attempt_from_dead_boot" }).map((entry) => entry.entry_type)).toEqual([
      JOURNAL_ENTRY.ATTEMPT_STARTED,
      JOURNAL_ENTRY.ATTEMPT_SUPERSEDED
    ]);
    // And the re-run is itself journaled, so a second crash reconciles it too.
    expect(ctx.journal.listEntries({ attemptId: newAttemptId }).map((entry) => entry.entry_type)).toEqual([
      JOURNAL_ENTRY.ATTEMPT_STARTED
    ]);

    // Nothing was reported to the platform: the work is being redone, not closed.
    const request = ctx.platformState.requests.get("req_reconcile_client_restartable");
    expect(request.events.find((event) => event.event_type === "RECONCILED")).toBeUndefined();
  });

  it("reports a restartable attempt anyway when the task itself is gone", async () => {
    // Restartable is permission to re-run, not a promise that re-running is
    // possible. With no surviving task record there is nothing to re-run, and
    // the honest move is still to close the call rather than drop it.
    const ctx = await bootAfterCrash("req_reconcile_client_norecord", { recoverability: "restartable" });

    const summary = await reconcileInterruptedAttempts({
      state: ctx.state,
      platform: ctx.platform,
      executor: { execute: async () => ({ status: "ok" }) }
    });

    expect(summary.rerun).toHaveLength(0);
    expect(summary.reported).toHaveLength(1);
  });

  it("ignores work the current boot is still running", async () => {
    const ctx = await bootAfterCrash("req_reconcile_client_inflight");
    ctx.journal.append({
      bootId: ctx.state.boot_id,
      callId: "req_still_running",
      attemptId: "attempt_in_flight",
      entryType: JOURNAL_ENTRY.ATTEMPT_STARTED,
      recoverability: "non_recoverable"
    });

    const summary = await reconcileInterruptedAttempts({ state: ctx.state, platform: ctx.platform });

    expect(summary.inspected).toBe(1);
    expect(summary.reported.map((entry) => entry.call_id)).toEqual(["req_reconcile_client_inflight"]);
    expect(ctx.journal.listEntries({ attemptId: "attempt_in_flight" }).map((entry) => entry.entry_type)).toEqual([
      JOURNAL_ENTRY.ATTEMPT_STARTED
    ]);
  });

  it("does nothing at all when there is no journal", async () => {
    // Journalless runtimes (the local example flow) keep working; they simply
    // have nothing to reconcile, and must not claim otherwise.
    const summary = await reconcileInterruptedAttempts({ state: createResponderState(), platform: null });
    expect(summary).toMatchObject({ inspected: 0, rerun: [], reported: [], unreported: [] });
  });
});
