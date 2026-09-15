import { nodeSqlDb } from "@discvault/schema/node";
import { buildPack, parsePackPart } from "@discvault/sync-protocol";
import { describe, expect, it } from "vitest";
import type { DiscItemDraft } from "../src/ai/classification.js";
import { buildDiscAiSummary, MAX_AI_SUMMARY_ENTRIES } from "../src/db/catalog.js";
import {
  discNosWithItems,
  getDiscItemImageBlob,
  insertDiscItem,
  itemsByContentType,
  itemTypeCounts,
  listDiscItems,
  removeDiscItem,
  replaceDiscItems,
  saveDiscItemImageBlob,
  setDiscItemImageUrl,
} from "../src/db/disc-items.js";
import { prepareLocalDb } from "../src/db/local-db.js";
import { importPackParts, removeDiscCatalog } from "../src/db/packs.js";
import { applyChanges, deleteRow, writeRow } from "../src/db/rows.js";
import { catalogStats, searchFiles } from "../src/db/search.js";

function freshDb() {
  const db = nodeSqlDb();
  prepareLocalDb(db);
  return db;
}

function draft(overrides: Partial<DiscItemDraft> = {}): DiscItemDraft {
  return {
    path: "Games/Half-Life 2",
    contentType: "game",
    title: "Half-Life 2",
    platform: "Windows",
    publisher: "Valve",
    developer: "Valve",
    year: "2004",
    genres: ["FPS", "Sci-fi"],
    description: "A landmark first-person shooter.",
    label: "Game",
    summary: "A single PC game install.",
    confidence: "high",
    model: "gemini-3.6-flash",
    analyzedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("prepareLocalDb", () => {
  it("migrates a fresh database and is idempotent", () => {
    const db = freshDb();
    expect(prepareLocalDb(db)).toBe(4);
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

describe("buildDiscAiSummary", () => {
  it("returns every folder and file path at every depth, not just top-level", async () => {
    const db = freshDb();
    writeRow(db, "disc", "8", { title: "Two games" });
    const pack = await buildPack({
      disc_no: 8,
      scanned_at: "2026-01-01T00:00:00.000Z",
      built_at: "2026-01-01T00:00:00.000Z",
      folders: [
        { id: 1, parent: null, name: "Games", size_kb: 0, created: "2020-01-01" },
        { id: 2, parent: 1, name: "Half-Life 2", size_kb: 0, created: "2020-01-01" },
      ],
      files: [{ folder: 2, name: "hl2.exe", size_kb: 50, created: "2020-01-01" }],
    });
    const parts = await Promise.all(pack.parts.map((p) => parsePackPart(p.data)));
    importPackParts(db, 8, pack.pack_hash, parts);

    const summary = buildDiscAiSummary(db, 8);
    expect(summary?.allFolderPaths).toEqual(["Games", "Games/Half-Life 2"]);
    expect(summary?.allFilePaths).toEqual(["Games/Half-Life 2/hl2.exe"]);
  });

  it("throws when a disc's folder+file count exceeds the size cap", () => {
    const db = freshDb();
    writeRow(db, "disc", "9", { title: "Huge disc" });
    db.run("UPDATE disc SET folder_count = ?, file_count = ? WHERE disc_no = 9", [MAX_AI_SUMMARY_ENTRIES, 1]);
    expect(() => buildDiscAiSummary(db, 9)).toThrow(/too many/);
  });

  it("does not throw just under the size cap", () => {
    const db = freshDb();
    writeRow(db, "disc", "9", { title: "Big disc" });
    db.run("UPDATE disc SET folder_count = ?, file_count = ? WHERE disc_no = 9", [MAX_AI_SUMMARY_ENTRIES - 1, 0]);
    expect(() => buildDiscAiSummary(db, 9)).not.toThrow();
  });
});

describe("disc items", () => {
  it("saves a draft and reads it back, round-tripping genres", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Mixed disc" });
    const id = insertDiscItem(db, 1, draft());
    const items = listDiscItems(db, 1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, discNo: 1, title: "Half-Life 2", genres: ["FPS", "Sci-fi"] });
  });

  it("lists several items on the same disc, ordered by path", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Mixed disc" });
    insertDiscItem(db, 1, draft({ path: "Movies/Inception", title: "Inception", contentType: "movie" }));
    insertDiscItem(db, 1, draft({ path: "Games/Half-Life 2" }));
    const items = listDiscItems(db, 1);
    expect(items.map((i) => i.title)).toEqual(["Half-Life 2", "Inception"]);
  });

  it("groups counts by content type across discs", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Disc 1" });
    writeRow(db, "disc", "2", { title: "Disc 2" });
    insertDiscItem(db, 1, draft());
    insertDiscItem(db, 2, draft({ path: "", title: "Portal 2" }));
    insertDiscItem(db, 2, draft({ path: "Movies/Inception", title: "Inception", contentType: "movie" }));
    const counts = itemTypeCounts(db);
    expect(counts).toEqual(
      expect.arrayContaining([
        { contentType: "game", count: 2 },
        { contentType: "movie", count: 1 },
      ]),
    );
  });

  it("joins the source disc's label when listing by content type", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "My Game Disc" });
    insertDiscItem(db, 1, draft());
    const items = itemsByContentType(db, "game");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Half-Life 2", discNo: 1, discTitle: "My Game Disc" });
  });

  it("soft-deletes an item", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Disc" });
    const id = insertDiscItem(db, 1, draft());
    removeDiscItem(db, id);
    expect(listDiscItems(db, 1)).toEqual([]);
  });

  it("replaces a disc's items on re-analysis instead of duplicating them", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Disc" });
    insertDiscItem(db, 1, draft());
    insertDiscItem(db, 1, draft({ path: "Movies/Inception", title: "Inception", contentType: "movie" }));

    replaceDiscItems(db, 1, [draft({ title: "Half-Life 2", genres: ["FPS"] })]);

    const items = listDiscItems(db, 1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Half-Life 2", genres: ["FPS"] });
  });

  it("clears a disc's items when a re-analysis finds nothing", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Disc" });
    insertDiscItem(db, 1, draft());

    replaceDiscItems(db, 1, []);

    expect(listDiscItems(db, 1)).toEqual([]);
  });

  it("does not touch another disc's items when replacing one disc's", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Disc 1" });
    writeRow(db, "disc", "2", { title: "Disc 2" });
    insertDiscItem(db, 1, draft());
    insertDiscItem(db, 2, draft({ path: "", title: "Portal 2" }));

    replaceDiscItems(db, 1, [draft({ title: "Half-Life 2: Episode One" })]);

    expect(listDiscItems(db, 1).map((i) => i.title)).toEqual(["Half-Life 2: Episode One"]);
    expect(listDiscItems(db, 2).map((i) => i.title)).toEqual(["Portal 2"]);
  });

  it("lists disc numbers that already have an item, for the library's bulk analyze to skip", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Disc 1" });
    writeRow(db, "disc", "2", { title: "Disc 2" });
    writeRow(db, "disc", "3", { title: "Disc 3" });
    const id = insertDiscItem(db, 1, draft());
    insertDiscItem(db, 2, draft({ path: "", title: "Portal 2" }));
    expect(discNosWithItems(db)).toEqual(expect.arrayContaining([1, 2]));

    removeDiscItem(db, id);
    expect(discNosWithItems(db)).toEqual([2]);
  });

  it("sets a resolved preview-image URL, visible via listDiscItems", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Disc" });
    const id = insertDiscItem(db, 1, draft());
    expect(listDiscItems(db, 1)[0]?.imageUrl).toBeNull();

    setDiscItemImageUrl(db, id, "https://image.tmdb.org/t/p/w500/poster.jpg");
    expect(listDiscItems(db, 1)[0]?.imageUrl).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
  });

  it("round-trips cached preview-image bytes and replaces them on a second save", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Disc" });
    const id = insertDiscItem(db, 1, draft());
    expect(getDiscItemImageBlob(db, id)).toBeNull();

    saveDiscItemImageBlob(db, id, "image/jpeg", new Uint8Array([1, 2, 3]));
    const first = getDiscItemImageBlob(db, id);
    expect(first?.contentType).toBe("image/jpeg");
    expect(Array.from(first?.data ?? [])).toEqual([1, 2, 3]);

    saveDiscItemImageBlob(db, id, "image/png", new Uint8Array([4, 5]));
    const second = getDiscItemImageBlob(db, id);
    expect(second?.contentType).toBe("image/png");
    expect(Array.from(second?.data ?? [])).toEqual([4, 5]);
  });

  it("clears an item's cached preview-image bytes when the item is removed", () => {
    const db = freshDb();
    writeRow(db, "disc", "1", { title: "Disc" });
    const id = insertDiscItem(db, 1, draft());
    saveDiscItemImageBlob(db, id, "image/jpeg", new Uint8Array([1, 2, 3]));

    removeDiscItem(db, id);

    expect(getDiscItemImageBlob(db, id)).toBeNull();
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
