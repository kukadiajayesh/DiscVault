/**
 * Stable references to catalog items that survive re-scans (folder/file ids are local only):
 *   d:116                               a disc
 *   p:116:movies/constantine            a folder (lower-cased path relative to the disc)
 *   f:116:movies/constantine/cd1.avi    a file
 */
export type ItemKey =
  | { kind: "disc"; discNo: number }
  | { kind: "folder"; discNo: number; path: string }
  | { kind: "file"; discNo: number; path: string };

export function discKey(discNo: number): string {
  return `d:${discNo}`;
}

export function folderKey(discNo: number, relPath: string): string {
  return `p:${discNo}:${relPath.toLowerCase()}`;
}

export function fileKey(discNo: number, relPath: string): string {
  return `f:${discNo}:${relPath.toLowerCase()}`;
}

const ITEM_KEY_RE = /^(d):(\d+)$|^([pf]):(\d+):(.+)$/;

export function parseItemKey(key: string): ItemKey | null {
  const m = ITEM_KEY_RE.exec(key);
  if (!m) return null;
  if (m[1] === "d") return { kind: "disc", discNo: Number(m[2]) };
  const discNo = Number(m[4]);
  const path = m[5] ?? "";
  return m[3] === "p" ? { kind: "folder", discNo, path } : { kind: "file", discNo, path };
}

export function isItemKey(key: string): boolean {
  return parseItemKey(key) !== null;
}
