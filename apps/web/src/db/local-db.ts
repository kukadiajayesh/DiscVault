import { CLIENT_MIGRATIONS, migrate, type SqlDb, userVersionStore } from "@discvault/schema";

/** Brings a vault's local database up to the current schema. Runs on every app start. */
export function prepareLocalDb(db: SqlDb): number {
  db.exec("PRAGMA foreign_keys = ON");
  return migrate(db, CLIENT_MIGRATIONS, userVersionStore(db));
}

export type SyncStateKey = "vault_id" | "user_id" | "device_id" | "last_seq" | "last_sync_at" | "paused_until" | "last_error";

export function getState(db: SqlDb, key: SyncStateKey): string | null {
  return db.get<{ value: string | null }>("SELECT value FROM sync_state WHERE key = ?", [key])?.value ?? null;
}

export function setState(db: SqlDb, key: SyncStateKey, value: string | number | null): void {
  db.run("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
    key,
    value === null ? null : String(value),
  ]);
}

export function nowIso(): string {
  return new Date().toISOString();
}
