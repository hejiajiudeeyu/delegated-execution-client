// The local execution journal (A-03). Its whole job is to survive the thing
// that destroys the snapshot — a process dying mid-execution — so the tests
// that matter are about what it refuses to forget and what it refuses to let
// anyone rewrite.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JOURNAL_ENTRY as STORE_ENTRY, createSqliteExecutionJournal } from "../../packages/sqlite-store/src/index.js";
import { JOURNAL_ENTRY as RUNTIME_ENTRY } from "../../packages/responder-runtime-core/src/index.js";

describe("execution journal", () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()();
    }
  });

  async function openJournal() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-journal-"));
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

  it("keeps the runtime and store vocabularies identical", () => {
    // The two are declared separately so the execution engine does not have to
    // depend on a native sqlite package. This is the guard that keeps that
    // duplication from drifting into a silent mismatch.
    expect(RUNTIME_ENTRY).toEqual(STORE_ENTRY);
  });

  it("reports an attempt as interrupted when nothing closed it", async () => {
    const journal = await openJournal();
    journal.append({
      bootId: "boot_dead",
      callId: "req_1",
      attemptId: "attempt_1",
      entryType: STORE_ENTRY.ATTEMPT_STARTED,
      recoverability: "non_recoverable"
    });

    const interrupted = journal.listInterruptedAttempts({ excludeBootId: "boot_alive" });
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({
      call_id: "req_1",
      attempt_id: "attempt_1",
      boot_id: "boot_dead",
      recoverability: "non_recoverable"
    });
  });

  it("does not report attempts that reached a terminal status", async () => {
    const journal = await openJournal();
    journal.append({
      bootId: "boot_dead",
      callId: "req_2",
      attemptId: "attempt_2",
      entryType: STORE_ENTRY.ATTEMPT_STARTED
    });
    journal.append({
      bootId: "boot_dead",
      callId: "req_2",
      attemptId: "attempt_2",
      entryType: STORE_ENTRY.ATTEMPT_TERMINAL,
      observedExecution: "delivered"
    });

    expect(journal.listInterruptedAttempts({ excludeBootId: "boot_alive" })).toHaveLength(0);
  });

  it("excludes the current boot's own in-flight work", async () => {
    // An attempt running right now is open for a completely different reason
    // than an attempt whose process died, and confusing the two would have the
    // runtime reconcile work it is in the middle of doing.
    const journal = await openJournal();
    journal.append({
      bootId: "boot_alive",
      callId: "req_3",
      attemptId: "attempt_3",
      entryType: STORE_ENTRY.ATTEMPT_STARTED
    });

    expect(journal.listInterruptedAttempts({ excludeBootId: "boot_alive" })).toHaveLength(0);
    expect(journal.listInterruptedAttempts()).toHaveLength(1);
  });

  it("treats a reconciled or superseded attempt as closed", async () => {
    const journal = await openJournal();
    for (const [callId, attemptId, closingType] of [
      ["req_4", "attempt_4", STORE_ENTRY.ATTEMPT_RECONCILED],
      ["req_5", "attempt_5", STORE_ENTRY.ATTEMPT_SUPERSEDED]
    ]) {
      journal.append({ bootId: "boot_dead", callId, attemptId, entryType: STORE_ENTRY.ATTEMPT_STARTED });
      journal.append({ bootId: "boot_new", callId, attemptId, entryType: closingType });
    }

    expect(journal.listInterruptedAttempts({ excludeBootId: "boot_new" })).toHaveLength(0);
  });

  it("refuses to let history be rewritten or erased", async () => {
    // Append-only enforced by the database, not by everyone remembering not to
    // write UPDATE. A journal a code path can quietly edit is not evidence.
    const journal = await openJournal();
    journal.append({
      bootId: "boot_dead",
      callId: "req_6",
      attemptId: "attempt_6",
      entryType: STORE_ENTRY.ATTEMPT_STARTED
    });

    expect(() =>
      journal.db.prepare("UPDATE execution_journal SET entry_type = ? WHERE attempt_id = ?").run("attempt_terminal", "attempt_6")
    ).toThrow(/append-only/);
    expect(() => journal.db.prepare("DELETE FROM execution_journal WHERE attempt_id = ?").run("attempt_6")).toThrow(
      /append-only/
    );

    expect(journal.listInterruptedAttempts({ excludeBootId: "boot_alive" })).toHaveLength(1);
  });

  it("survives reopening the database file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-journal-reopen-"));
    const databasePath = path.join(dir, "state.sqlite");
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));

    const first = await createSqliteExecutionJournal({ databasePath, serviceName: "responder-controller" });
    await first.migrate();
    first.append({
      bootId: "boot_dead",
      callId: "req_7",
      attemptId: "attempt_7",
      entryType: STORE_ENTRY.ATTEMPT_STARTED,
      recoverability: "restartable"
    });
    first.close();

    const second = await createSqliteExecutionJournal({ databasePath, serviceName: "responder-controller" });
    await second.migrate();
    cleanup.push(() => second.close());

    const interrupted = second.listInterruptedAttempts({ excludeBootId: "boot_new" });
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].recoverability).toBe("restartable");
  });

  it("rejects an incomplete entry rather than writing a row it cannot interpret", async () => {
    const journal = await openJournal();
    expect(() => journal.append({ bootId: "boot", callId: "req", entryType: STORE_ENTRY.ATTEMPT_STARTED })).toThrow(
      /incomplete/
    );
  });
});
