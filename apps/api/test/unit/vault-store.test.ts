import { migrate, userVersionStore, VAULT_MIGRATIONS } from "@discvault/schema";
import { nodeSqlDb } from "@discvault/schema/node";
import { buildPack, type PushEntry, uuidv7 } from "@discvault/sync-protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { VaultStore } from "../../src/vault/vault-store.js";

const VAULT = "0192d1a0-0000-7000-8000-000000000001";
const ctx = { userId: "user-a", deviceId: uuidv7() };

function entry(partial: Partial<PushEntry> & Pick<PushEntry, "table" | "rowId" | "op">): PushEntry {
  return { id: uuidv7(), fields: {}, baseVersion: 0, createdAt: "2026-09-13T10:00:00Z", ...partial };
}

describe("VaultStore", () => {
  let store: VaultStore;
  let clock = new Date("2026-09-13T10:00:00Z");

  beforeEach(() => {
    const db = nodeSqlDb();
    migrate(db, VAULT_MIGRATIONS, userVersionStore(db));
    clock = new Date("2026-09-13T10:00:00Z");
    store = new VaultStore(db, VAULT, () => clock);
  });

  it("applies upserts, bumps versions and serves changes", () => {
    const disc = entry({ table: "disc", rowId: "116", op: "upsert", fields: { title: "Movies 12" } });
    const out = store.push({ ...ctx, entries: [disc] });
    expect(out.results[0]).toMatchObject({ status: "applied", seq: 1, version: 1 });
    expect(store.head()).toBe(1);

    const changes = store.changes(0);
    expect(changes.changes).toHaveLength(1);
    expect(changes.changes[0]).toMatchObject({ table: "disc", rowId: "116", op: "upsert", seq: 1 });
    expect(changes.changes[0]?.row).toMatchObject({ title: "Movies 12", status: "available", version: 1 });
    expect(store.changes(1).changes).toHaveLength(0);
  });

  it("is idempotent for resent outbox entries", () => {
    const e = entry({ table: "tag", rowId: uuidv7(), op: "upsert", fields: { name: "movies" } });
    store.push({ ...ctx, entries: [e] });
    expect(store.push({ ...ctx, entries: [e] }).results[0]).toMatchObject({ status: "duplicate", seq: 1 });
    expect(store.head()).toBe(1);
  });

  it("rejects unknown columns, server-only columns and missing references", () => {
    const results = store.push({
      ...ctx,
      entries: [
        entry({ table: "disc", rowId: "1", op: "upsert", fields: { pack_hash: "a".repeat(64) } }),
        entry({ table: "disc", rowId: "1", op: "upsert", fields: { owner: "x" } }),
        entry({ table: "tag_link", rowId: uuidv7(), op: "upsert", fields: { tag_id: uuidv7(), item_key: "d:1" } }),
      ],
    }).results;
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(store.head()).toBe(0);
  });

  it("reports a conflict when two devices create the same disc number", () => {
    store.push({ ...ctx, entries: [entry({ table: "disc", rowId: "322", op: "upsert", fields: { title: "A" } })] });
    const second = store.push({ ...ctx, entries: [entry({ table: "disc", rowId: "322", op: "upsert", fields: { title: "B" } })] });
    expect(second.results[0]).toMatchObject({ status: "conflict", error: "disc_exists" });
    expect(second.results[0]?.theirs).toMatchObject({ title: "A" });
  });

  it("keeps overwritten values for last-write-wins updates", () => {
    store.push({ ...ctx, entries: [entry({ table: "disc", rowId: "5", op: "upsert", fields: { title: "Old" } })] });
    store.push({ ...ctx, entries: [entry({ table: "disc", rowId: "5", op: "upsert", baseVersion: 1, fields: { title: "Device A" } })] });
    const stale = store.push({
      ...ctx,
      entries: [entry({ table: "disc", rowId: "5", op: "upsert", baseVersion: 1, fields: { title: "Device B" } })],
    });
    expect(stale.results[0]?.status).toBe("applied");
    expect(store.changes(0).changes[0]?.row).toMatchObject({ title: "Device B", version: 3 });
  });

  it("cascades a tag delete to its links (delete wins)", () => {
    const tagId = uuidv7();
    const linkId = uuidv7();
    store.push({
      ...ctx,
      entries: [
        entry({ table: "tag", rowId: tagId, op: "upsert", fields: { name: "movies" } }),
        entry({ table: "tag_link", rowId: linkId, op: "upsert", fields: { tag_id: tagId, item_key: "d:116" } }),
      ],
    });
    store.push({ ...ctx, entries: [entry({ table: "tag", rowId: tagId, op: "delete", baseVersion: 1 })] });
    const rows = store.changes(0).changes;
    expect(rows.map((c) => [c.table, c.op])).toEqual([
      ["tag", "delete"],
      ["tag_link", "delete"],
    ]);
    const late = store.push({
      ...ctx,
      entries: [entry({ table: "tag_link", rowId: uuidv7(), op: "upsert", fields: { tag_id: tagId, item_key: "d:1" } })],
    });
    expect(late.results[0]?.status).toBe("rejected");
  });

  it("defers writes past the daily quota", () => {
    store.setQuotas({ maxMetaWritesPerDay: 1 });
    const out = store.push({
      ...ctx,
      entries: [
        entry({ table: "tag", rowId: uuidv7(), op: "upsert", fields: { name: "a" } }),
        entry({ table: "tag", rowId: uuidv7(), op: "upsert", fields: { name: "b" } }),
      ],
    });
    expect(out.results.map((r) => r.status)).toEqual(["applied", "deferred"]);
    expect(out.results[1]?.retryAfter).toBe(14 * 3600);
  });

  it("reserves, uploads and commits a pack, purging the replaced one", async () => {
    store.push({ ...ctx, entries: [entry({ table: "disc", rowId: "116", op: "upsert", fields: {} })] });
    const build = (name: string) =>
      buildPack({
        disc_no: 116,
        scanned_at: null,
        built_at: "2026-09-13T00:00:00Z",
        folders: [],
        files: [{ folder: null, name, size_kb: 10, created: null }],
      });

    for (const [i, pack] of [await build("a.avi"), await build("b.avi")].entries()) {
      const reserve = store.reservePacks([
        { disc_no: 116, pack_hash: pack.pack_hash, parts: pack.parts.map((p) => ({ hash: p.hash, bytes: p.bytes })) },
      ]);
      expect(reserve.results[0]).toMatchObject({ status: "reserved", missingParts: [1] });

      const commit = entry({
        table: "disc",
        rowId: "116",
        op: "pack_commit",
        fields: {
          pack_hash: pack.pack_hash,
          pack_parts: 1,
          pack_bytes: pack.parts[0]?.bytes,
          pack_version: 1,
          folder_count: 0,
          file_count: 1,
          total_kb: 10,
          scanned_at: null,
        },
      });
      expect(store.push({ ...ctx, entries: [commit] }).results[0]?.status).toBe("rejected");
      expect(store.markUploaded(116, pack.pack_hash, 1)).toBe(0);
      const done = store.push({ ...ctx, entries: [{ ...commit, id: uuidv7() }] });
      expect(done.results[0]?.status).toBe("applied");
      expect(done.purge).toHaveLength(i);
      if (i === 1) expect(done.purge[0]?.kv_key).toMatch(new RegExp(`^v:${VAULT}:pack:116:[0-9a-f]{64}:1$`));
    }
    expect(store.manifest().discs[0]).toMatchObject({ disc_no: 116, parts: 1 });
    expect(store.usage().packUploads).toBe(2);
    expect(store.allPackKeys()).toHaveLength(1);
  });

  it("rejects reservations beyond the storage quota", () => {
    store.setQuotas({ maxPackBytes: 100 });
    const res = store.reservePacks([{ disc_no: 1, pack_hash: "a".repeat(64), parts: [{ hash: "b".repeat(64), bytes: 101 }] }]);
    expect(res.results[0]).toMatchObject({ status: "rejected" });
  });

  it("exports the vault in pages", () => {
    for (let i = 1; i <= 5; i++) {
      store.push({ ...ctx, entries: [entry({ table: "disc", rowId: String(i), op: "upsert", fields: { title: `D${i}` } })] });
    }
    let cursor: string | null = null;
    const sql: string[] = [];
    let pages = 0;
    do {
      const page = store.exportPage(cursor, 3);
      sql.push(page.sql);
      cursor = page.cursor;
      pages++;
    } while (cursor && pages < 50);
    const all = sql.join("\n");
    expect(all.match(/INSERT INTO disc /g)).toHaveLength(5);
    expect(all.match(/INSERT INTO change_log /g)).toHaveLength(5);
    expect(cursor).toBeNull();
  });
});
