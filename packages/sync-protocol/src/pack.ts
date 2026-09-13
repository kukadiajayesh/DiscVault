import { gunzip, gzip, sha256Hex } from "./bytes.js";
import { LIMITS } from "./limits.js";
import { PACK_FORMAT_VERSION } from "./version.js";

/**
 * Disc pack (§9.3): one disc's folders and files as gzipped JSON, split into parts.
 * Rows are arrays and each part lists its own columns, so newer formats can add columns that
 * older importers ignore. Part 1 holds every folder; a folder's files are never split across parts.
 */

export interface PackFolder {
  /** Pack-local id; parents always come before their children. */
  id: number;
  parent: number | null;
  name: string;
  size_kb: number | null;
  created: string | null;
}

export interface PackFile {
  /** Pack-local folder id, or null for files at the disc root. */
  folder: number | null;
  name: string;
  size_kb: number | null;
  created: string | null;
}

export interface PackPartJson {
  v: number;
  disc_no: number;
  part: number;
  parts: number;
  scanned_at: string | null;
  /** When the pack was built; dates after this are flagged invalid. */
  built_at: string;
  folder_cols: string[];
  folders: unknown[][];
  file_cols: string[];
  files: unknown[][];
}

export interface BuiltPackPart {
  part: number;
  hash: string;
  bytes: number;
  data: Uint8Array;
}

export interface BuiltPack {
  disc_no: number;
  pack_hash: string;
  pack_version: number;
  scanned_at: string | null;
  built_at: string;
  folder_count: number;
  file_count: number;
  total_kb: number;
  parts: BuiltPackPart[];
}

const FOLDER_COLS = ["id", "parent", "name", "size_kb", "created"] as const;
const FILE_COLS = ["folder", "name", "size_kb", "created"] as const;
/** Catalog JSON compresses about 5×, so this many raw bytes ≈ one ~2 MB gzipped part. */
const RAW_BYTES_PER_PART = LIMITS.packPartTargetBytes * 5;

/** The pack hash commits to every part, in order. */
export function packHashOf(partHashes: string[]): Promise<string> {
  return sha256Hex(partHashes.join("\n"));
}

export async function buildPack(input: {
  disc_no: number;
  scanned_at: string | null;
  built_at: string;
  folders: PackFolder[];
  files: PackFile[];
}): Promise<BuiltPack> {
  const folders = orderFolders(input.folders);
  const idMap = new Map<number, number>(folders.map((f, i) => [f.id, i + 1]));
  const folderRows = folders.map((f, i) => [i + 1, f.parent === null ? null : (idMap.get(f.parent) ?? null), f.name, f.size_kb, f.created]);

  // Group files by folder (in folder order, root files first) so a folder never spans parts.
  const groups = new Map<number, unknown[][]>();
  for (const file of input.files) {
    const folderId = file.folder === null ? 0 : idMap.get(file.folder);
    if (folderId === undefined) throw new Error(`disc ${input.disc_no}: file ${file.name} has an unknown folder`);
    let rows = groups.get(folderId);
    if (!rows) {
      rows = [];
      groups.set(folderId, rows);
    }
    rows.push([folderId === 0 ? null : folderId, file.name, file.size_kb, file.created]);
  }

  const partFiles: unknown[][][] = [[]];
  let rawSize = JSON.stringify(folderRows).length;
  for (const folderId of [...groups.keys()].sort((a, b) => a - b)) {
    const rows = groups.get(folderId) ?? [];
    const size = JSON.stringify(rows).length;
    const current = partFiles[partFiles.length - 1] ?? [];
    if (current.length > 0 && rawSize + size > RAW_BYTES_PER_PART) {
      partFiles.push([...rows]);
      rawSize = size;
    } else {
      current.push(...rows);
      rawSize += size;
    }
  }

  const parts: BuiltPackPart[] = [];
  for (const [index, files] of partFiles.entries()) {
    const json: PackPartJson = {
      v: PACK_FORMAT_VERSION,
      disc_no: input.disc_no,
      part: index + 1,
      parts: partFiles.length,
      scanned_at: input.scanned_at,
      built_at: input.built_at,
      folder_cols: [...FOLDER_COLS],
      folders: index === 0 ? folderRows : [],
      file_cols: [...FILE_COLS],
      files,
    };
    const data = await gzip(new TextEncoder().encode(JSON.stringify(json)));
    parts.push({ part: index + 1, hash: await sha256Hex(data), bytes: data.byteLength, data });
  }

  return {
    disc_no: input.disc_no,
    pack_hash: await packHashOf(parts.map((p) => p.hash)),
    pack_version: PACK_FORMAT_VERSION,
    scanned_at: input.scanned_at,
    built_at: input.built_at,
    folder_count: folders.length,
    file_count: input.files.length,
    total_kb: input.files.reduce((sum, f) => sum + (f.size_kb ?? 0), 0),
    parts,
  };
}

/** Parents before children; siblings keep their input order. Throws on cycles or unknown parents. */
function orderFolders(folders: PackFolder[]): PackFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<number | null, PackFolder[]>();
  for (const f of folders) {
    const parent = f.parent !== null && byId.has(f.parent) ? f.parent : null;
    if (f.parent !== null && !byId.has(f.parent)) throw new Error(`folder ${f.name} has an unknown parent`);
    let list = children.get(parent);
    if (!list) {
      list = [];
      children.set(parent, list);
    }
    list.push(f);
  }
  const ordered: PackFolder[] = [];
  const queue = [...(children.get(null) ?? [])];
  while (queue.length > 0) {
    const f = queue.shift() as PackFolder;
    ordered.push(f);
    queue.push(...(children.get(f.id) ?? []));
  }
  if (ordered.length !== folders.length) throw new Error("folder tree has a cycle");
  return ordered;
}

export interface ParsedPackPart {
  v: number;
  disc_no: number;
  part: number;
  parts: number;
  scanned_at: string | null;
  built_at: string;
  folders: PackFolder[];
  files: PackFile[];
}

/** Reads a gzipped part. Columns are looked up by name, so unknown future columns are ignored. */
export async function parsePackPart(data: Uint8Array): Promise<ParsedPackPart> {
  const json = JSON.parse(new TextDecoder().decode(await gunzip(data))) as PackPartJson;
  if (typeof json.v !== "number" || json.v < 1) throw new Error("not a DiscVault pack");
  const fc = columnIndex(json.folder_cols, FOLDER_COLS);
  const lc = columnIndex(json.file_cols, FILE_COLS);
  return {
    v: json.v,
    disc_no: json.disc_no,
    part: json.part,
    parts: json.parts,
    scanned_at: json.scanned_at ?? null,
    built_at: json.built_at,
    folders: json.folders.map((r) => ({
      id: r[fc.id] as number,
      parent: (r[fc.parent] as number | null) ?? null,
      name: r[fc.name] as string,
      size_kb: (r[fc.size_kb] as number | null) ?? null,
      created: (r[fc.created] as string | null) ?? null,
    })),
    files: json.files.map((r) => ({
      folder: (r[lc.folder] as number | null) ?? null,
      name: r[lc.name] as string,
      size_kb: (r[lc.size_kb] as number | null) ?? null,
      created: (r[lc.created] as string | null) ?? null,
    })),
  };
}

function columnIndex<K extends string>(cols: string[], required: readonly K[]): Record<K, number> {
  const index = {} as Record<K, number>;
  for (const name of required) {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`pack is missing column ${name}`);
    index[name] = i;
  }
  return index;
}

/** KV key of one pack part. Always built on the server from the session's vault id. */
export function packKvKey(vaultId: string, discNo: number, packHash: string, part: number): string {
  return `v:${vaultId}:pack:${discNo}:${packHash}:${part}`;
}
