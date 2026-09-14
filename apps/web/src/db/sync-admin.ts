import type { SqlDb } from "@discvault/schema";
import type { SyncedTableName } from "@discvault/sync-protocol";
import type { OutboxRow } from "./rows.js";
import { writeRow } from "./rows.js";

/** Sync & storage screen's "Pending changes" list, oldest first (push order). */
export function listOutbox(db: SqlDb): OutboxRow[] {
  return db.all<OutboxRow>(`SELECT * FROM outbox ORDER BY rowid`);
}

/** "Discard" on one pending change: it is dropped and never pushed. */
export function discardOutboxEntry(db: SqlDb, id: string): void {
  db.run(`DELETE FROM outbox WHERE id = ?`, [id]);
}

export interface ConflictRow {
  id: string;
  table_name: SyncedTableName;
  row_id: string;
  mine_json: string;
  theirs_json: string;
  reason: string;
  created_at: string;
}

export function listConflicts(db: SqlDb): ConflictRow[] {
  return db.all<ConflictRow>(
    `SELECT id, table_name, row_id, mine_json, theirs_json, reason, created_at FROM conflict ORDER BY created_at DESC`,
  );
}

/** §8 overlay F, "keep theirs": applies the server's values locally and clears the conflict. */
export function keepTheirs(db: SqlDb, conflictId: string): void {
  const row = db.get<ConflictRow>(`SELECT * FROM conflict WHERE id = ?`, [conflictId]);
  if (!row) return;
  const theirs = JSON.parse(row.theirs_json) as Record<string, unknown>;
  db.transaction(() => {
    writeRow(db, row.table_name, row.row_id, theirs);
    db.run(`DELETE FROM conflict WHERE id = ?`, [conflictId]);
  });
}

/** §8 overlay F, "keep mine": drops the conflict record; the next push tries the local value again. */
export function dismissConflict(db: SqlDb, conflictId: string): void {
  db.run(`DELETE FROM conflict WHERE id = ?`, [conflictId]);
}
