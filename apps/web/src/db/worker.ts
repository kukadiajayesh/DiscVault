import type { SqlDb, SqlValue } from "@discvault/schema";
import type { PackFile, PackFolder } from "@discvault/sync-protocol";
import { uuidv7 } from "@discvault/sync-protocol";
import sqlite3InitModule, { type OpfsSAHPoolDatabase, type SAHPoolUtil } from "@sqlite.org/sqlite-wasm";
import { expose } from "comlink";
import type { DiscItemDraft } from "../ai/classification.js";
import { type ExportResult, exportArchive } from "../archive/export.js";
import { type ArchiveDiscPreview, type CollisionResolution, type ImportResult, importArchive, previewArchive } from "../archive/import.js";
import { SyncEngine, type SyncReport } from "../sync/engine.js";
import { httpTransport } from "../sync/transport.js";
import {
  allExtensionCounts,
  buildDiscAiSummary,
  categoryBreakdown,
  extensionBreakdown,
  extensionCategoryMap,
  findFolderByPath,
  getDisc,
  largestFiles,
  listDiscs,
  listFolderChildren,
  mediaTypeBreakdown,
  missingDiscNumbers,
} from "./catalog.js";
import {
  discNosWithItems,
  getDiscItemImageBlob,
  itemGenreCounts,
  itemsByContentType,
  itemsByGenre,
  itemTypeCounts,
  listDiscItems,
  removeDiscItem,
  replaceDiscItems,
  saveDiscItemImageBlob,
  setDiscItemImageUrl,
} from "./disc-items.js";
import { LeaderChannel } from "./leader-channel.js";
import { getState, prepareLocalDb, setState } from "./local-db.js";
import { commitScannedPack, removeDiscCatalog, type ScannedDiscMeta } from "./packs.js";
import { deleteRow, writeRow } from "./rows.js";
import { type CatalogStats, catalogStats, searchFiles, searchFolders } from "./search.js";
import { recentSearches, recordSearch } from "./search-history.js";
import { discardOutboxEntry, dismissConflict, keepTheirs, listConflicts, listOutbox } from "./sync-admin.js";

/**
 * Runs inside a dedicated Worker (SQLite WASM cannot use OPFS synchronous access handles on the
 * main thread). One SQLite file per vault, `vault-{vault_id}.sqlite3`, in a shared SAH pool (§9.1).
 *
 * Only one tab may hold that file open at a time, so tabs race a Web Lock to become the vault's
 * *leader*; every other ("follower") tab never touches SQLite at all and instead forwards each
 * call to the leader over a `BroadcastChannel` (`LeaderChannel`, per vault). Web Locks release
 * automatically when the holding tab's worker is torn down (tab closed, navigated away, crashed),
 * so a follower waiting on the same lock name is promoted to leader in its place with no heartbeat
 * needed. Revisits decision #1 in PENDING.md, which refused a second tab instead of proxying it.
 */

let poolPromise: Promise<SAHPoolUtil> | null = null;

function pool(): Promise<SAHPoolUtil> {
  if (!poolPromise) {
    poolPromise = sqlite3InitModule()
      .then((sqlite3) => sqlite3.installOpfsSAHPoolVfs({ name: "discvault" }))
      .then(async (poolUtil) => {
        // Headroom for one vault's main file + journal/WAL/shm + temp files.
        await poolUtil.reserveMinimumCapacity(8);
        return poolUtil;
      })
      .catch((error: unknown) => {
        // Don't cache a failure (e.g. OPFS handles still held by a closing tab) — let Retry try again.
        poolPromise = null;
        throw error;
      });
  }
  return poolPromise;
}

function vaultFilename(vaultId: string): string {
  return `/vault-${vaultId}.sqlite3`;
}

function wasmSqlDb(raw: OpfsSAHPoolDatabase): SqlDb {
  let depth = 0;
  return {
    exec: (sql) => {
      raw.exec(sql);
    },
    run: (sql, params = []) => {
      raw.exec({ sql, bind: params as SqlValue[] & never[] });
      return { changes: Number(raw.changes()) };
    },
    all: <T>(sql: string, params: SqlValue[] = []) => raw.selectObjects(sql, params as SqlValue[] & never[]) as T[],
    get: <T>(sql: string, params: SqlValue[] = []) => raw.selectObjects(sql, params as SqlValue[] & never[])[0] as T | undefined,
    transaction<T>(fn: () => T): T {
      const name = `sp${depth++}`;
      raw.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn();
        raw.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        raw.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw error;
      } finally {
        depth--;
      }
    },
  };
}

type ReleaseFn = () => void;

/**
 * Requests a vault's exclusivity lock. With `ifAvailable: true` this resolves immediately —
 * `null` if another tab already holds it — used for the initial leader race. Without it, the
 * request queues and only resolves once the current holder releases the lock — used to wait for
 * promotion into leader; pass `signal` to give up on that wait (e.g. this tab stopped following).
 */
async function requestLock(name: string, opts: { ifAvailable?: boolean; signal?: AbortSignal } = {}): Promise<ReleaseFn | null> {
  return new Promise((resolve, reject) => {
    let release: ReleaseFn = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    navigator.locks
      .request(name, { mode: "exclusive", ifAvailable: opts.ifAvailable, signal: opts.signal }, async (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        resolve(release);
        await held;
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") resolve(null);
        else reject(error);
      });
  });
}

export interface StorageStatus {
  persisted: boolean;
  usage: number;
  quota: number;
}

async function ensurePersistence(): Promise<StorageStatus> {
  const already = (await navigator.storage.persisted?.()) ?? false;
  const persisted = already || ((await navigator.storage.persist?.()) ?? false);
  const estimate = (await navigator.storage.estimate?.()) ?? {};
  return { persisted, usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}

interface OpenVault {
  vaultId: string;
  db: SqlDb;
  release: ReleaseFn;
}

type Role = "leader" | "follower" | null;

/** Set only while this tab is the leader — it's the one tab with a real SQLite connection. */
let current: OpenVault | null = null;
let role: Role = null;
/** The vaultId this tab has open, in either role; guards against opening a second vault per tab. */
let openVaultId: string | null = null;
let channel: LeaderChannel | null = null;
/** Cached once the leader has actually finished opening SQLite; served to followers' "open" calls. */
let openResult: OpenResult | null = null;
let cancelPromotion: (() => void) | null = null;
/**
 * The in-flight first `open()`, shared by concurrent callers (e.g. React StrictMode running the
 * bootstrap effect twice). Without it the second call loses the lock race to the first and demotes
 * this same tab to a follower of itself — its `BroadcastChannel` never hears its own requests.
 */
let opening: Promise<OpenResult> | null = null;

function requireDb(): SqlDb {
  if (!current) throw new Error("no vault is open");
  return current.db;
}

function isLeader(): boolean {
  return role === "leader";
}

/** Wraps a local DB operation so a follower tab forwards it to the leader instead of running it. */
function remote<A extends unknown[], R>(name: string, fn: (...args: A) => R | Promise<R>, timeoutMs?: number): (...args: A) => Promise<R> {
  return async (...args: A) => {
    if (isLeader()) return fn(...args);
    if (!channel) throw new Error("no vault is open");
    return channel.call<R>(name, args, timeoutMs);
  };
}

/** A first sync on a new device downloads every pack, so a follower must wait far longer than 10 s. */
const SYNC_TIMEOUT_MS = 15 * 60_000;

/**
 * The leader's one in-flight sync, shared by every caller — this tab's timers and each follower
 * tab's focus/interval triggers — so two syncs never pull or push over each other.
 */
let syncInFlight: Promise<SyncReport> | null = null;

function runSync(mode: "full" | "if-needed"): Promise<SyncReport> {
  if (!syncInFlight) {
    const engine = new SyncEngine(requireDb(), httpTransport());
    syncInFlight = (mode === "full" ? engine.sync() : engine.syncIfNeeded()).finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}

function teardown(): void {
  cancelPromotion?.();
  cancelPromotion = null;
  current?.release();
  current = null;
  openResult = null;
  role = null;
  openVaultId = null;
  channel?.close();
  channel = null;
}

export interface OpenResult {
  stats: CatalogStats;
  storage: StorageStatus;
}

/** Opens this tab's own SQLite connection and starts serving calls forwarded by follower tabs. */
async function becomeLeader(vaultId: string, release: ReleaseFn): Promise<OpenResult> {
  role = "leader";
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });
  channel?.serve(async (method, args) => {
    await ready;
    if (method === "open") {
      if (!openResult) throw new Error("vault failed to open");
      return openResult;
    }
    const handler = (api as Record<string, (...a: unknown[]) => unknown>)[method];
    if (!handler) throw new Error(`unknown vault method: ${method}`);
    return handler(...args);
  });

  try {
    const poolUtil = await pool();
    const raw = new poolUtil.OpfsSAHPoolDb(vaultFilename(vaultId));
    const db = wasmSqlDb(raw);
    prepareLocalDb(db);
    setState(db, "vault_id", vaultId);
    current = { vaultId, db, release };
    openResult = { stats: catalogStats(db), storage: await ensurePersistence() };
  } catch (error) {
    // `current` was never set, so teardown() can't release the lock — do it here, or this tab keeps
    // the vault locked while unable to serve it, and every follower/Retry hangs on it.
    if (!current) release();
    resolveReady(); // lets queued follower calls fail fast ("vault failed to open") instead of timing out
    throw error;
  }
  resolveReady();
  return openResult;
}

/**
 * Waits for the current leader to go away — its lock releases automatically when its tab/worker
 * is torn down — and takes over as leader in its place. Cancelled by `cancelPromotion()` if this
 * tab stops following before that happens (e.g. `close()`).
 */
function watchForPromotion(vaultId: string, lockName: string): void {
  const controller = new AbortController();
  cancelPromotion = () => controller.abort();
  requestLock(lockName, { signal: controller.signal })
    .then((release) => {
      if (!release || role !== "follower") return;
      cancelPromotion = null;
      return becomeLeader(vaultId, release);
    })
    .catch(() => {});
}

const api = {
  /** Opens (creating and migrating if needed) the local DB for one vault. Idempotent per vault. */
  async open(vaultId: string): Promise<OpenResult> {
    if (openVaultId && openVaultId !== vaultId) throw new Error("another vault is already open in this tab; call close() first");
    if (role === "leader" && current) return { stats: catalogStats(current.db), storage: await ensurePersistence() };
    if (role === "follower") {
      if (!channel) throw new Error("no vault is open");
      return channel.call<OpenResult>("open", [vaultId], 20_000);
    }
    if (opening) return opening;

    const attempt = (async () => {
      const ownChannel = new LeaderChannel(vaultId);
      channel = ownChannel;
      openVaultId = vaultId;
      const release = await requestLock(`discvault:vault:${vaultId}`, { ifAvailable: true });
      if (release) return becomeLeader(vaultId, release);

      role = "follower";
      watchForPromotion(vaultId, `discvault:vault:${vaultId}`);
      return ownChannel.call<OpenResult>("open", [vaultId], 20_000);
    })();
    opening = attempt;
    try {
      return await attempt;
    } catch (error) {
      // Release the lock / channel so a Retry starts clean instead of racing this tab's own leftovers.
      teardown();
      throw error;
    } finally {
      if (opening === attempt) opening = null;
    }
  },

  /** Releases the tab's exclusive lock (or stops following) without deleting anything. */
  async close(): Promise<void> {
    teardown();
  },

  /** "Sign out & wipe" (§3.4): deletes only this vault's OPFS file. Always runs on the leader,
   * since only it holds the file open — a follower forwards the call rather than racing it. */
  async wipe(vaultId: string): Promise<void> {
    if (role === "follower" && openVaultId === vaultId) {
      if (!channel) throw new Error("no vault is open");
      await channel.call("wipe", [vaultId]);
      teardown();
      return;
    }
    const wasLeader = current?.vaultId === vaultId;
    if (wasLeader) channel?.stopServing();
    (await pool()).unlink(vaultFilename(vaultId));
    if (wasLeader) teardown();
  },

  search: remote("search", (query: string, options: { limit?: number; offset?: number } = {}) => searchFiles(requireDb(), query, options)),

  searchFolders: remote("searchFolders", (query: string, options: { limit?: number; offset?: number } = {}) =>
    searchFolders(requireDb(), query, options),
  ),

  stats: remote("stats", () => catalogStats(requireDb())),

  /** Persistence + quota (§8: Sync & storage, and the shell's footer). */
  storageEstimate: remote("storageEstimate", () => {
    requireDb();
    return ensurePersistence();
  }),

  listDiscs: remote("listDiscs", () => listDiscs(requireDb())),

  missingDiscNumbers: remote("missingDiscNumbers", () => missingDiscNumbers(requireDb())),

  /** Disc library "Mark retired / lost" on a never-scanned disc number (§8: Disc library). */
  setDiscStatus: remote("setDiscStatus", (discNo: number, status: string) => {
    writeRow(requireDb(), "disc", String(discNo), { status });
  }),

  setDiscNotes: remote("setDiscNotes", (discNo: number, notes: string) => {
    writeRow(requireDb(), "disc", String(discNo), { notes });
  }),

  /** Auto-title from AI analysis (§ AI: disc identification) — only ever called when the disc has no title yet. */
  setDiscTitle: remote("setDiscTitle", (discNo: number, title: string) => {
    writeRow(requireDb(), "disc", String(discNo), { title });
  }),

  /**
   * Caches the exact text of the most recent Gemini analysis on the disc row, before any of it is
   * turned into `disc_item` rows — an audit trail/fallback that survives even if the structured
   * insert below fails or the parsing logic changes later.
   */
  saveDiscAiRaw: remote("saveDiscAiRaw", (discNo: number, entry: { model: string; analyzedAt: string; response: string }) => {
    const db = requireDb();
    const disc = getDisc(db, discNo);
    const meta = disc?.meta ? (JSON.parse(disc.meta) as Record<string, unknown>) : {};
    meta.aiRaw = entry;
    writeRow(db, "disc", String(discNo), { meta });
  }),

  /** Scan wizard "Save" (§8 screen 7, step 5): commits a live folder scan as a new disc pack. */
  commitScannedPack: remote("commitScannedPack", (discNo: number, meta: ScannedDiscMeta, folders: PackFolder[], files: PackFile[]) =>
    commitScannedPack(requireDb(), discNo, meta, folders, files),
  ),

  /** Disc explorer "Delete" (§8 overlay E): removes the disc row, its local catalog and its AI-identified items. */
  deleteDisc: remote("deleteDisc", (discNo: number) => {
    const db = requireDb();
    db.transaction(() => {
      for (const item of listDiscItems(db, discNo)) removeDiscItem(db, item.id);
      removeDiscCatalog(db, discNo);
      deleteRow(db, "disc", String(discNo));
    });
  }),

  getDisc: remote("getDisc", (discNo: number) => getDisc(requireDb(), discNo)),

  /** `relPath` is the folder's path from the disc root ('' for the root itself). */
  listFolder: remote("listFolder", (discNo: number, relPath: string) => {
    const db = requireDb();
    return listFolderChildren(db, discNo, findFolderByPath(db, discNo, relPath));
  }),

  categoryBreakdown: remote("categoryBreakdown", (discNo?: number) => categoryBreakdown(requireDb(), discNo)),

  extensionBreakdown: remote("extensionBreakdown", (discNo: number) => extensionBreakdown(requireDb(), discNo)),

  largestFiles: remote("largestFiles", (discNo: number) => largestFiles(requireDb(), discNo)),

  /** Names-and-counts summary of a disc, sent to Gemini for on-demand item identification (§ AI). */
  discAiSummary: remote("discAiSummary", (discNo: number) => buildDiscAiSummary(requireDb(), discNo)),

  /** AI-identified items on a disc (§ AI: disc identification), for the overview tab. */
  discItems: remote("discItems", (discNo: number) => listDiscItems(requireDb(), discNo)),

  /** Disc numbers already carrying at least one AI-identified item — the library's bulk analyze skips these. */
  discNosWithAiItems: remote("discNosWithAiItems", () => discNosWithItems(requireDb())),

  /**
   * Saves one AI analysis run (from `ai/gemini.ts`, run client-side) as a disc's identified items,
   * replacing whatever it had before — so re-analyzing doesn't duplicate the previous run's items
   * alongside the new ones. Returns the new items' ids.
   */
  applyDiscItems: remote("applyDiscItems", (discNo: number, drafts: DiscItemDraft[]) => replaceDiscItems(requireDb(), discNo, drafts)),

  removeDiscItem: remote("removeDiscItem", (id: string) => {
    removeDiscItem(requireDb(), id);
  }),

  /** Sets one item's resolved external preview-image URL after a best-effort lookup (§ image preview). */
  setDiscItemImageUrl: remote("setDiscItemImageUrl", (id: string, imageUrl: string | null) => {
    setDiscItemImageUrl(requireDb(), id, imageUrl);
  }),

  /** Locally cached preview-image bytes for one item, for offline-first rendering (§ image preview). */
  discItemImageBlob: remote("discItemImageBlob", (itemId: string) => getDiscItemImageBlob(requireDb(), itemId)),

  /**
   * Downloads one item's resolved preview image and caches its bytes for offline viewing. Purely
   * opportunistic: any failure (offline, CORS, a dead link) is swallowed and reported back as
   * `false` rather than thrown, since this must never be on the critical path of anything else.
   */
  cacheDiscItemImage: remote("cacheDiscItemImage", async (itemId: string, imageUrl: string): Promise<boolean> => {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) return false;
      const contentType = response.headers.get("content-type") || "image/jpeg";
      const data = new Uint8Array(await response.arrayBuffer());
      saveDiscItemImageBlob(requireDb(), itemId, contentType, data);
      return true;
    } catch {
      return false;
    }
  }),

  /** Counts of identified items per content type, for the library's category cards. */
  discItemTypeCounts: remote("discItemTypeCounts", () => itemTypeCounts(requireDb())),

  /** Identified items of one content type with their source disc, for the library's list. */
  discItemsByType: remote("discItemsByType", (contentType: string) => itemsByContentType(requireDb(), contentType)),

  /** Distinct genre tags across every identified item, with counts — for the library's dynamic genre cards. */
  discItemGenreCounts: remote("discItemGenreCounts", () => itemGenreCounts(requireDb())),

  /** Identified items carrying one genre tag, any content type, with their source disc. */
  discItemsByGenre: remote("discItemsByGenre", (genre: string) => itemsByGenre(requireDb(), genre)),

  mediaTypeBreakdown: remote("mediaTypeBreakdown", () => mediaTypeBreakdown(requireDb())),

  extensionCategoryMap: remote("extensionCategoryMap", () => extensionCategoryMap(requireDb())),

  allExtensionCounts: remote("allExtensionCounts", () => allExtensionCounts(requireDb())),

  /** Settings → Categories: user override for one extension's category. */
  setCategoryOverride: remote("setCategoryOverride", (ext: string, category: string) => {
    writeRow(requireDb(), "category_override", ext, { category });
  }),

  recordSearch: remote("recordSearch", (query: string, resultCount: number) => {
    recordSearch(requireDb(), query, resultCount);
  }),

  recentSearches: remote("recentSearches", (limit?: number) => recentSearches(requireDb(), limit)),

  previewArchive: remote("previewArchive", (zipBytes: Uint8Array) => previewArchive(requireDb(), zipBytes)),

  /** `resolutions` maps a colliding disc_no to how to handle it; unlisted collisions are skipped. */
  importArchive: remote(
    "importArchive",
    (zipBytes: Uint8Array, resolutions: Record<number, CollisionResolution> = {}): Promise<ImportResult> =>
      importArchive(requireDb(), zipBytes, { resolve: (discNo) => resolutions[discNo] ?? "skip" }),
  ),

  exportArchive: remote("exportArchive", (): Promise<ExportResult> => exportArchive(requireDb())),

  sync: remote("sync", (): Promise<SyncReport> => runSync("full"), SYNC_TIMEOUT_MS),

  /** Automatic sync (app open, focus, reconnect, interval): a 1-row head check unless there's work. */
  syncIfNeeded: remote("syncIfNeeded", (): Promise<SyncReport> => runSync("if-needed"), SYNC_TIMEOUT_MS),

  listOutbox: remote("listOutbox", () => listOutbox(requireDb())),

  discardOutboxEntry: remote("discardOutboxEntry", (id: string) => {
    discardOutboxEntry(requireDb(), id);
  }),

  listConflicts: remote("listConflicts", () => listConflicts(requireDb())),

  keepTheirs: remote("keepTheirs", (conflictId: string) => {
    keepTheirs(requireDb(), conflictId);
  }),

  dismissConflict: remote("dismissConflict", (conflictId: string) => {
    dismissConflict(requireDb(), conflictId);
  }),

  /** Stable per-device id, stored in the vault's own DB so it survives across sign-ins here. */
  deviceId: remote("deviceId", () => {
    const db = requireDb();
    let id = getState(db, "device_id");
    if (!id) {
      id = uuidv7();
      setState(db, "device_id", id);
    }
    return id;
  }),
};

export type VaultWorkerApi = typeof api;
export type { ArchiveDiscPreview };

expose(api);
