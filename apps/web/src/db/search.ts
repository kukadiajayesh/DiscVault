import type { SqlDb } from "@discvault/schema";

export interface FileHit {
  file_id: number;
  disc_no: number;
  name: string;
  rel_path: string;
  size_kb: number | null;
  ext: string | null;
  created: string | null;
  title: string | null;
}

/**
 * Substring search over file names (§9.5). Uses the trigram index for 3+ characters and falls
 * back to LIKE for shorter queries, which the trigram tokenizer can't match.
 */
export function searchFiles(db: SqlDb, query: string, options: { limit?: number; offset?: number } = {}): FileHit[] {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.min(options.limit ?? 200, 1000);
  const offset = options.offset ?? 0;
  const select = `SELECT f.file_id, f.disc_no, f.name, f.rel_path, f.size_kb, f.ext, f.created,
      d.title`;
  const joins = `JOIN disc d ON d.disc_no = f.disc_no AND d.deleted_at IS NULL`;
  if (q.length >= 3) {
    return db.all<FileHit>(
      `${select} FROM file_fts s JOIN file f ON f.file_id = s.rowid ${joins}
       WHERE file_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?`,
      [`"${q.replace(/"/g, '""')}"`, limit, offset],
    );
  }
  return db.all<FileHit>(`${select} FROM file f ${joins} WHERE f.name LIKE ? ESCAPE '\\' ORDER BY f.name LIMIT ? OFFSET ?`, [
    `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    limit,
    offset,
  ]);
}

export interface FolderHit {
  folder_id: number;
  disc_no: number;
  name: string;
  rel_path: string;
  size_kb: number | null;
  created: string | null;
  title: string | null;
}

/** Substring search over folder names, mirroring {@link searchFiles} (Search screen's Folders/Both scope). */
export function searchFolders(db: SqlDb, query: string, options: { limit?: number; offset?: number } = {}): FolderHit[] {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.min(options.limit ?? 200, 1000);
  const offset = options.offset ?? 0;
  const select = `SELECT fo.folder_id, fo.disc_no, fo.name, fo.rel_path, fo.size_kb, fo.created,
      d.title`;
  const joins = `JOIN disc d ON d.disc_no = fo.disc_no AND d.deleted_at IS NULL`;
  if (q.length >= 3) {
    return db.all<FolderHit>(
      `${select} FROM folder_fts s JOIN folder fo ON fo.folder_id = s.rowid ${joins}
       WHERE folder_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?`,
      [`"${q.replace(/"/g, '""')}"`, limit, offset],
    );
  }
  return db.all<FolderHit>(`${select} FROM folder fo ${joins} WHERE fo.name LIKE ? ESCAPE '\\' ORDER BY fo.name LIMIT ? OFFSET ?`, [
    `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    limit,
    offset,
  ]);
}

export interface CatalogStats {
  discs: number;
  folders: number;
  files: number;
  totalKb: number;
  pendingChanges: number;
}

export function catalogStats(db: SqlDb): CatalogStats {
  const row = db.get<{ discs: number; folders: number; files: number; total_kb: number; pending: number }>(
    `SELECT (SELECT count(*) FROM disc WHERE deleted_at IS NULL) AS discs,
            (SELECT count(*) FROM folder) AS folders,
            (SELECT count(*) FROM file) AS files,
            (SELECT coalesce(sum(total_kb), 0) FROM disc WHERE deleted_at IS NULL) AS total_kb,
            (SELECT count(*) FROM outbox) AS pending`,
  );
  return {
    discs: Number(row?.discs ?? 0),
    folders: Number(row?.folders ?? 0),
    files: Number(row?.files ?? 0),
    totalKb: Number(row?.total_kb ?? 0),
    pendingChanges: Number(row?.pending ?? 0),
  };
}
