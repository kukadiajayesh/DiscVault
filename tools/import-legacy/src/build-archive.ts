import type { SqlDb } from "@discvault/schema";
import { MEDIA_TYPES } from "@discvault/schema";
import {
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_MANIFEST_PATH,
  ARCHIVE_META_PATH,
  type ArchiveDisc,
  type ArchiveManifest,
  archivePackPath,
  buildPack,
  isValidCatalogDate,
} from "@discvault/sync-protocol";
import { zipSync } from "fflate";

/**
 * Reads the SQLite export of dvd_manager.mdb (data/migrate.sh) and builds a `.dvault` archive:
 * one pack per disc plus a manifest. Runs locally; it uploads nothing (§3.7, §3.8).
 */

export interface LegacyReport {
  discs: number;
  folders: number;
  files: number;
  totalKb: number;
  packBytes: number;
  largestPackBytes: number;
  multiPartDiscs: number;
  missingDiscNumbers: number[];
  emptyDiscs: number[];
  invalidFileDates: number;
  mediaTypes: Record<string, number>;
}

export interface BuildResult {
  zip: Uint8Array;
  manifest: ArchiveManifest;
  report: LegacyReport;
}

const toIso = (value: string | null): string | null =>
  value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;

/** Legacy discs carry no media type; infer the smallest DVD size that fits the contents. */
function inferMediaType(totalKb: number): string {
  const dvd5 = MEDIA_TYPES.find((m) => m.code === "DVD5")?.capacity_kb ?? 4_590_208;
  return totalKb > dvd5 ? "DVD9" : "DVD5";
}

export async function buildLegacyArchive(
  db: SqlDb,
  options: { builtAt?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<BuildResult> {
  const builtAt = options.builtAt ?? new Date().toISOString();
  const discs = db.all<{ cd_no: number; entry_date: string | null }>("SELECT cd_no, entry_date FROM cd_master ORDER BY cd_no");
  const files: Record<string, Uint8Array> = {};
  const manifestDiscs: ArchiveDisc[] = [];
  const report: LegacyReport = {
    discs: discs.length,
    folders: 0,
    files: 0,
    totalKb: 0,
    packBytes: 0,
    largestPackBytes: 0,
    multiPartDiscs: 0,
    missingDiscNumbers: [],
    emptyDiscs: [],
    invalidFileDates: 0,
    mediaTypes: {},
  };

  for (const [index, disc] of discs.entries()) {
    const folders = db.all<{ id: number; parent: number | null; name: string; size_kb: number | null; created: string | null }>(
      `SELECT dir_id AS id, parent_dir_id AS parent, dir_name AS name, dir_length AS size_kb, dir_created AS created
       FROM dir_master WHERE cd_no = ? ORDER BY dir_id`,
      [disc.cd_no],
    );
    const discFiles = db.all<{ folder: number | null; name: string; size_kb: number | null; created: string | null }>(
      `SELECT dir_id AS folder, file_name AS name, file_length AS size_kb, file_created AS created
       FROM file_master WHERE cd_no = ? ORDER BY file_id`,
      [disc.cd_no],
    );
    const scannedAt = toIso(disc.entry_date);
    const pack = await buildPack({ disc_no: disc.cd_no, scanned_at: scannedAt, built_at: builtAt, folders, files: discFiles });

    const bytes = pack.parts.reduce((sum, p) => sum + p.bytes, 0);
    for (const part of pack.parts) files[archivePackPath(disc.cd_no, pack.pack_hash, part.part)] = part.data;
    const mediaType = inferMediaType(pack.total_kb);
    manifestDiscs.push({
      disc_no: disc.cd_no,
      label: null,
      title: null,
      media_type: mediaType,
      status: "available",
      location_id: null,
      location_slot: null,
      notes: null,
      meta: JSON.stringify({ source: "dvd_manager.mdb", media_type_inferred: true }),
      created_at: scannedAt ?? builtAt,
      scanned_at: scannedAt,
      folder_count: pack.folder_count,
      file_count: pack.file_count,
      total_kb: pack.total_kb,
      pack_hash: pack.pack_hash,
      pack_version: pack.pack_version,
      parts: pack.parts.map((p) => ({ hash: p.hash, bytes: p.bytes })),
    });

    report.folders += pack.folder_count;
    report.files += pack.file_count;
    report.totalKb += pack.total_kb;
    report.packBytes += bytes;
    report.largestPackBytes = Math.max(report.largestPackBytes, bytes);
    if (pack.parts.length > 1) report.multiPartDiscs++;
    if (pack.file_count === 0) report.emptyDiscs.push(disc.cd_no);
    report.invalidFileDates += discFiles.filter((f) => !isValidCatalogDate(f.created, builtAt)).length;
    report.mediaTypes[mediaType] = (report.mediaTypes[mediaType] ?? 0) + 1;
    options.onProgress?.(index + 1, discs.length);
  }

  const numbers = new Set(discs.map((d) => d.cd_no));
  const maxNo = Math.max(0, ...numbers);
  for (let n = 1; n <= maxNo; n++) if (!numbers.has(n)) report.missingDiscNumbers.push(n);

  const manifest: ArchiveManifest = {
    v: ARCHIVE_FORMAT_VERSION,
    source: "dvd_manager.mdb",
    created_at: builtAt,
    counts: { discs: report.discs, folders: report.folders, files: report.files },
    discs: manifestDiscs,
  };
  const encoder = new TextEncoder();
  files[ARCHIVE_MANIFEST_PATH] = encoder.encode(JSON.stringify(manifest));
  files[ARCHIVE_META_PATH] = encoder.encode(JSON.stringify({ v: ARCHIVE_FORMAT_VERSION, tables: {} }));

  // Packs are already gzipped, so the zip only stores them.
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) => [path, [data, { level: 0 }]])));
  return { zip, manifest, report };
}
