import type { Migration, SqlDb, SqlValue } from "@discvault/schema";

/** `SqlDb` over a Durable Object's SQLite storage. */
export function durableSqlDb(storage: DurableObjectStorage): SqlDb {
  const sql = storage.sql;
  let depth = 0;
  return {
    exec: (query) => {
      sql.exec(query);
    },
    run: (query, params = []) => {
      const cursor = sql.exec(query, ...params);
      cursor.toArray();
      return { changes: cursor.rowsWritten };
    },
    all: <T>(query: string, params: SqlValue[] = []) => sql.exec(query, ...params).toArray() as T[],
    get: <T>(query: string, params: SqlValue[] = []) => sql.exec(query, ...params).toArray()[0] as T | undefined,
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      depth++;
      try {
        return storage.transactionSync(fn);
      } finally {
        depth--;
      }
    },
  };
}

/** Migration version kept in a table (Durable Object SQLite does not expose `PRAGMA user_version`). */
export function tableVersionStore(db: SqlDb): { get(): number; set(version: number): void } {
  db.exec("CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL)");
  return {
    get: () => Number(db.get<{ version: number }>("SELECT max(version) AS version FROM _schema_version")?.version ?? 0),
    set: (version) => {
      db.run("DELETE FROM _schema_version");
      db.run("INSERT INTO _schema_version (version) VALUES (?)", [version]);
    },
  };
}

export type { Migration };
