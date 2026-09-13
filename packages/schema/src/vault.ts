import { SYNCED_TABLE_INDEXES, SYNCED_TABLES, syncedTableDDL } from "@discvault/sync-protocol";
import type { Migration } from "./sql-db.js";

/**
 * One vault's database, inside its SQLite-backed Durable Object (§9.2). The whole database belongs
 * to one vault, so no table carries a vault id. Stores metadata only; files live in KV packs.
 */
export const VAULT_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    statements: [
      ...Object.values(SYNCED_TABLES).map(syncedTableDDL),
      ...SYNCED_TABLE_INDEXES,
      `CREATE TABLE change_log (
        seq              INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name       TEXT NOT NULL,
        row_id           TEXT NOT NULL,
        op               TEXT NOT NULL,
        row_json         TEXT,
        overwritten_json TEXT,
        user_id          TEXT,
        device_id        TEXT,
        outbox_id        TEXT UNIQUE,
        at               TEXT NOT NULL
      )`,
      "CREATE INDEX change_log_row_idx ON change_log (table_name, row_id)",
      "CREATE INDEX change_log_at_idx ON change_log (at)",
      `CREATE TABLE scan_job (
        id TEXT PRIMARY KEY, disc_no INTEGER, source TEXT, pack_hash TEXT,
        files_added INTEGER, files_removed INTEGER, files_changed INTEGER,
        device_id TEXT, at TEXT
      )`,
      `CREATE TABLE quota_usage (
        day          TEXT PRIMARY KEY,
        meta_writes  INTEGER NOT NULL DEFAULT 0,
        pack_uploads INTEGER NOT NULL DEFAULT 0
      )`,
      // Pack parts reserved, uploaded and committed for this vault. Current packs stay here;
      // replaced ones move to the directory's purge queue.
      `CREATE TABLE pack_part (
        disc_no      INTEGER NOT NULL,
        pack_hash    TEXT NOT NULL,
        part         INTEGER NOT NULL,
        part_hash    TEXT NOT NULL,
        bytes        INTEGER NOT NULL,
        reserved_at  TEXT NOT NULL,
        uploaded_at  TEXT,
        committed_at TEXT,
        PRIMARY KEY (disc_no, pack_hash, part)
      )`,
      "CREATE TABLE vault_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    ],
  },
];
