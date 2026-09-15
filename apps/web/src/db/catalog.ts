import type { SqlDb } from "@discvault/schema";

export interface DiscListItem {
  disc_no: number;
  label: string | null;
  title: string | null;
  media_type: string | null;
  status: string;
  folder_count: number;
  file_count: number;
  total_kb: number;
  scanned_at: string | null;
  updated_at: string;
}

/** Disc library table (§8.5): every non-deleted disc. */
export function listDiscs(db: SqlDb): DiscListItem[] {
  return db.all<DiscListItem>(
    `SELECT d.disc_no, d.label, d.title, d.media_type, d.status,
            d.folder_count, d.file_count, d.total_kb, d.scanned_at, d.updated_at
     FROM disc d
     WHERE d.deleted_at IS NULL
     ORDER BY d.disc_no`,
  );
}

/** Disc numbers with no row at all, within the lowest..highest range (§7, Data Health). */
export function missingDiscNumbers(db: SqlDb): number[] {
  const rows = db.all<{ disc_no: number }>(`SELECT disc_no FROM disc WHERE deleted_at IS NULL ORDER BY disc_no`);
  const present = new Set(rows.map((r) => r.disc_no));
  if (rows.length === 0) return [];
  const lo = rows[0]!.disc_no;
  const hi = rows[rows.length - 1]!.disc_no;
  const missing: number[] = [];
  for (let n = lo; n <= hi; n++) if (!present.has(n)) missing.push(n);
  return missing;
}

export interface DiscDetail extends DiscListItem {
  notes: string | null;
  meta: string | null;
}

export function getDisc(db: SqlDb, discNo: number): DiscDetail | undefined {
  return db.get<DiscDetail>(
    `SELECT d.disc_no, d.label, d.title, d.media_type, d.status,
            d.folder_count, d.file_count, d.total_kb, d.scanned_at, d.updated_at, d.notes, d.meta
     FROM disc d
     WHERE d.disc_no = ? AND d.deleted_at IS NULL`,
    [discNo],
  );
}

export interface FolderEntry {
  kind: "folder";
  folder_id: number;
  name: string;
  rel_path: string;
  size_kb: number | null;
}

export interface FileEntry {
  kind: "file";
  file_id: number;
  name: string;
  ext: string | null;
  rel_path: string;
  size_kb: number | null;
  created: string | null;
  date_valid: number;
}

export type FolderChild = FolderEntry | FileEntry;

/**
 * One level of a disc's folder tree (§9.5): subfolders and files directly under `parentId`
 * (`null` for the disc root). The explorer loads levels lazily as the user drills in.
 */
export function listFolderChildren(db: SqlDb, discNo: number, parentId: number | null): FolderChild[] {
  const folders = db
    .all<Omit<FolderEntry, "kind">>(
      `SELECT folder_id, name, rel_path, size_kb FROM folder
       WHERE disc_no = ? AND parent_id IS ? ORDER BY name COLLATE NOCASE`,
      [discNo, parentId],
    )
    .map((f): FolderEntry => ({ kind: "folder", ...f }));
  const files = db
    .all<Omit<FileEntry, "kind">>(
      `SELECT file_id, name, ext, rel_path, size_kb, created, date_valid FROM file
       WHERE disc_no = ? AND folder_id IS ? ORDER BY name COLLATE NOCASE`,
      [discNo, parentId],
    )
    .map((f): FileEntry => ({ kind: "file", ...f }));
  return [...folders, ...files];
}

export function findFolderByPath(db: SqlDb, discNo: number, relPath: string): number | null {
  if (!relPath) return null;
  const row = db.get<{ folder_id: number }>(`SELECT folder_id FROM folder WHERE disc_no = ? AND rel_path = ?`, [discNo, relPath]);
  if (!row) throw new Error(`no such folder: ${relPath}`);
  return row.folder_id;
}

export interface MediaTypeCount {
  media_type: string;
  discs: number;
  total_kb: number;
}

/** Discs and total size grouped by media type (§8: Dashboard "Storage by media type"). */
export function mediaTypeBreakdown(db: SqlDb): MediaTypeCount[] {
  return db.all<MediaTypeCount>(
    `SELECT coalesce(media_type, 'Unknown') AS media_type, count(*) AS discs, coalesce(sum(total_kb), 0) AS total_kb
     FROM disc WHERE deleted_at IS NULL GROUP BY coalesce(media_type, 'Unknown') ORDER BY total_kb DESC`,
  );
}

/**
 * ext -> category, for coloring search results client-side without a round trip per row.
 * `category_override` (synced) wins over the `file_category` seed defaults.
 */
export function extensionCategoryMap(db: SqlDb): Record<string, string> {
  const rows = db.all<{ ext: string; category: string }>(`SELECT ext, category FROM file_category`);
  const map = Object.fromEntries(rows.map((r) => [r.ext, r.category]));
  const overrides = db.all<{ ext: string; category: string }>(`SELECT ext, category FROM category_override WHERE deleted_at IS NULL`);
  for (const o of overrides) map[o.ext] = o.category;
  return map;
}

export interface ExtCount {
  ext: string;
  count: number;
}

/** Every extension across the whole catalog with its file count (§8: Settings → Categories). */
export function allExtensionCounts(db: SqlDb): ExtCount[] {
  return db.all<ExtCount>(`SELECT coalesce(ext, '') AS ext, count(*) AS count FROM file GROUP BY ext ORDER BY count DESC`);
}

export interface CategoryCount {
  category: string;
  files: number;
  total_kb: number;
}

/** Files-by-category breakdown for one disc, or every disc when `discNo` is omitted (§8: Dashboard, Overview tab). */
export function categoryBreakdown(db: SqlDb, discNo?: number): CategoryCount[] {
  const where = discNo === undefined ? "" : "WHERE f.disc_no = ?";
  return db.all<CategoryCount>(
    `SELECT coalesce(fc.category, 'other') AS category, count(*) AS files, coalesce(sum(f.size_kb), 0) AS total_kb
     FROM file f
     LEFT JOIN file_category fc ON fc.ext = f.ext
     ${where}
     GROUP BY coalesce(fc.category, 'other')
     ORDER BY total_kb DESC`,
    discNo === undefined ? [] : [discNo],
  );
}

export interface ExtensionCount {
  ext: string;
  category: string | null;
  files: number;
  total_kb: number;
}

export function extensionBreakdown(db: SqlDb, discNo: number, limit = 30): ExtensionCount[] {
  return db.all<ExtensionCount>(
    `SELECT coalesce(f.ext, '') AS ext, fc.category, count(*) AS files, coalesce(sum(f.size_kb), 0) AS total_kb
     FROM file f
     LEFT JOIN file_category fc ON fc.ext = f.ext
     WHERE f.disc_no = ?
     GROUP BY f.ext
     ORDER BY total_kb DESC
     LIMIT ?`,
    [discNo, limit],
  );
}

export function largestFiles(db: SqlDb, discNo: number, limit = 20): FileEntry[] {
  return db
    .all<Omit<FileEntry, "kind">>(
      `SELECT file_id, name, ext, rel_path, size_kb, created, date_valid FROM file
       WHERE disc_no = ? ORDER BY size_kb DESC LIMIT ?`,
      [discNo, limit],
    )
    .map((f): FileEntry => ({ kind: "file", ...f }));
}

/** Every folder's path on a disc, root to leaf, alphabetical — for sending the full structure to AI. */
export function allFolderPaths(db: SqlDb, discNo: number): string[] {
  return db
    .all<{ rel_path: string }>(`SELECT rel_path FROM folder WHERE disc_no = ? ORDER BY rel_path COLLATE NOCASE`, [discNo])
    .map((r) => r.rel_path);
}

/** Every file's path on a disc, alphabetical — for sending the full structure to AI. */
export function allFilePaths(db: SqlDb, discNo: number): string[] {
  return db
    .all<{ rel_path: string }>(`SELECT rel_path FROM file WHERE disc_no = ? ORDER BY rel_path COLLATE NOCASE`, [discNo])
    .map((r) => r.rel_path);
}

/**
 * Above this many combined folders+files, a disc's full listing is refused rather than sent to
 * Gemini: flash-tier models have roughly a 1M-token context, and short path lines run several
 * tokens each once prompt instructions and the response budget are accounted for. Nothing in the
 * current catalog comes close to this — it exists so a pathological disc fails clearly instead of
 * producing a huge, possibly-truncated request.
 */
export const MAX_AI_SUMMARY_ENTRIES = 120_000;

export interface DiscAiSummary {
  discNo: number;
  title: string | null;
  label: string | null;
  mediaType: string | null;
  folderCount: number;
  fileCount: number;
  totalKb: number;
  allFolderPaths: string[];
  allFilePaths: string[];
  extensions: { ext: string; files: number }[];
}

/**
 * The whole structure of a disc's catalog (§ AI: disc identification) — every folder and file
 * name/path, never file contents (which this app doesn't have access to in the first place; only
 * catalog metadata is stored, on-device).
 */
export function buildDiscAiSummary(db: SqlDb, discNo: number): DiscAiSummary | undefined {
  const disc = getDisc(db, discNo);
  if (!disc) return undefined;
  if (disc.folder_count + disc.file_count > MAX_AI_SUMMARY_ENTRIES) {
    throw new Error(
      `Disc #${discNo} has ${disc.folder_count + disc.file_count} folders/files — too many to send to Gemini in one request (limit: ${MAX_AI_SUMMARY_ENTRIES}).`,
    );
  }
  const extensions = extensionBreakdown(db, discNo, 20).map((e) => ({ ext: e.ext, files: e.files }));
  return {
    discNo,
    title: disc.title,
    label: disc.label,
    mediaType: disc.media_type,
    folderCount: disc.folder_count,
    fileCount: disc.file_count,
    totalKb: disc.total_kb,
    allFolderPaths: allFolderPaths(db, discNo),
    allFilePaths: allFilePaths(db, discNo),
    extensions,
  };
}
