import { describe, expect, it } from "vitest";
import { CLIENT_MIGRATIONS, migrate, userVersionStore, VAULT_MIGRATIONS } from "../src/index.js";
import { nodeSqlDb } from "../src/node-sqlite.js";

describe("migrations", () => {
  it("creates the client schema with trigram search", () => {
    const db = nodeSqlDb();
    expect(migrate(db, CLIENT_MIGRATIONS, userVersionStore(db))).toBe(1);
    db.run("INSERT INTO file (disc_no, name, rel_path) VALUES (116, 'VanHelsing2004[DvdRip].avi', 'x')");
    const hits = db.all<{ name: string }>(
      "SELECT f.name FROM file_fts s JOIN file f ON f.file_id = s.rowid WHERE file_fts MATCH 'helsing'",
    );
    expect(hits.map((h) => h.name)).toEqual(["VanHelsing2004[DvdRip].avi"]);
    expect(migrate(db, CLIENT_MIGRATIONS, userVersionStore(db))).toBe(1);
  });

  it("creates the vault schema", () => {
    const db = nodeSqlDb();
    migrate(db, VAULT_MIGRATIONS, userVersionStore(db));
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["disc", "tag_link", "change_log", "pack_part", "quota_usage"]));
  });
});
