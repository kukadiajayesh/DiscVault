import type { SqlDb, SqlValue } from "@discvault/schema";
import {
  type Change,
  type FieldValue,
  SYNCED_TABLES,
  type SyncedTableName,
  uuidv7,
  validateFields,
  validateRowId,
} from "@discvault/sync-protocol";
import { nowIso } from "./local-db.js";

type Row = Record<string, SqlValue>;

export interface OutboxRow {
  id: string;
  kind: "row" | "pack";
  table_name: SyncedTableName;
  row_id: string;
  op: "upsert" | "delete" | "pack_commit";
  payload: string;
  base_version: number;
  created_at: string;
  attempts: number;
  last_error: string | null;
  blocked: number;
}

/**
 * Saves a local edit: updates the row and appends to the outbox in one transaction, so the UI
 * changes immediately and the edit is pushed later (§6.3 B).
 */
export function writeRow(db: SqlDb, table: SyncedTableName, rowId: string, fields: Record<string, unknown>): string {
  const validated = validateFields(table, fields);
  if (!validated.ok) throw new Error(validated.error);
  const id = validateRowId(table, rowId);
  if (!id.ok) throw new Error(id.error);
  const def = SYNCED_TABLES[table];
  const values = validated.value.values;

  return db.transaction(() => {
    const existing = db.get<Row>(`SELECT * FROM ${table} WHERE ${def.primaryKey} = ?`, [id.value]);
    const now = nowIso();
    if (existing) {
      const sets = Object.keys(values).map((c) => `${c} = ?`);
      db.run(`UPDATE ${table} SET ${[...sets, "updated_at = ?", "deleted_at = NULL"].join(", ")} WHERE ${def.primaryKey} = ?`, [
        ...Object.values(values),
        now,
        id.value,
      ]);
    } else {
      insertLocalRow(db, table, id.value, values, now);
    }
    return enqueue(db, {
      kind: "row",
      table,
      rowId,
      op: "upsert",
      payload: values,
      baseVersion: Number(existing?.version ?? 0),
    });
  });
}

export function deleteRow(db: SqlDb, table: SyncedTableName, rowId: string): string {
  const def = SYNCED_TABLES[table];
  const id = validateRowId(table, rowId);
  if (!id.ok) throw new Error(id.error);
  return db.transaction(() => {
    const existing = db.get<Row>(`SELECT version FROM ${table} WHERE ${def.primaryKey} = ?`, [id.value]);
    if (!existing) throw new Error(`${table} ${rowId} does not exist`);
    db.run(`UPDATE ${table} SET deleted_at = ? WHERE ${def.primaryKey} = ?`, [nowIso(), id.value]);
    return enqueue(db, { kind: "row", table, rowId, op: "delete", payload: {}, baseVersion: Number(existing.version) });
  });
}

export function enqueue(
  db: SqlDb,
  entry: {
    kind: "row" | "pack";
    table: SyncedTableName;
    rowId: string;
    op: OutboxRow["op"];
    payload: Record<string, unknown>;
    baseVersion: number;
  },
): string {
  const id = uuidv7();
  db.run(
    `INSERT INTO outbox (id, kind, table_name, row_id, op, payload, base_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, entry.kind, entry.table, entry.rowId, entry.op, JSON.stringify(entry.payload), entry.baseVersion, nowIso()],
  );
  return id;
}

function insertLocalRow(db: SqlDb, table: SyncedTableName, rowId: SqlValue, values: Record<string, FieldValue>, now: string) {
  const def = SYNCED_TABLES[table];
  const row: Row = { [def.primaryKey]: rowId, created_at: now, updated_at: now };
  for (const [column, col] of Object.entries(def.columns)) {
    if (column in values) row[column] = values[column] ?? null;
    else if (col.default !== undefined) row[column] = col.default;
    else if (col.required) throw new Error(`${table}.${column} is required`);
  }
  const columns = Object.keys(row);
  db.run(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    columns.map((c) => row[c] ?? null),
  );
}

export interface ApplyResult {
  applied: number;
  /** Discs whose pack changed or that were deleted, so their files must be (re)loaded or removed. */
  discsToRefresh: number[];
}

/**
 * Applies rows pulled from the server. Server rows are authoritative, but fields of edits still in
 * this device's outbox are re-applied on top so unsent local changes stay visible.
 */
export function applyChanges(db: SqlDb, changes: Change[]): ApplyResult {
  const result: ApplyResult = { applied: 0, discsToRefresh: [] };
  db.transaction(() => {
    for (const change of changes) {
      const def = SYNCED_TABLES[change.table];
      const id = validateRowId(change.table, change.rowId);
      if (!id.ok) continue;
      const local = db.get<{ version: number; pack_hash?: string | null }>(`SELECT * FROM ${change.table} WHERE ${def.primaryKey} = ?`, [
        id.value,
      ]);
      if (local && Number(local.version) >= change.seq) continue;

      const columns = [def.primaryKey, ...Object.keys(def.columns), "created_at", "updated_at", "deleted_at", "version"];
      const values = columns.map((c) => toSqlValue(change.row[c]));
      db.run(
        `INSERT INTO ${change.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
         ON CONFLICT (${def.primaryKey}) DO UPDATE SET ${columns
           .slice(1)
           .map((c) => `${c} = excluded.${c}`)
           .join(", ")}`,
        values,
      );

      const pending = db.all<OutboxRow>(
        "SELECT * FROM outbox WHERE table_name = ? AND row_id = ? AND op = 'upsert' AND blocked = 0 ORDER BY id",
        [change.table, change.rowId],
      );
      for (const entry of pending) {
        const fields = JSON.parse(entry.payload) as Record<string, SqlValue>;
        const sets = Object.keys(fields).map((c) => `${c} = ?`);
        if (sets.length > 0) {
          db.run(`UPDATE ${change.table} SET ${sets.join(", ")} WHERE ${def.primaryKey} = ?`, [...Object.values(fields), id.value]);
        }
      }

      if (change.table === "disc") {
        const discNo = Number(change.rowId);
        const loaded = db.get<{ pack_hash: string }>("SELECT pack_hash FROM local_pack WHERE disc_no = ?", [discNo]);
        if (change.op === "delete" || (change.row.pack_hash && loaded?.pack_hash !== change.row.pack_hash)) {
          result.discsToRefresh.push(discNo);
        }
      }
      result.applied++;
    }
  });
  return result;
}

function toSqlValue(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value);
}
