import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export async function createSqliteSnapshotStore({
  databasePath,
  serviceName,
  tableName = "service_state_snapshots"
} = {}) {
  if (!databasePath) {
    throw new Error("sqlite_store_database_path_required");
  }
  if (!serviceName) {
    throw new Error("sqlite_store_service_name_required");
  }

  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);

  function migrate() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT,
        applied_at TEXT
      );

      CREATE TABLE IF NOT EXISTS ${tableName} (
        service_name TEXT,
        state_json TEXT,
        updated_at TEXT
      );
    `);
  }

  function loadSnapshot() {
    const row = db
      .prepare(`SELECT state_json FROM ${tableName} WHERE service_name = ? ORDER BY rowid DESC LIMIT 1`)
      .get(serviceName);
    return row?.state_json ? JSON.parse(row.state_json) : null;
  }

  function saveSnapshot(snapshot) {
    const transaction = db.transaction((payload) => {
      db.prepare(`DELETE FROM ${tableName} WHERE service_name = ?`).run(serviceName);
      db.prepare(`INSERT INTO ${tableName} (service_name, state_json, updated_at) VALUES (?, ?, ?)`).run(
        serviceName,
        JSON.stringify(payload),
        new Date().toISOString()
      );
    });
    transaction(snapshot);
  }

  function close() {
    db.close();
  }

  return {
    migrate,
    loadSnapshot,
    saveSnapshot,
    close,
    db,
    databasePath: resolvedPath
  };
}

// An execution attempt is open from the moment it starts until one of these
// rows lands. Anything else leaves the attempt open, which is the point: a
// process that dies mid-execution writes nothing, so the gap is what the next
// boot detects.
export const JOURNAL_ENTRY = Object.freeze({
  ATTEMPT_STARTED: "attempt_started",
  // The attempt reached a terminal status while this process was alive.
  ATTEMPT_TERMINAL: "attempt_terminal",
  // A later boot closed out an attempt whose outcome nobody observed.
  ATTEMPT_RECONCILED: "attempt_reconciled",
  // A restartable attempt was replaced by a fresh attempt after a restart.
  ATTEMPT_SUPERSEDED: "attempt_superseded"
});

const CLOSING_ENTRY_TYPES = Object.freeze([
  JOURNAL_ENTRY.ATTEMPT_TERMINAL,
  JOURNAL_ENTRY.ATTEMPT_RECONCILED,
  JOURNAL_ENTRY.ATTEMPT_SUPERSEDED
]);

/**
 * The local execution journal (A-03).
 *
 * The snapshot store above is last-write-wins: it says what the runtime
 * believes right now, and a crash simply loses whatever had not been written.
 * That is fine for a queue and useless for reconciliation, because the one
 * fact reconciliation needs — "an attempt was running and we never saw it
 * end" — is exactly the fact a truncated snapshot destroys.
 *
 * So this is append-only, and append-only is enforced by triggers rather than
 * by everyone remembering not to write UPDATE. A journal that some code path
 * can rewrite is not evidence.
 */
export async function createSqliteExecutionJournal({
  databasePath,
  serviceName,
  tableName = "execution_journal"
} = {}) {
  if (!databasePath) {
    throw new Error("sqlite_journal_database_path_required");
  }
  if (!serviceName) {
    throw new Error("sqlite_journal_service_name_required");
  }

  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);

  // A journal that loses its last few entries on power loss cannot answer the
  // question it exists for, so it does not get the usual NORMAL relaxation.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");

  function migrate() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        service_name TEXT NOT NULL,
        boot_id TEXT NOT NULL,
        call_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        entry_type TEXT NOT NULL,
        observed_execution TEXT,
        recoverability TEXT,
        detail_json TEXT,
        recorded_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${tableName}_attempt_idx
        ON ${tableName} (service_name, attempt_id);

      CREATE TRIGGER IF NOT EXISTS ${tableName}_no_update
        BEFORE UPDATE ON ${tableName}
        BEGIN SELECT RAISE(ABORT, 'execution journal is append-only'); END;

      CREATE TRIGGER IF NOT EXISTS ${tableName}_no_delete
        BEFORE DELETE ON ${tableName}
        BEGIN SELECT RAISE(ABORT, 'execution journal is append-only'); END;
    `);
  }

  function append(entry) {
    const {
      bootId,
      callId,
      attemptId,
      entryType,
      observedExecution = null,
      recoverability = null,
      detail = null,
      recordedAt = new Date().toISOString()
    } = entry || {};

    if (!bootId || !callId || !attemptId || !entryType) {
      throw new Error("sqlite_journal_entry_incomplete");
    }

    const info = db
      .prepare(
        `INSERT INTO ${tableName}
           (service_name, boot_id, call_id, attempt_id, entry_type,
            observed_execution, recoverability, detail_json, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        serviceName,
        bootId,
        callId,
        attemptId,
        entryType,
        observedExecution,
        recoverability,
        detail ? JSON.stringify(detail) : null,
        recordedAt
      );
    return { seq: info.lastInsertRowid, recorded_at: recordedAt };
  }

  /**
   * Attempts that started and never closed. `excludeBootId` keeps the current
   * boot's own in-flight work out of the result: those attempts are open
   * because they are still running, not because they were interrupted.
   */
  function listInterruptedAttempts({ excludeBootId = null } = {}) {
    const placeholders = CLOSING_ENTRY_TYPES.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT started.boot_id, started.call_id, started.attempt_id,
                started.recoverability, started.detail_json, started.recorded_at
           FROM ${tableName} AS started
          WHERE started.service_name = ?
            AND started.entry_type = ?
            ${excludeBootId ? "AND started.boot_id != ?" : ""}
            AND NOT EXISTS (
              SELECT 1 FROM ${tableName} AS closed
               WHERE closed.service_name = started.service_name
                 AND closed.attempt_id = started.attempt_id
                 AND closed.entry_type IN (${placeholders})
            )
          ORDER BY started.seq ASC`
      )
      .all(
        ...[serviceName, JOURNAL_ENTRY.ATTEMPT_STARTED],
        ...(excludeBootId ? [excludeBootId] : []),
        ...CLOSING_ENTRY_TYPES
      );

    return rows.map((row) => ({
      boot_id: row.boot_id,
      call_id: row.call_id,
      attempt_id: row.attempt_id,
      recoverability: row.recoverability,
      started_at: row.recorded_at,
      detail: row.detail_json ? JSON.parse(row.detail_json) : null
    }));
  }

  function listEntries({ attemptId = null, callId = null } = {}) {
    const filters = ["service_name = ?"];
    const params = [serviceName];
    if (attemptId) {
      filters.push("attempt_id = ?");
      params.push(attemptId);
    }
    if (callId) {
      filters.push("call_id = ?");
      params.push(callId);
    }
    return db
      .prepare(`SELECT * FROM ${tableName} WHERE ${filters.join(" AND ")} ORDER BY seq ASC`)
      .all(...params)
      .map((row) => ({ ...row, detail: row.detail_json ? JSON.parse(row.detail_json) : null }));
  }

  function close() {
    db.close();
  }

  return {
    migrate,
    append,
    listInterruptedAttempts,
    listEntries,
    close,
    db,
    databasePath: resolvedPath
  };
}
