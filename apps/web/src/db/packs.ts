import type { SqlDb } from "@discvault/schema";
import {
  buildPack,
  extensionOf,
  isValidCatalogDate,
  joinRelPath,
  type PackFile,
  type PackFolder,
  type ParsedPackPart,
  parsePackPart,
} from "@discvault/sync-protocol";
import { nowIso } from "./local-db.js";
import { enqueue, writeRow } from "./rows.js";

/** Removes a disc's folders and files (and their search index entries). */
export function removeDiscCatalog(db: SqlDb, discNo: number): void {
  db.transaction(() => {
    db.run("DELETE FROM file WHERE disc_no = ?", [discNo]);
    db.run("DELETE FROM folder WHERE disc_no = ?", [discNo]);
    db.run("DELETE FROM local_pack WHERE disc_no = ?", [discNo]);
  });
}

/**
 * Replaces a disc's folders and files with the contents of its pack, in one transaction.
 * Paths are rebuilt from the folder tree; extensions and date validity are derived here.
 */
export function importPackParts(db: SqlDb, discNo: number, packHash: string, parts: ParsedPackPart[]): { folders: number; files: number } {
  const sorted = [...parts].sort((a, b) => a.part - b.part);
  const first = sorted[0];
  if (!first || sorted.length !== first.parts || sorted.some((p, i) => p.part !== i + 1 || p.disc_no !== discNo)) {
    throw new Error(`incomplete pack for disc ${discNo}`);
  }
  let files = 0;
  db.transaction(() => {
    db.run("DELETE FROM file WHERE disc_no = ?", [discNo]);
    db.run("DELETE FROM folder WHERE disc_no = ?", [discNo]);

    const localIds = new Map<number, { id: number; path: string }>();
    for (const folder of first.folders) {
      const parent = folder.parent === null ? undefined : localIds.get(folder.parent);
      const relPath = joinRelPath(parent?.path, folder.name);
      const inserted = db.get<{ folder_id: number }>(
        `INSERT INTO folder (disc_no, parent_id, name, rel_path, size_kb, created) VALUES (?, ?, ?, ?, ?, ?)
         RETURNING folder_id`,
        [discNo, parent?.id ?? null, folder.name, relPath, folder.size_kb, folder.created],
      );
      localIds.set(folder.id, { id: Number(inserted?.folder_id), path: relPath });
    }

    for (const part of sorted) {
      for (const file of part.files) {
        const folder = file.folder === null ? undefined : localIds.get(file.folder);
        db.run(
          `INSERT INTO file (disc_no, folder_id, name, ext, rel_path, size_kb, created, date_valid)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            discNo,
            folder?.id ?? null,
            file.name,
            extensionOf(file.name),
            joinRelPath(folder?.path, file.name),
            file.size_kb,
            file.created,
            isValidCatalogDate(file.created, part.built_at) ? 1 : 0,
          ],
        );
        files++;
      }
    }
    db.run(
      `INSERT INTO local_pack (disc_no, pack_hash, imported_at) VALUES (?, ?, ?)
       ON CONFLICT (disc_no) DO UPDATE SET pack_hash = excluded.pack_hash, imported_at = excluded.imported_at`,
      [discNo, packHash, nowIso()],
    );
  });
  return { folders: first.folders.length, files };
}

export interface ScannedDiscMeta {
  title: string | null;
  media_type: string | null;
  location_slot: string | null;
  status: string;
  notes?: string | null;
}

export interface CommittedPack {
  folder_count: number;
  file_count: number;
  total_kb: number;
}

/**
 * Builds a pack from a live scan (§8 screen 7) and commits it exactly like an archive import
 * (`importArchive`, `apps/web/src/archive/import.ts`): the disc row through `writeRow`, the
 * server-derived pack fields, the catalog rows, the gzipped parts staged for upload, and a
 * `pack_commit` outbox entry enqueued after the disc row so it pushes second.
 */
export async function commitScannedPack(
  db: SqlDb,
  discNo: number,
  meta: ScannedDiscMeta,
  folders: PackFolder[],
  files: PackFile[],
): Promise<CommittedPack> {
  const now = nowIso();
  const pack = await buildPack({ disc_no: discNo, scanned_at: now, built_at: now, folders, files });
  const parsedParts = await Promise.all(pack.parts.map((p) => parsePackPart(p.data)));
  const packBytes = pack.parts.reduce((sum, p) => sum + p.bytes, 0);

  db.transaction(() => {
    writeRow(db, "disc", String(discNo), {
      title: meta.title,
      media_type: meta.media_type,
      status: meta.status,
      location_slot: meta.location_slot,
      notes: meta.notes ?? null,
    });
    db.run(
      `UPDATE disc SET folder_count = ?, file_count = ?, total_kb = ?, pack_hash = ?, pack_parts = ?,
              pack_bytes = ?, pack_version = ?, scanned_at = ? WHERE disc_no = ?`,
      [pack.folder_count, pack.file_count, pack.total_kb, pack.pack_hash, pack.parts.length, packBytes, pack.pack_version, now, discNo],
    );
    importPackParts(db, discNo, pack.pack_hash, parsedParts);
    for (const part of pack.parts) {
      db.run(
        `INSERT INTO pending_pack_part (disc_no, pack_hash, part, part_hash, bytes, data, uploaded)
         VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT (disc_no, pack_hash, part) DO NOTHING`,
        [discNo, pack.pack_hash, part.part, part.hash, part.bytes, part.data],
      );
    }
    enqueue(db, {
      kind: "pack",
      table: "disc",
      rowId: String(discNo),
      op: "pack_commit",
      payload: {
        pack_hash: pack.pack_hash,
        pack_parts: pack.parts.length,
        pack_bytes: packBytes,
        pack_version: pack.pack_version,
        folder_count: pack.folder_count,
        file_count: pack.file_count,
        total_kb: pack.total_kb,
        scanned_at: now,
      },
      baseVersion: 0,
    });
  });

  return { folder_count: pack.folder_count, file_count: pack.file_count, total_kb: pack.total_kb };
}
