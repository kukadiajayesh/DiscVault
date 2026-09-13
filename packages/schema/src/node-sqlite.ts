import { DatabaseSync } from "node:sqlite";
import type { SqlDb, SqlValue } from "./sql-db.js";

/** `SqlDb` over Node's built-in SQLite, for tests and tools. */
export function nodeSqlDb(path = ":memory:"): SqlDb & { close(): void } {
  const db = new DatabaseSync(path);
  let depth = 0;
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => ({ changes: Number(db.prepare(sql).run(...(params as never[])).changes) }),
    all: <T>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    get: <T>(sql: string, params: SqlValue[] = []) => db.prepare(sql).get(...(params as never[])) as T | undefined,
    transaction<T>(fn: () => T): T {
      const name = `sp${depth++}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn();
        db.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw error;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
}
