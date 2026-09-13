import { describe, expect, it } from "vitest";
import {
  buildPack,
  extensionOf,
  fileKey,
  folderKey,
  isUuid,
  isValidCatalogDate,
  packHashOf,
  parseItemKey,
  parsePackPart,
  SYNCED_TABLES,
  syncedTableDDL,
  toRelPath,
  uuidv7,
  validateFields,
  validateRowId,
} from "../src/index.js";

describe("ids and keys", () => {
  it("generates time-ordered UUIDv7s", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe("7");
    expect(a < b).toBe(true);
  });

  it("builds and parses item keys", () => {
    expect(folderKey(116, "Movies/Constantine")).toBe("p:116:movies/constantine");
    expect(parseItemKey(fileKey(116, "Movies/Constantine/CD1.avi"))).toEqual({
      kind: "file",
      discNo: 116,
      path: "movies/constantine/cd1.avi",
    });
    expect(parseItemKey("d:116")).toEqual({ kind: "disc", discNo: 116 });
    expect(parseItemKey("x:1")).toBeNull();
  });
});

describe("paths and dates", () => {
  it("strips drive letters and normalizes separators", () => {
    expect(toRelPath("G:\\Movies\\Constantine\\")).toBe("Movies/Constantine");
    expect(toRelPath("G:\\A7.ico")).toBe("A7.ico");
    expect(extensionOf("Constantine.AVI")).toBe("avi");
    expect(extensionOf(".hidden")).toBeNull();
    expect(extensionOf("README")).toBeNull();
  });

  it("flags impossible and future dates", () => {
    const builtAt = "2026-09-13T00:00:00Z";
    expect(isValidCatalogDate("2009-05-13 02:23:16", builtAt)).toBe(true);
    expect(isValidCatalogDate("1900-01-00 00:00:00", builtAt)).toBe(false);
    expect(isValidCatalogDate("2010-02-30 00:00:00", builtAt)).toBe(false);
    expect(isValidCatalogDate("2027-09-26 10:30:00", builtAt)).toBe(false);
    expect(isValidCatalogDate(null, builtAt)).toBe(false);
  });
});

describe("validation", () => {
  it("accepts schema columns and rejects others", () => {
    expect(validateFields("disc", { title: "Movies 1", status: "available" }).ok).toBe(true);
    expect(validateFields("disc", { pack_hash: "x" }).ok).toBe(false);
    expect(validateFields("disc", { version: 3 }).ok).toBe(false);
    expect(validateFields("user", {}).ok).toBe(false);
    expect(validateFields("tag_link", { tag_id: "nope", item_key: "d:1" }).ok).toBe(false);
    expect(validateFields("tag_link", { tag_id: uuidv7(), item_key: "bad" }).ok).toBe(false);
    expect(validateFields("saved_search", { name: "x", query_json: { q: "a" } })).toMatchObject({
      ok: true,
      value: { values: { query_json: '{"q":"a"}' } },
    });
  });

  it("validates row ids per table", () => {
    expect(validateRowId("disc", "116")).toEqual({ ok: true, value: 116 });
    expect(validateRowId("disc", "0").ok).toBe(false);
    expect(validateRowId("tag", "1").ok).toBe(false);
    expect(validateRowId("item_note", "f:1:a.txt").ok).toBe(true);
  });

  it("produces DDL for every synced table", () => {
    for (const def of Object.values(SYNCED_TABLES)) {
      expect(syncedTableDDL(def)).toContain(`CREATE TABLE IF NOT EXISTS ${def.name}`);
    }
  });
});

describe("packs", () => {
  it("round-trips folders and files", async () => {
    const pack = await buildPack({
      disc_no: 116,
      scanned_at: "2010-07-16T00:00:00Z",
      built_at: "2026-09-13T00:00:00Z",
      folders: [
        { id: 20, parent: 10, name: "CD1", size_kb: 700, created: null },
        { id: 10, parent: null, name: "Constantine", size_kb: 1400, created: "2009-05-13 02:23:16" },
      ],
      files: [
        { folder: 20, name: "cd1.avi", size_kb: 700, created: "2009-05-13 02:20:01" },
        { folder: null, name: "Autorun.inf", size_kb: 0, created: null },
      ],
    });
    expect(pack.parts).toHaveLength(1);
    expect(pack.folder_count).toBe(2);
    expect(pack.total_kb).toBe(700);
    expect(pack.pack_hash).toBe(await packHashOf(pack.parts.map((p) => p.hash)));

    const part = await parsePackPart(pack.parts[0]?.data ?? new Uint8Array());
    expect(part.folders.map((f) => [f.id, f.parent, f.name])).toEqual([
      [1, null, "Constantine"],
      [2, 1, "CD1"],
    ]);
    expect(part.files).toContainEqual({ folder: 2, name: "cd1.avi", size_kb: 700, created: "2009-05-13 02:20:01" });
    expect(part.files).toContainEqual({ folder: null, name: "Autorun.inf", size_kb: 0, created: null });
  });

  it("splits large discs into parts without splitting a folder", async () => {
    const folders = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, parent: null, name: `F${i}`, size_kb: 1, created: null }));
    const files = folders.flatMap((f) =>
      Array.from({ length: 5000 }, (_, j) => ({
        folder: f.id,
        name: `${"x".repeat(40)}-${j}.bin`,
        size_kb: j,
        created: "2010-01-01 00:00:00",
      })),
    );
    const pack = await buildPack({ disc_no: 1, scanned_at: null, built_at: "2026-01-01T00:00:00Z", folders, files });
    expect(pack.parts.length).toBeGreaterThan(1);
    const parsed = await Promise.all(pack.parts.map((p) => parsePackPart(p.data)));
    expect(parsed[0]?.folders).toHaveLength(40);
    expect(parsed.slice(1).every((p) => p.folders.length === 0)).toBe(true);
    const seen = new Map<number | null, number>();
    for (const p of parsed) {
      for (const folder of new Set(p.files.map((f) => f.folder))) {
        expect(seen.has(folder)).toBe(false);
        seen.set(folder, p.part);
      }
    }
    expect(parsed.reduce((n, p) => n + p.files.length, 0)).toBe(200_000);
  });
});
