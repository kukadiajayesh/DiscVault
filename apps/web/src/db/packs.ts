import type { SqlDb } from "@discvault/schema";
import { extensionOf, isValidCatalogDate, joinRelPath, type ParsedPackPart } from "@discvault/sync-protocol";
import { nowIso } from "./local-db.js";

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
