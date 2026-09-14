import type { SqlDb } from "@discvault/schema";
import {
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_MANIFEST_PATH,
  ARCHIVE_META_PATH,
  type ArchiveDisc,
  type ArchiveManifest,
  archivePackPath,
  buildPack,
  SYNCED_TABLE_NAMES,
} from "@discvault/sync-protocol";
import { zipSync } from "fflate";

export interface ExportResult {
  zip: Uint8Array;
  manifest: ArchiveManifest;
}

interface DiscRow {
  disc_no: number;
  label: string | null;
  title: string | null;
  media_type: string | null;
  status: string;
  notes: string | null;
  meta: string | null;
  created_at: string;
  scanned_at: string | null;
  pack_version: number;
}

/**
 * Rebuilds a `.dvault` archive from this device's local database (§3.7): one pack per disc,
 * rebuilt from the `folder`/`file` tables, plus every other synced table as `meta.json` so the
 * archive can seed a brand new vault (not just re-import discs).
 */
export async function exportArchive(
  db: SqlDb,
  options: { builtAt?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<ExportResult> {
  const builtAt = options.builtAt ?? new Date().toISOString();
  const discs = db.all<DiscRow>("SELECT * FROM disc WHERE deleted_at IS NULL ORDER BY disc_no");

  const files: Record<string, Uint8Array> = {};
  const manifestDiscs: ArchiveDisc[] = [];
  let totalFolders = 0;
  let totalFiles = 0;

  for (const [index, disc] of discs.entries()) {
    const folders = db.all<{ id: number; parent: number | null; name: string; size_kb: number | null; created: string | null }>(
      "SELECT folder_id AS id, parent_id AS parent, name, size_kb, created FROM folder WHERE disc_no = ?",
      [disc.disc_no],
    );
    const discFiles = db.all<{ folder: number | null; name: string; size_kb: number | null; created: string | null }>(
      "SELECT folder_id AS folder, name, size_kb, created FROM file WHERE disc_no = ?",
      [disc.disc_no],
    );
    const pack = await buildPack({ disc_no: disc.disc_no, scanned_at: disc.scanned_at, built_at: builtAt, folders, files: discFiles });
    for (const part of pack.parts) files[archivePackPath(disc.disc_no, pack.pack_hash, part.part)] = part.data;

    manifestDiscs.push({
      disc_no: disc.disc_no,
      label: disc.label,
      title: disc.title,
      media_type: disc.media_type,
      status: disc.status,
      notes: disc.notes,
      meta: disc.meta,
      created_at: disc.created_at,
      scanned_at: disc.scanned_at,
      folder_count: pack.folder_count,
      file_count: pack.file_count,
      total_kb: pack.total_kb,
      pack_hash: pack.pack_hash,
      pack_version: pack.pack_version,
      parts: pack.parts.map((p) => ({ hash: p.hash, bytes: p.bytes })),
    });
    totalFolders += pack.folder_count;
    totalFiles += pack.file_count;
    options.onProgress?.(index + 1, discs.length);
  }

  const manifest: ArchiveManifest = {
    v: ARCHIVE_FORMAT_VERSION,
    source: "discvault-export",
    created_at: builtAt,
    counts: { discs: discs.length, folders: totalFolders, files: totalFiles },
    discs: manifestDiscs,
  };

  const meta: Record<string, unknown[]> = {};
  for (const table of SYNCED_TABLE_NAMES) {
    if (table === "disc") continue; // discs travel through the manifest, not meta.json
    meta[table] = db.all(`SELECT * FROM ${table} WHERE deleted_at IS NULL`);
  }

  const encoder = new TextEncoder();
  files[ARCHIVE_MANIFEST_PATH] = encoder.encode(JSON.stringify(manifest));
  files[ARCHIVE_META_PATH] = encoder.encode(JSON.stringify({ v: ARCHIVE_FORMAT_VERSION, tables: meta }));

  // Packs are already gzipped, so the zip only stores them.
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) => [path, [data, { level: 0 }] as const])));
  return { zip, manifest };
}
