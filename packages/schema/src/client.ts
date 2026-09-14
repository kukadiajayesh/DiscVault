import { SYNCED_TABLE_INDEXES, SYNCED_TABLES, syncedTableDDL } from "@discvault/sync-protocol";
import { CATEGORIES, DISC_STATUSES, FILE_CATEGORY_DEFAULTS, insertRows, MEDIA_TYPES } from "./seeds.js";
import type { Migration, SqlDb } from "./sql-db.js";

/**
 * Local database on each device (§9.1). One file per vault (`vault-{vault_id}.sqlite3`), so no
 * table carries a vault id.
 */
export const CLIENT_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    statements: [
      // ── Lookup tables ──────────────────────────────────────────────────────
      "CREATE TABLE media_type (code TEXT PRIMARY KEY, label TEXT NOT NULL, capacity_kb INTEGER, sort_order INTEGER)",
      "CREATE TABLE disc_status (code TEXT PRIMARY KEY, label TEXT NOT NULL)",
      "CREATE TABLE category (code TEXT PRIMARY KEY, label TEXT NOT NULL, icon TEXT)",
      ...insertRows("media_type", MEDIA_TYPES),
      ...insertRows("disc_status", DISC_STATUSES),
      ...insertRows("category", CATEGORIES),

      // ── User metadata (synced row by row) ────────────────────────────────
      ...Object.values(SYNCED_TABLES).map(syncedTableDDL),
      ...SYNCED_TABLE_INDEXES,

      // ── Catalog data (filled from disc packs, never synced row by row) ────
      `CREATE TABLE folder (
        folder_id INTEGER PRIMARY KEY,
        disc_no   INTEGER NOT NULL,
        parent_id INTEGER REFERENCES folder(folder_id) ON DELETE CASCADE,
        name      TEXT NOT NULL,
        rel_path  TEXT NOT NULL,
        size_kb   INTEGER,
        created   TEXT,
        meta      TEXT
      )`,
      "CREATE INDEX folder_tree_idx ON folder (disc_no, parent_id, name COLLATE NOCASE)",
      "CREATE UNIQUE INDEX folder_path_idx ON folder (disc_no, rel_path COLLATE NOCASE)",
      `CREATE TABLE file (
        file_id           INTEGER PRIMARY KEY,
        disc_no           INTEGER NOT NULL,
        folder_id         INTEGER REFERENCES folder(folder_id) ON DELETE CASCADE,
        container_file_id INTEGER REFERENCES file(file_id) ON DELETE CASCADE,
        name              TEXT NOT NULL,
        ext               TEXT,
        rel_path          TEXT NOT NULL,
        size_kb           INTEGER,
        created           TEXT,
        date_valid        INTEGER NOT NULL DEFAULT 1,
        meta              TEXT
      )`,
      "CREATE INDEX file_list_idx ON file (disc_no, folder_id, name COLLATE NOCASE)",
      "CREATE INDEX file_ext_idx ON file (ext)",
      "CREATE INDEX file_container_idx ON file (container_file_id) WHERE container_file_id IS NOT NULL",
      "CREATE INDEX file_size_idx ON file (size_kb)",
      "CREATE INDEX file_dup_idx ON file (size_kb, name COLLATE NOCASE)",
      "CREATE UNIQUE INDEX file_path_idx ON file (disc_no, rel_path COLLATE NOCASE)",

      // Substring search ("helsing" → "VanHelsing2004[DvdRip]…"), kept in step by triggers.
      "CREATE VIRTUAL TABLE file_fts USING fts5(name, content='file', content_rowid='file_id', tokenize='trigram')",
      "CREATE VIRTUAL TABLE folder_fts USING fts5(name, content='folder', content_rowid='folder_id', tokenize='trigram')",
      "CREATE TRIGGER file_fts_ai AFTER INSERT ON file BEGIN INSERT INTO file_fts(rowid, name) VALUES (new.file_id, new.name); END",
      "CREATE TRIGGER file_fts_ad AFTER DELETE ON file BEGIN INSERT INTO file_fts(file_fts, rowid, name) VALUES ('delete', old.file_id, old.name); END",
      "CREATE TRIGGER folder_fts_ai AFTER INSERT ON folder BEGIN INSERT INTO folder_fts(rowid, name) VALUES (new.folder_id, new.name); END",
      "CREATE TRIGGER folder_fts_ad AFTER DELETE ON folder BEGIN INSERT INTO folder_fts(folder_fts, rowid, name) VALUES ('delete', old.folder_id, old.name); END",

      // ── Local-only tables ──────────────────────────────────────────────────
      "CREATE TABLE file_category (ext TEXT PRIMARY KEY, category TEXT NOT NULL REFERENCES category(code))",
      ...insertRows("file_category", FILE_CATEGORY_DEFAULTS),
      "CREATE TABLE search_history (id INTEGER PRIMARY KEY, query_json TEXT, result_count INTEGER, at TEXT)",

      // ── Sync engine ────────────────────────────────────────────────────────
      "CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT)",
      `CREATE TABLE outbox (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        table_name  TEXT NOT NULL,
        row_id      TEXT NOT NULL,
        op          TEXT NOT NULL,
        payload     TEXT NOT NULL,
        base_version INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        attempts    INTEGER NOT NULL DEFAULT 0,
        last_error  TEXT,
        blocked     INTEGER NOT NULL DEFAULT 0
      )`,
      "CREATE INDEX outbox_row_idx ON outbox (table_name, row_id)",
      // Which pack each disc's folder/file rows were loaded from (disc.pack_hash is the server's view).
      "CREATE TABLE local_pack (disc_no INTEGER PRIMARY KEY, pack_hash TEXT NOT NULL, imported_at TEXT NOT NULL)",
      // Pack parts built on this device (scan or archive import) and not uploaded yet.
      `CREATE TABLE pending_pack_part (
        disc_no   INTEGER NOT NULL,
        pack_hash TEXT NOT NULL,
        part      INTEGER NOT NULL,
        part_hash TEXT NOT NULL,
        bytes     INTEGER NOT NULL,
        data      BLOB NOT NULL,
        uploaded  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (disc_no, pack_hash, part)
      )`,
      `CREATE TABLE conflict (
        id          TEXT PRIMARY KEY,
        outbox_id   TEXT,
        table_name  TEXT,
        row_id      TEXT,
        mine_json   TEXT,
        theirs_json TEXT,
        reason      TEXT,
        created_at  TEXT NOT NULL
      )`,
    ],
  },
  {
    // Duplicates/Statistics/Collections/Locations/Data health dropped (never built past the nav
    // stub): removes their tables, disc's location columns, and the unused stats/dup caches.
    // A fresh device's v1 already omits all of this, so the column drops are conditional.
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
      "DROP TABLE IF EXISTS location_kind",
      "DROP TABLE IF EXISTS stats_cache",
      "DROP TABLE IF EXISTS dup_cache",
    ],
    run: (db) => dropColumnsIfPresent(db, "disc", ["location_id", "location_slot"]),
  },
];

function dropColumnsIfPresent(db: SqlDb, table: string, columns: string[]): void {
  const existing = new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));
  for (const column of columns) if (existing.has(column)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}
