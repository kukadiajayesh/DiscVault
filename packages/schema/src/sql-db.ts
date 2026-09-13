export type SqlValue = string | number | bigint | Uint8Array | null;

/**
 * The small synchronous SQLite surface the catalog code needs. Implemented over SQLite WASM in the
 * browser worker, `ctx.storage.sql` in Durable Objects and `node:sqlite` in tests and tools.
 */
export interface SqlDb {
  exec(sql: string): void;
  run(sql: string, params?: SqlValue[]): { changes: number };
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): T[];
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): T | undefined;
  /** Runs `fn` in one transaction; rolls back if it throws. */
  transaction<T>(fn: () => T): T;
}

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

/** Applies migrations newer than the stored version. Migrations only ever add (§5.3). */
export function migrate(db: SqlDb, migrations: Migration[], store: { get(): number; set(version: number): void }): number {
  let current = store.get();
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue;
    db.transaction(() => {
      for (const statement of m.statements) db.exec(statement);
      store.set(m.version);
    });
    current = m.version;
  }
  return current;
}

/** `PRAGMA user_version` as the migration store (devices, tools). */
export function userVersionStore(db: SqlDb): { get(): number; set(version: number): void } {
  return {
    get: () => Number(db.get<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0),
    set: (version) => db.exec(`PRAGMA user_version = ${Math.trunc(version)}`),
  };
}
