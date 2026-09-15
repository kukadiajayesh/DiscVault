import { SYNCED_TABLE_INDEXES, SYNCED_TABLES, syncedTableDDL } from "@discvault/sync-protocol";
import type { Migration, SqlDb } from "./sql-db.js";

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
  {
    // Duplicates/Statistics/Collections/Locations/Data health dropped (never built past the nav
    // stub): removes their tables and disc's location columns. A vault created after this change
    // already omits all of this in v1, so the column drops are conditional.
    version: 2,
    name: "drop_phase4_stubs",
    statements: [
      // SQLite refuses to drop an indexed column, so the old index has to go first.
      "DROP INDEX IF EXISTS disc_location_idx",
      "DROP TABLE IF EXISTS location",
      "DROP TABLE IF EXISTS collection",
      "DROP TABLE IF EXISTS collection_item",
      "DROP TABLE IF EXISTS borrower",
      "DROP TABLE IF EXISTS loan",
    ],
    run: (db) => dropColumnsIfPresent(db, "disc", ["location_id", "location_slot"]),
  },
  {
    // `disc_item` (§ AI: disc identification) was added to SYNCED_TABLES after v1 shipped, so a
    // vault that already migrated past v1 never ran the statement that creates it. Re-running the
    // synced-table DDL/indexes is a no-op for tables that already exist (CREATE TABLE/INDEX IF NOT
    // EXISTS) and creates only what's missing — the general fix for any future addition to
    // SYNCED_TABLES, not just this one.
    version: 3,
    name: "sync_new_synced_tables",
    statements: [...Object.values(SYNCED_TABLES).map(syncedTableDDL), ...SYNCED_TABLE_INDEXES],
  },
  {
    // `disc_item.image_url` (§ image preview) was added to SYNCED_TABLES after v1/v3 shipped, so an
    // existing `disc_item` table doesn't have it — re-running syncedTableDDL is a no-op for a table
    // that already exists, so (unlike v3) this needs an actual ALTER TABLE, done conditionally in
    // case a device is migrating straight from a fresh v1 install that already has the column.
    version: 4,
    name: "disc_item_image_url",
    run: (db) => addColumnIfMissing(db, "disc_item", "image_url", "TEXT"),
  },
];

function dropColumnsIfPresent(db: SqlDb, table: string, columns: string[]): void {
  const existing = new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));
  for (const column of columns) if (existing.has(column)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}

function addColumnIfMissing(db: SqlDb, table: string, column: string, sqlType: string): void {
  const existing = new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));
  if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
}
