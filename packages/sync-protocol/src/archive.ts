import { z } from "zod";
import { ARCHIVE_FORMAT_VERSION } from "./version.js";

/**
 * `.dvault` archive (zip), §3.7:
 *   manifest.json
 *   packs/{disc_no}-{pack_hash}-{part}.json.gz
 *   meta.json
 */
export const ARCHIVE_MANIFEST_PATH = "manifest.json";
export const ARCHIVE_META_PATH = "meta.json";

export function archivePackPath(discNo: number, packHash: string, part: number): string {
  return `packs/${discNo}-${packHash}-${part}.json.gz`;
}

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const ArchiveDisc = z.object({
  disc_no: z.number().int().min(1),
  label: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  media_type: z.string().nullable().default(null),
  status: z.string().default("available"),
  notes: z.string().nullable().default(null),
  meta: z.string().nullable().default(null),
  created_at: z.string(),
  scanned_at: z.string().nullable(),
  folder_count: z.number().int().min(0),
  file_count: z.number().int().min(0),
  total_kb: z.number().int().min(0),
  pack_hash: sha256,
  pack_version: z.number().int().min(1),
  parts: z.array(z.object({ hash: sha256, bytes: z.number().int().min(1) })).min(1),
});
export type ArchiveDisc = z.infer<typeof ArchiveDisc>;

export const ArchiveManifest = z.object({
  v: z.literal(ARCHIVE_FORMAT_VERSION),
  source: z.string(),
  created_at: z.string(),
  counts: z.object({
    discs: z.number().int(),
    folders: z.number().int(),
    files: z.number().int(),
  }),
  discs: z.array(ArchiveDisc),
});
export type ArchiveManifest = z.infer<typeof ArchiveManifest>;

/** Synced metadata rows by table name (rows as plain objects, including system columns). */
export const ArchiveMeta = z.object({
  v: z.literal(ARCHIVE_FORMAT_VERSION),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
export type ArchiveMeta = z.infer<typeof ArchiveMeta>;
