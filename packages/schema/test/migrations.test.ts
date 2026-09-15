import { describe, expect, it } from "vitest";
import { CLIENT_MIGRATIONS, migrate, userVersionStore, VAULT_MIGRATIONS } from "../src/index.js";
import { nodeSqlDb } from "../src/node-sqlite.js";

describe("migrations", () => {
  it("creates the client schema with trigram search", () => {
    const db = nodeSqlDb();
    expect(migrate(db, CLIENT_MIGRATIONS, userVersionStore(db))).toBe(4);
    db.run("INSERT INTO file (disc_no, name, rel_path) VALUES (116, 'VanHelsing2004[DvdRip].avi', 'x')");
    const hits = db.all<{ name: string }>(
      "SELECT f.name FROM file_fts s JOIN file f ON f.file_id = s.rowid WHERE file_fts MATCH 'helsing'",
    );
    expect(hits.map((h) => h.name)).toEqual(["VanHelsing2004[DvdRip].avi"]);
    expect(migrate(db, CLIENT_MIGRATIONS, userVersionStore(db))).toBe(4);
  });

  it("creates the vault schema", () => {
    const db = nodeSqlDb();
    migrate(db, VAULT_MIGRATIONS, userVersionStore(db));
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["disc", "disc_item", "tag_link", "change_log", "pack_part", "quota_usage"]));
  });

  it("drops the location/collection/loan tables and disc's location columns on a fresh install", () => {
    const clientDb = nodeSqlDb();
    migrate(clientDb, CLIENT_MIGRATIONS, userVersionStore(clientDb));
    const clientTables = clientDb.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(clientTables).not.toEqual(
      expect.arrayContaining([
        "location",
        "collection",
        "collection_item",
        "borrower",
        "loan",
        "location_kind",
        "stats_cache",
        "dup_cache",
      ]),
    );
    const discCols = clientDb.all<{ name: string }>("PRAGMA table_info(disc)").map((c) => c.name);
    expect(discCols).not.toEqual(expect.arrayContaining(["location_id", "location_slot"]));

    const vaultDb = nodeSqlDb();
    migrate(vaultDb, VAULT_MIGRATIONS, userVersionStore(vaultDb));
    const vaultTables = vaultDb.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(vaultTables).not.toEqual(expect.arrayContaining(["location", "collection", "collection_item", "borrower", "loan"]));
  });

  it("migrates an existing v1 database (with the old location/collection/loan tables) up to v2", () => {
    const db = nodeSqlDb();
    // Mirrors what shipped in v1 before phase-4 tables were dropped: create the old schema
    // directly, mark it as already-migrated to v1, then run the current migration list.
    db.exec(
      `CREATE TABLE disc (disc_no INTEGER PRIMARY KEY, location_id TEXT, location_slot TEXT, title TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 0)`,
    );
    db.exec("CREATE INDEX disc_location_idx ON disc (location_id)");
    db.exec(`CREATE TABLE location (id TEXT PRIMARY KEY, name TEXT)`);
    db.exec(`CREATE TABLE collection (id TEXT PRIMARY KEY, name TEXT)`);
    db.exec(`CREATE TABLE collection_item (id TEXT PRIMARY KEY, collection_id TEXT)`);
    db.exec(`CREATE TABLE borrower (id TEXT PRIMARY KEY, name TEXT)`);
    db.exec(`CREATE TABLE loan (id TEXT PRIMARY KEY, disc_no INTEGER)`);
    db.run(
      "INSERT INTO disc (disc_no, location_id, location_slot, title, created_at, updated_at) VALUES (1, NULL, 'Wallet 1', 'Test', 'x', 'x')",
    );
    const store = userVersionStore(db);
    store.set(1);

    migrate(db, VAULT_MIGRATIONS, store);

    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables).not.toEqual(expect.arrayContaining(["location", "collection", "collection_item", "borrower", "loan"]));
    const discCols = db.all<{ name: string }>("PRAGMA table_info(disc)").map((c) => c.name);
    expect(discCols).not.toEqual(expect.arrayContaining(["location_id", "location_slot"]));
    expect(db.get<{ title: string }>("SELECT title FROM disc WHERE disc_no = 1")?.title).toBe("Test");
  });

  it("backfills disc_item onto a client database already migrated past v1, without disturbing its data", () => {
    const db = nodeSqlDb();
    // A device that installed before disc_item existed: run only v1 and v2, same as it would have.
    migrate(
      db,
      CLIENT_MIGRATIONS.filter((m) => m.version <= 2),
      userVersionStore(db),
    );
    db.run("INSERT INTO disc (disc_no, title, status, created_at, updated_at) VALUES (1, 'Old disc', 'available', 'x', 'x')");

    expect(migrate(db, CLIENT_MIGRATIONS, userVersionStore(db))).toBe(4);

    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["disc_item"]));
    expect(db.get<{ title: string }>("SELECT title FROM disc WHERE disc_no = 1")?.title).toBe("Old disc");
  });

  it("backfills disc_item onto a vault database already migrated past v1, without disturbing its data", () => {
    const db = nodeSqlDb();
    migrate(
      db,
      VAULT_MIGRATIONS.filter((m) => m.version <= 2),
      userVersionStore(db),
    );
    db.run("INSERT INTO disc (disc_no, title, status, created_at, updated_at) VALUES (1, 'Old disc', 'available', 'x', 'x')");

    expect(migrate(db, VAULT_MIGRATIONS, userVersionStore(db))).toBe(4);

    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["disc_item"]));
    expect(db.get<{ title: string }>("SELECT title FROM disc WHERE disc_no = 1")?.title).toBe("Old disc");
  });

  it("adds disc_item.image_url and the client-only disc_item_image cache table on a fresh install", () => {
    const clientDb = nodeSqlDb();
    expect(migrate(clientDb, CLIENT_MIGRATIONS, userVersionStore(clientDb))).toBe(4);
    const discItemCols = clientDb.all<{ name: string }>("PRAGMA table_info(disc_item)").map((c) => c.name);
    expect(discItemCols).toEqual(expect.arrayContaining(["image_url"]));
    const clientTables = clientDb.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(clientTables).toEqual(expect.arrayContaining(["disc_item_image"]));

    const vaultDb = nodeSqlDb();
    expect(migrate(vaultDb, VAULT_MIGRATIONS, userVersionStore(vaultDb))).toBe(4);
    const vaultDiscItemCols = vaultDb.all<{ name: string }>("PRAGMA table_info(disc_item)").map((c) => c.name);
    expect(vaultDiscItemCols).toEqual(expect.arrayContaining(["image_url"]));
    // disc_item_image caches downloaded bytes and is deliberately local-only — never in the vault DO.
    const vaultTables = vaultDb.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(vaultTables).not.toEqual(expect.arrayContaining(["disc_item_image"]));
  });

  it("backfills disc_item.image_url onto a client database already migrated past v3, without disturbing its data", () => {
    const db = nodeSqlDb();
    migrate(
      db,
      CLIENT_MIGRATIONS.filter((m) => m.version <= 3),
      userVersionStore(db),
    );
    db.run("INSERT INTO disc (disc_no, title, status, created_at, updated_at) VALUES (1, 'Old disc', 'available', 'x', 'x')");
    db.run(
      `INSERT INTO disc_item (id, disc_no, path, content_type, confidence, model, analyzed_at, created_at, updated_at)
       VALUES ('018f0000-0000-7000-8000-000000000001', 1, '', 'movie', 'high', 'test', 'x', 'x', 'x')`,
    );

    expect(migrate(db, CLIENT_MIGRATIONS, userVersionStore(db))).toBe(4);

    const cols = db.all<{ name: string }>("PRAGMA table_info(disc_item)").map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["image_url"]));
    expect(db.get<{ image_url: string | null }>("SELECT image_url FROM disc_item WHERE disc_no = 1")?.image_url).toBeNull();
    expect(db.get<{ title: string }>("SELECT title FROM disc WHERE disc_no = 1")?.title).toBe("Old disc");
  });
});
