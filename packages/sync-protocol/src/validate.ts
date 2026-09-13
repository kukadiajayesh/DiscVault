import { isItemKey } from "./item-key.js";
import { isSyncedTableName, SYNCED_TABLES, type SyncedTableDef, type SyncedTableName } from "./tables.js";
import { isUuid } from "./uuid.js";

export type FieldValue = string | number | null;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_TEXT_LENGTH = 20_000;
const EXT_RE = /^[a-z0-9_+-]{1,32}$/;

/** Checks a primary key value and returns it in the form stored in SQLite. */
export function validateRowId(table: SyncedTableName, rowId: string): ValidationResult<string | number> {
  const def = SYNCED_TABLES[table];
  switch (def.primaryKeyKind) {
    case "uuid":
      return isUuid(rowId) ? { ok: true, value: rowId } : { ok: false, error: "row_id must be a UUID" };
    case "disc_no": {
      if (!/^\d{1,9}$/.test(rowId)) return { ok: false, error: "disc_no must be a positive integer" };
      const n = Number(rowId);
      return n >= 1 ? { ok: true, value: n } : { ok: false, error: "disc_no must be ≥ 1" };
    }
    case "item_key":
      return isItemKey(rowId) ? { ok: true, value: rowId } : { ok: false, error: "row_id must be an item key" };
    case "ext":
      return EXT_RE.test(rowId) ? { ok: true, value: rowId } : { ok: false, error: "row_id must be an extension" };
  }
}

/**
 * Validates client-pushed fields against the table definition. Unknown, system and server-only
 * columns are rejected, so a client can only ever write what the schema allows.
 */
export function validateFields(
  tableName: string,
  fields: Record<string, unknown>,
): ValidationResult<{ def: SyncedTableDef; values: Record<string, FieldValue> }> {
  if (!isSyncedTableName(tableName)) return { ok: false, error: `unknown table ${tableName}` };
  const def = SYNCED_TABLES[tableName];
  const values: Record<string, FieldValue> = {};
  for (const [name, raw] of Object.entries(fields)) {
    const col = def.columns[name];
    if (!col) return { ok: false, error: `unknown column ${tableName}.${name}` };
    if (col.serverOnly) return { ok: false, error: `column ${tableName}.${name} is set by the server` };
    if (raw === null || raw === undefined) {
      if (col.required) return { ok: false, error: `column ${tableName}.${name} is required` };
      values[name] = null;
      continue;
    }
    switch (col.type) {
      case "integer":
        if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
          return { ok: false, error: `column ${tableName}.${name} must be an integer` };
        }
        values[name] = raw;
        break;
      case "text":
        if (typeof raw !== "string" || raw.length > MAX_TEXT_LENGTH) {
          return { ok: false, error: `column ${tableName}.${name} must be a string` };
        }
        if (col.itemKey && !isItemKey(raw)) return { ok: false, error: `column ${tableName}.${name} must be an item key` };
        if (col.references && SYNCED_TABLES[col.references].primaryKeyKind === "uuid" && !isUuid(raw)) {
          return { ok: false, error: `column ${tableName}.${name} must be a UUID` };
        }
        values[name] = raw;
        break;
      case "json": {
        const text = typeof raw === "string" ? raw : JSON.stringify(raw);
        if (text.length > MAX_TEXT_LENGTH) return { ok: false, error: `column ${tableName}.${name} is too large` };
        try {
          JSON.parse(text);
        } catch {
          return { ok: false, error: `column ${tableName}.${name} must be JSON` };
        }
        values[name] = text;
        break;
      }
    }
  }
  return { ok: true, value: { def, values } };
}
