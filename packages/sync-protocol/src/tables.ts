/**
 * User-metadata tables synced row by row (§6.3 B). One definition drives the DDL on the device and
 * in each vault's Durable Object, and the server's validation of pushed fields: the server never
 * accepts a table or column that isn't listed here.
 */

export type ColumnType = "text" | "integer" | "json";

export interface ColumnDef {
  type: ColumnType;
  /** NOT NULL on insert. */
  required?: boolean;
  /** Default used when a new row omits the column. */
  default?: string | number;
  /** Row in another synced table this column points at (checked on push: must exist, not deleted). */
  references?: SyncedTableName;
  /** Must be a valid item key (`d:`, `p:`, `f:`). */
  itemKey?: boolean;
  /** Only the server sets it (e.g. pack fields, set through `pack_commit`). */
  serverOnly?: boolean;
}

export interface SyncedTableDef {
  name: SyncedTableName;
  primaryKey: string;
  primaryKeyType: "text" | "integer";
  /** How the primary key is produced: a UUIDv7, the disc number, an item key or an extension. */
  primaryKeyKind: "uuid" | "disc_no" | "item_key" | "ext";
  columns: Record<string, ColumnDef>;
}

export const SYNCED_TABLE_NAMES = ["disc", "disc_item", "tag", "tag_link", "item_note", "saved_search", "category_override"] as const;

export type SyncedTableName = (typeof SYNCED_TABLE_NAMES)[number];

/** Columns every synced table has, maintained by the sync engine rather than pushed as fields. */
export const SYSTEM_COLUMNS = ["created_at", "updated_at", "deleted_at", "version"] as const;

export const SYNCED_TABLES: Record<SyncedTableName, SyncedTableDef> = {
  disc: {
    name: "disc",
    primaryKey: "disc_no",
    primaryKeyType: "integer",
    primaryKeyKind: "disc_no",
    columns: {
      label: { type: "text" },
      title: { type: "text" },
      media_type: { type: "text" },
      status: { type: "text", required: true, default: "available" },
      notes: { type: "text" },
      meta: { type: "json" },
      folder_count: { type: "integer", required: true, default: 0, serverOnly: true },
      file_count: { type: "integer", required: true, default: 0, serverOnly: true },
      total_kb: { type: "integer", required: true, default: 0, serverOnly: true },
      pack_hash: { type: "text", serverOnly: true },
      pack_parts: { type: "integer", required: true, default: 0, serverOnly: true },
      pack_bytes: { type: "integer", required: true, default: 0, serverOnly: true },
      pack_version: { type: "integer", required: true, default: 1, serverOnly: true },
      prev_pack_hash: { type: "text", serverOnly: true },
      scanned_at: { type: "text", serverOnly: true },
    },
  },
  /** One AI-identified game/movie/software found within a disc, anchored to a top-level folder. */
  disc_item: {
    name: "disc_item",
    primaryKey: "id",
    primaryKeyType: "text",
    primaryKeyKind: "uuid",
    columns: {
      disc_no: { type: "integer", required: true, references: "disc" },
      path: { type: "text", required: true },
      content_type: { type: "text", required: true },
      title: { type: "text" },
      platform: { type: "text" },
      publisher: { type: "text" },
      developer: { type: "text" },
      year: { type: "text" },
      genres: { type: "json" },
      description: { type: "text" },
      label: { type: "text" },
      summary: { type: "text" },
      confidence: { type: "text", required: true },
      model: { type: "text", required: true },
      analyzed_at: { type: "text", required: true },
      /** Resolved preview-image URL from an external provider (§ image preview), null until looked up or if no match was found. */
      image_url: { type: "text" },
    },
  },
  tag: {
    name: "tag",
    primaryKey: "id",
    primaryKeyType: "text",
    primaryKeyKind: "uuid",
    columns: {
      name: { type: "text", required: true },
      color: { type: "text" },
    },
  },
  tag_link: {
    name: "tag_link",
    primaryKey: "id",
    primaryKeyType: "text",
    primaryKeyKind: "uuid",
    columns: {
      tag_id: { type: "text", required: true, references: "tag" },
      item_key: { type: "text", required: true, itemKey: true },
    },
  },
  item_note: {
    name: "item_note",
    primaryKey: "item_key",
    primaryKeyType: "text",
    primaryKeyKind: "item_key",
    columns: {
      body: { type: "text", required: true },
    },
  },
  saved_search: {
    name: "saved_search",
    primaryKey: "id",
    primaryKeyType: "text",
    primaryKeyKind: "uuid",
    columns: {
      name: { type: "text", required: true },
      query_json: { type: "json", required: true },
      pinned: { type: "integer", default: 0 },
    },
  },
  category_override: {
    name: "category_override",
    primaryKey: "ext",
    primaryKeyType: "text",
    primaryKeyKind: "ext",
    columns: {
      category: { type: "text", required: true },
    },
  },
};

export function isSyncedTableName(name: string): name is SyncedTableName {
  return (SYNCED_TABLE_NAMES as readonly string[]).includes(name);
}

/** `CREATE TABLE` for a synced table. Identical on devices and in vault Durable Objects. */
export function syncedTableDDL(def: SyncedTableDef): string {
  const pk = def.primaryKeyType === "integer" ? `${def.primaryKey} INTEGER PRIMARY KEY` : `${def.primaryKey} TEXT PRIMARY KEY`;
  const cols = Object.entries(def.columns).map(([name, col]) => {
    const sqlType = col.type === "integer" ? "INTEGER" : "TEXT";
    const notNull = col.required ? " NOT NULL" : "";
    const dflt =
      col.default === undefined
        ? ""
        : typeof col.default === "number"
          ? ` DEFAULT ${col.default}`
          : ` DEFAULT '${col.default.replace(/'/g, "''")}'`;
    return `  ${name} ${sqlType}${notNull}${dflt}`;
  });
  return [
    `CREATE TABLE IF NOT EXISTS ${def.name} (`,
    `  ${pk},`,
    ...cols.map((c) => `${c},`),
    "  created_at TEXT NOT NULL,",
    "  updated_at TEXT NOT NULL,",
    "  deleted_at TEXT,",
    "  version INTEGER NOT NULL DEFAULT 0",
    ");",
  ].join("\n");
}

/** Indexes on synced tables, shared by devices and vaults. */
export const SYNCED_TABLE_INDEXES = [
  ...SYNCED_TABLE_NAMES.map((t) => `CREATE INDEX IF NOT EXISTS ${t}_version_idx ON ${t} (version)`),
  "CREATE INDEX IF NOT EXISTS tag_link_item_idx ON tag_link (item_key)",
  "CREATE INDEX IF NOT EXISTS tag_link_tag_idx ON tag_link (tag_id)",
  "CREATE INDEX IF NOT EXISTS disc_item_disc_idx ON disc_item (disc_no)",
  "CREATE INDEX IF NOT EXISTS disc_item_content_type_idx ON disc_item (content_type)",
];
