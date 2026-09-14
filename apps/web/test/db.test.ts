import { nodeSqlDb } from "@discvault/schema/node";
import { buildPack, parsePackPart } from "@discvault/sync-protocol";
import { describe, expect, it } from "vitest";
import { prepareLocalDb } from "../src/db/local-db.js";
import { importPackParts, removeDiscCatalog } from "../src/db/packs.js";
import { applyChanges, deleteRow, writeRow } from "../src/db/rows.js";
import { catalogStats, searchFiles } from "../src/db/search.js";

function freshDb() {
  const db = nodeSqlDb();
  prepareLocalDb(db);
  return db;
}

describe("prepareLocalDb", () => {
  it("migrates a fresh database and is idempotent", () => {
    const db = freshDb();
    expect(prepareLocalDb(db)).toBe(2);
    expect(db.get<{ code: string }>("SELECT code FROM disc_status WHERE code = 'available'")).toBeDefined();
  });
});

describe("writeRow / deleteRow", () => {
  it("inserts a new row and enqueues an outbox entry", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Test Disc", status: "available" });
    const disc = db.get<{ title: string }>("SELECT title FROM disc WHERE disc_no = 1");
    expect(disc?.title).toBe("Test Disc");
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM outbox")?.n).toBe(1);
  });

  it("updates an existing row without duplicating it", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "First" });
    writeRow(db, "disc", "1", { title: "Second" });
    expect(db.all("SELECT * FROM disc WHERE disc_no = 1")).toHaveLength(1);
    expect(db.get<{ title: string }>("SELECT title FROM disc WHERE disc_no = 1")?.title).toBe("Second");
  });

  it("rejects an unknown column", () => {
    const db = freshDb();
    expect(() => writeRow(db, "disc", "1", { nope: "x" })).toThrow(/unknown column/);
  });

  it("marks a row deleted and enqueues the delete", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Doomed" });
    deleteRow(db, "disc", "1");
    const disc = db.get<{ deleted_at: string | null }>("SELECT deleted_at FROM disc WHERE disc_no = 1");
    expect(disc?.deleted_at).not.toBeNull();
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM outbox")?.n).toBe(2);
  });
});

describe("applyChanges", () => {
  it("applies a pulled row and re-applies a pending local edit on top", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Local edit", status: "available" });

    applyChanges(db, [
      {
        seq: 5,
        table: "disc",
        rowId: "1",
        op: "upsert",
        row: {
          disc_no: 1,
          title: "Server title",
          status: "available",
          folder_count: 3,
          file_count: 10,
          total_kb: 500,
          pack_parts: 0,
          pack_bytes: 0,
          pack_version: 1,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          deleted_at: null,
          version: 5,
        },
        at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const disc = db.get<{ title: string; version: number }>("SELECT title, version FROM disc WHERE disc_no = 1");
    expect(disc?.version).toBe(5);
    expect(disc?.title).toBe("Local edit");
  });

  it("flags a disc for refresh when the server pack hash changes", () => {
    const db = freshDb();
    const result = applyChanges(db, [
      {
        seq: 1,
        table: "disc",
        rowId: "2",
        op: "upsert",
        row: {
          disc_no: 2,
          status: "available",
          folder_count: 0,
          file_count: 0,
          total_kb: 0,
          pack_hash: "abc123",
          pack_parts: 1,
          pack_bytes: 100,
          pack_version: 1,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          deleted_at: null,
          version: 1,
        },
        at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(result.discsToRefresh).toEqual([2]);
  });
});

describe("pack import, search and stats", () => {
  it("imports a built pack and makes its files searchable", async () => {
    const db = freshDb();
    writeRow(db, "disc", "7", { title: "Movies", status: "available" });

    const pack = await buildPack({
      disc_no: 7,
      scanned_at: "2026-01-01T00:00:00.000Z",
      built_at: "2026-01-01T00:00:00.000Z",
      folders: [{ id: 1, parent: null, name: "Videos", size_kb: 1000, created: "2020-01-01" }],
      files: [
        { folder: 1, name: "VanHelsing2004.mkv", size_kb: 900, created: "2020-01-01" },
        { folder: null, name: "readme.txt", size_kb: 1, created: "2020-01-01" },
      ],
    });

    const parts = await Promise.all(pack.parts.map((p) => parsePackPart(p.data)));
    const { folders, files } = importPackParts(db, 7, pack.pack_hash, parts);
    expect(folders).toBe(1);
    expect(files).toBe(2);

    const hits = searchFiles(db, "helsing");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.rel_path).toBe("Videos/VanHelsing2004.mkv");
    expect(hits[0]?.title).toBe("Movies");

    expect(searchFiles(db, "re")).toHaveLength(1); // short query falls back to LIKE

    const stats = catalogStats(db);
    expect(stats.discs).toBe(1);
    expect(stats.files).toBe(2);
    expect(stats.folders).toBe(1);

    removeDiscCatalog(db, 7);
    expect(catalogStats(db).files).toBe(0);
  });
});
