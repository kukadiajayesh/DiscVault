import type { PackFile, PackFolder } from "@discvault/sync-protocol";

/**
 * Reads a mounted disc's file listing directly in the browser via the File System Access API
 * (§8 screen 7, step 2: "Chrome and Edge can read the drive directly"). Not implemented here:
 * archive contents, EXIF/ID3/video details, thumbnails (§8.00, phase 3b) — only names, sizes and
 * dates, matching the MVP scan.
 */

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/** Opens the browser's folder picker. Returns `null` if the user cancels. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    return await window.showDirectoryPicker({ mode: "read" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

export interface ScanResult {
  folders: PackFolder[];
  files: PackFile[];
  totalKb: number;
}

function toKb(bytes: number): number {
  return Math.max(0, Math.round(bytes / 1024));
}

/** Walks the whole tree under `root`. Folder ids are pack-local (§9.3's `PackFolder.id`). */
export async function scanDirectory(root: FileSystemDirectoryHandle, onFile?: (count: number) => void): Promise<ScanResult> {
  const folders: PackFolder[] = [];
  const files: PackFile[] = [];
  let nextFolderId = 1;
  let totalKb = 0;
  let fileCount = 0;

  async function walk(dir: FileSystemDirectoryHandle, parentId: number | null): Promise<void> {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") {
        const id = nextFolderId++;
        folders.push({ id, parent: parentId, name, size_kb: null, created: null });
        await walk(handle, id);
      } else {
        const file = await handle.getFile();
        const sizeKb = toKb(file.size);
        totalKb += sizeKb;
        files.push({ folder: parentId, name, size_kb: sizeKb, created: new Date(file.lastModified).toISOString() });
        fileCount++;
        onFile?.(fileCount);
      }
    }
  }

  await walk(root, null);
  return { folders, files, totalKb };
}
