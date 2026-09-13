import type { SqlDb } from "@discvault/schema";
import {
  ARCHIVE_MANIFEST_PATH,
  type ArchiveDisc,
  ArchiveManifest,
  archivePackPath,
  isValidCatalogDate,
  type ParsedPackPart,
  packHashOf,
  parsePackPart,
  sha256Hex,
} from "@discvault/sync-protocol";
import { unzipSync } from "fflate";
import { importPackParts } from "../db/packs.js";
import { enqueue, writeRow } from "../db/rows.js";

export type CollisionResolution = "skip" | "replace" | "renumber";

export interface ArchiveDiscPreview {
  disc_no: number;
  title: string | null;
  folder_count: number;
  file_count: number;
  total_kb: number;
  invalid_dates: number;
  collision: boolean;
}

export interface ArchivePreview {
  source: string;
  created_at: string;
  counts: { discs: number; folders: number; files: number };
  missing_disc_numbers: number[];
  invalid_dates: number;
  collisions: number[];
  discs: ArchiveDiscPreview[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  /** Original disc_no -> the number it was actually imported under, for "renumber" resolutions. */
  renumbered: Record<number, number>;
}

interface OpenedArchive {
  manifest: ArchiveManifest;
  files: Record<string, Uint8Array>;
}

function openArchive(zipBytes: Uint8Array): OpenedArchive {
  const files = unzipSync(zipBytes);
  const manifestBytes = files[ARCHIVE_MANIFEST_PATH];
  if (!manifestBytes) throw new Error("archive is missing manifest.json");
  const manifest = ArchiveManifest.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
  return { manifest, files };
}

/** Verifies every part hash and the pack hash, and parses the parts (§3.7). */
async function readDiscParts(
  disc: ArchiveDisc,
  files: Record<string, Uint8Array>,
): Promise<{ parts: ParsedPackPart[]; invalidDates: number }> {
  const hashes: string[] = [];
  const parts: ParsedPackPart[] = [];
  let invalidDates = 0;
  for (const [i, expected] of disc.parts.entries()) {
    const path = archivePackPath(disc.disc_no, disc.pack_hash, i + 1);
    const data = files[path];
    if (!data) throw new Error(`archive is missing ${path}`);
    const hash = await sha256Hex(data);
    if (hash !== expected.hash) throw new Error(`part hash mismatch for disc ${disc.disc_no} part ${i + 1}`);
    hashes.push(hash);
    const parsed = await parsePackPart(data);
    invalidDates += parsed.files.filter((f) => !isValidCatalogDate(f.created, parsed.built_at)).length;
    parts.push(parsed);
  }
  if ((await packHashOf(hashes)) !== disc.pack_hash) throw new Error(`pack hash mismatch for disc ${disc.disc_no}`);
  return { parts, invalidDates };
}

/**
 * Validates a `.dvault` archive and reports what an import would do, without touching the local
 * database: unzips, checks the manifest shape, verifies every part hash and the pack hash, and
 * flags disc numbers that already exist locally.
 */
export async function previewArchive(db: SqlDb, zipBytes: Uint8Array): Promise<ArchivePreview> {
  const { manifest, files } = openArchive(zipBytes);
  const existing = new Set(db.all<{ disc_no: number }>("SELECT disc_no FROM disc WHERE deleted_at IS NULL").map((d) => d.disc_no));

  const numbers = new Set(manifest.discs.map((d) => d.disc_no));
  const maxNo = Math.max(0, ...numbers);
  const missing: number[] = [];
  for (let n = 1; n <= maxNo; n++) if (!numbers.has(n)) missing.push(n);

  const discs: ArchiveDiscPreview[] = [];
  let invalidDatesTotal = 0;
  for (const disc of manifest.discs) {
    const { invalidDates } = await readDiscParts(disc, files);
    invalidDatesTotal += invalidDates;
    discs.push({
      disc_no: disc.disc_no,
      title: disc.title,
      folder_count: disc.folder_count,
      file_count: disc.file_count,
      total_kb: disc.total_kb,
      invalid_dates: invalidDates,
      collision: existing.has(disc.disc_no),
    });
  }
  return {
    source: manifest.source,
    created_at: manifest.created_at,
    counts: manifest.counts,
    missing_disc_numbers: missing,
    invalid_dates: invalidDatesTotal,
    collisions: discs.filter((d) => d.collision).map((d) => d.disc_no),
    discs,
  };
}

/**
 * Imports a validated `.dvault` archive into the local database, one disc per transaction (§3.7):
 * the disc row (through `writeRow`, so user-editable fields sync normally) plus its server-derived
 * pack fields, the folder/file rows, the gzipped parts staged for upload, and a `pack_commit`
 * outbox entry — enqueued after the disc row so it is always pushed second (outbox order is by
 * `rowid`).
 */
export async function importArchive(
  db: SqlDb,
  zipBytes: Uint8Array,
  options: {
    resolve?: (discNo: number) => CollisionResolution;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<ImportResult> {
  const { manifest, files } = openArchive(zipBytes);
  const resolve = options.resolve ?? (() => "skip" as const);
  const existing = new Set(db.all<{ disc_no: number }>("SELECT disc_no FROM disc WHERE deleted_at IS NULL").map((d) => d.disc_no));
  let nextFreeNo = Math.max(0, ...existing, ...manifest.discs.map((d) => d.disc_no)) + 1;

  const result: ImportResult = { imported: 0, skipped: 0, renumbered: {} };
  for (const [index, disc] of manifest.discs.entries()) {
    let discNo = disc.disc_no;
    if (existing.has(discNo)) {
      const resolution = resolve(discNo);
      if (resolution === "skip") {
        result.skipped++;
        options.onProgress?.(index + 1, manifest.discs.length);
        continue;
      }
      if (resolution === "renumber") {
        discNo = nextFreeNo++;
        result.renumbered[disc.disc_no] = discNo;
      }
      // "replace" keeps disc.disc_no and overwrites the existing row and catalog below.
    }
    existing.add(discNo);

    const { parts } = await readDiscParts(disc, files);
    const packBytes = disc.parts.reduce((sum, p) => sum + p.bytes, 0);

    db.transaction(() => {
      writeRow(db, "disc", String(discNo), {
        label: disc.label,
        title: disc.title,
        media_type: disc.media_type,
        status: disc.status,
        location_id: disc.location_id,
        location_slot: disc.location_slot,
        notes: disc.notes,
        meta: disc.meta,
      });
      // Server-derived pack fields: written directly (writeRow rejects them, since the client
      // never pushes them) and confirmed later by the pack_commit response.
      db.run(
        `UPDATE disc SET folder_count = ?, file_count = ?, total_kb = ?, pack_hash = ?, pack_parts = ?,
                pack_bytes = ?, pack_version = ?, scanned_at = ? WHERE disc_no = ?`,
        [
          disc.folder_count,
          disc.file_count,
          disc.total_kb,
          disc.pack_hash,
          disc.parts.length,
          packBytes,
          disc.pack_version,
          disc.scanned_at,
          discNo,
        ],
      );
      importPackParts(
        db,
        discNo,
        disc.pack_hash,
        parts.map((p) => ({ ...p, disc_no: discNo })),
      );
      for (const [i, part] of disc.parts.entries()) {
        const data = files[archivePackPath(disc.disc_no, disc.pack_hash, i + 1)];
        db.run(
          `INSERT INTO pending_pack_part (disc_no, pack_hash, part, part_hash, bytes, data, uploaded)
           VALUES (?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT (disc_no, pack_hash, part) DO NOTHING`,
          [discNo, disc.pack_hash, i + 1, part.hash, part.bytes, data ?? new Uint8Array()],
        );
      }
      enqueue(db, {
        kind: "pack",
        table: "disc",
        rowId: String(discNo),
        op: "pack_commit",
        payload: {
          pack_hash: disc.pack_hash,
          pack_parts: disc.parts.length,
          pack_bytes: packBytes,
          pack_version: disc.pack_version,
          folder_count: disc.folder_count,
          file_count: disc.file_count,
          total_kb: disc.total_kb,
          scanned_at: disc.scanned_at,
        },
        baseVersion: 0,
      });
    });

    result.imported++;
    options.onProgress?.(index + 1, manifest.discs.length);
  }
  return result;
}
