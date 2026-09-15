import type { SqlDb, SqlValue } from "@discvault/schema";
import { uuidv7 } from "@discvault/sync-protocol";
import type { DiscContentType, DiscItemDraft } from "../ai/classification.js";
import { deleteRow, writeRow } from "./rows.js";

export interface DiscItem extends DiscItemDraft {
  id: string;
  discNo: number;
  /** Resolved preview-image URL from an external provider (§ image preview), null until looked up or if no match was found. */
  imageUrl: string | null;
}

type Row = Record<string, SqlValue>;

function toDiscItem(row: Row): DiscItem {
  return {
    id: String(row.id),
    discNo: Number(row.disc_no),
    path: String(row.path ?? ""),
    contentType: row.content_type as DiscContentType,
    title: (row.title as string | null) ?? null,
    platform: (row.platform as string | null) ?? null,
    publisher: (row.publisher as string | null) ?? null,
    developer: (row.developer as string | null) ?? null,
    year: (row.year as string | null) ?? null,
    genres: row.genres ? (JSON.parse(String(row.genres)) as string[]) : [],
    description: String(row.description ?? ""),
    label: String(row.label ?? ""),
    summary: String(row.summary ?? ""),
    confidence: row.confidence as DiscItem["confidence"],
    model: String(row.model),
    analyzedAt: String(row.analyzed_at),
    imageUrl: (row.image_url as string | null) ?? null,
  };
}

const SELECT_COLUMNS = `
  id, disc_no, path, content_type, title, platform, publisher, developer, year, genres,
  description, label, summary, confidence, model, analyzed_at, image_url
`;

/** One disc's identified items (§ AI: disc identification), ordered by folder path then title. */
export function listDiscItems(db: SqlDb, discNo: number): DiscItem[] {
  return db
    .all<Row>(`SELECT ${SELECT_COLUMNS} FROM disc_item WHERE disc_no = ? AND deleted_at IS NULL ORDER BY path, title`, [discNo])
    .map(toDiscItem);
}

/** Disc numbers that already have at least one AI-identified item — for the library's bulk "Analyze all" to skip. */
export function discNosWithItems(db: SqlDb): number[] {
  return db.all<{ disc_no: number }>(`SELECT DISTINCT disc_no FROM disc_item WHERE deleted_at IS NULL`).map((r) => r.disc_no);
}

/** Saves a reviewed draft as a new item on a disc. Returns its id. */
export function insertDiscItem(db: SqlDb, discNo: number, draft: DiscItemDraft): string {
  const id = uuidv7();
  writeRow(db, "disc_item", id, {
    disc_no: discNo,
    path: draft.path,
    content_type: draft.contentType,
    title: draft.title,
    platform: draft.platform,
    publisher: draft.publisher,
    developer: draft.developer,
    year: draft.year,
    genres: draft.genres,
    description: draft.description,
    label: draft.label,
    summary: draft.summary,
    confidence: draft.confidence,
    model: draft.model,
    analyzed_at: draft.analyzedAt,
  });
  return id;
}

/**
 * Saves one AI analysis run as a disc's identified items, replacing whatever the disc had before —
 * so re-analyzing never piles up duplicates of the same title/genre alongside the old run. Safe to
 * call with an empty list: a fresh analysis that found nothing still clears out stale items.
 */
export function replaceDiscItems(db: SqlDb, discNo: number, drafts: DiscItemDraft[]): string[] {
  return db.transaction(() => {
    for (const item of listDiscItems(db, discNo)) removeDiscItem(db, item.id);
    return drafts.map((draft) => insertDiscItem(db, discNo, draft));
  });
}

export function removeDiscItem(db: SqlDb, id: string): void {
  deleteRow(db, "disc_item", id);
  // Not a synced/FK table (§ image preview), so its cleanup isn't automatic.
  db.run("DELETE FROM disc_item_image WHERE item_id = ?", [id]);
}

/** Sets one item's resolved external preview-image URL (or null for "no match found"), after a best-effort lookup. */
export function setDiscItemImageUrl(db: SqlDb, id: string, imageUrl: string | null): void {
  writeRow(db, "disc_item", id, { image_url: imageUrl });
}

export interface DiscItemImage {
  itemId: string;
  contentType: string;
  data: Uint8Array;
  fetchedAt: string;
}

function toDiscItemImage(row: Row): DiscItemImage {
  return {
    itemId: String(row.item_id),
    contentType: String(row.content_type),
    data: row.data as Uint8Array,
    fetchedAt: String(row.fetched_at),
  };
}

/** The locally cached preview-image bytes for one item, if downloaded, for offline-first rendering (§ image preview). */
export function getDiscItemImageBlob(db: SqlDb, itemId: string): DiscItemImage | null {
  const row = db.get<Row>("SELECT item_id, content_type, data, fetched_at FROM disc_item_image WHERE item_id = ?", [itemId]);
  return row ? toDiscItemImage(row) : null;
}

/**
 * Caches downloaded preview-image bytes for offline viewing — replaces any previous cache for this
 * item, since a later re-analysis may resolve a different `image_url`.
 */
export function saveDiscItemImageBlob(db: SqlDb, itemId: string, contentType: string, data: Uint8Array): void {
  db.run(
    `INSERT INTO disc_item_image (item_id, content_type, data, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (item_id) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, fetched_at = excluded.fetched_at`,
    [itemId, contentType, data, new Date().toISOString()],
  );
}

export interface ItemTypeCount {
  contentType: DiscContentType;
  count: number;
}

/** Counts of identified items per content type, across every non-deleted disc — for the library's category cards. */
export function itemTypeCounts(db: SqlDb): ItemTypeCount[] {
  return db.all<ItemTypeCount>(
    `SELECT di.content_type AS contentType, count(*) AS count
     FROM disc_item di
     JOIN disc d ON d.disc_no = di.disc_no
     WHERE di.deleted_at IS NULL AND d.deleted_at IS NULL
     GROUP BY di.content_type
     ORDER BY count DESC`,
  );
}

export interface DiscItemWithSource extends DiscItem {
  discLabel: string | null;
  discTitle: string | null;
  mediaType: string | null;
}

const SELECT_COLUMNS_WITH_SOURCE = `
  di.id, di.disc_no, di.path, di.content_type, di.title, di.platform, di.publisher, di.developer, di.year,
  di.genres, di.description, di.label, di.summary, di.confidence, di.model, di.analyzed_at, di.image_url,
  d.label AS disc_label, d.title AS disc_title, d.media_type AS media_type
`;

function toDiscItemWithSource(row: Row): DiscItemWithSource {
  return {
    ...toDiscItem(row),
    discLabel: (row.disc_label as string | null) ?? null,
    discTitle: (row.disc_title as string | null) ?? null,
    mediaType: (row.media_type as string | null) ?? null,
  };
}

/** Identified items of one content type, with their source disc's display fields — for the library list. */
export function itemsByContentType(db: SqlDb, contentType: string): DiscItemWithSource[] {
  return db
    .all<Row>(
      `SELECT ${SELECT_COLUMNS_WITH_SOURCE}
       FROM disc_item di
       JOIN disc d ON d.disc_no = di.disc_no
       WHERE di.content_type = ? AND di.deleted_at IS NULL AND d.deleted_at IS NULL
       ORDER BY di.title, di.disc_no`,
      [contentType],
    )
    .map(toDiscItemWithSource);
}

export interface GenreCount {
  genre: string;
  count: number;
}

/**
 * Distinct genre tags across every identified item's AI-suggested `genres`, with how many items
 * carry each — the AI invents these freely (§ AI: disc identification), so this is how the library
 * discovers what categories actually exist instead of a fixed list.
 */
export function itemGenreCounts(db: SqlDb): GenreCount[] {
  return db.all<GenreCount>(
    `SELECT je.value AS genre, count(*) AS count
     FROM disc_item di
     JOIN disc d ON d.disc_no = di.disc_no, json_each(di.genres) je
     WHERE di.deleted_at IS NULL AND d.deleted_at IS NULL AND je.value != ''
     GROUP BY je.value
     ORDER BY count DESC, je.value`,
  );
}

/** Identified items carrying one genre tag, any content type, with their source disc — for the library's genre view. */
export function itemsByGenre(db: SqlDb, genre: string): DiscItemWithSource[] {
  return db
    .all<Row>(
      `SELECT ${SELECT_COLUMNS_WITH_SOURCE}
       FROM disc_item di
       JOIN disc d ON d.disc_no = di.disc_no
       JOIN json_each(di.genres) je ON je.value = ?
       WHERE di.deleted_at IS NULL AND d.deleted_at IS NULL
       ORDER BY di.title, di.disc_no`,
      [genre],
    )
    .map(toDiscItemWithSource);
}
