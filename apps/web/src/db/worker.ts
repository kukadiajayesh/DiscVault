import type { SqlDb, SqlValue } from "@discvault/schema";
import { uuidv7 } from "@discvault/sync-protocol";
import sqlite3InitModule, { type OpfsSAHPoolDatabase, type SAHPoolUtil } from "@sqlite.org/sqlite-wasm";
import { expose } from "comlink";
import { type ExportResult, exportArchive } from "../archive/export.js";
import {
  type ArchiveDiscPreview,
  type ArchivePreview,
  type CollisionResolution,
  type ImportResult,
  importArchive,
  previewArchive,
} from "../archive/import.js";
import { SyncEngine, type SyncReport } from "../sync/engine.js";
import { httpTransport } from "../sync/transport.js";
import { getState, prepareLocalDb, setState } from "./local-db.js";
import { type CatalogStats, catalogStats, type FileHit, searchFiles } from "./search.js";

/**
 * Runs inside a dedicated Worker (SQLite WASM cannot use OPFS synchronous access handles on the
 * main thread). One SQLite file per vault, `vault-{vault_id}.sqlite3`, in a shared SAH pool (§9.1).
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
 * Only one tab may hold a vault's SAH pool file open at a time. Rather than proxy writes through
 * a leader tab, a second tab is simply refused (`vault-open-elsewhere`) and shows read-only or
 * "open in another tab" (decision #10).
 */
async function acquireExclusiveLock(name: string): Promise<ReleaseFn | null> {
  return new Promise((resolve) => {
    let release: ReleaseFn = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    navigator.locks
      .request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        resolve(release);
        await held;
      })
      .catch(() => {});
  });
}

interface StorageStatus {
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

let current: OpenVault | null = null;

function requireDb(): SqlDb {
  if (!current) throw new Error("no vault is open");
  return current.db;
}

export interface OpenResult {
  stats: CatalogStats;
  storage: StorageStatus;
}

const api = {
  /** Opens (creating and migrating if needed) the local DB for one vault. Idempotent per vault. */
  async open(vaultId: string): Promise<OpenResult> {
    if (current && current.vaultId !== vaultId) throw new Error("another vault is already open in this tab; call close() first");
    if (!current) {
      const release = await acquireExclusiveLock(`discvault:vault:${vaultId}`);
      if (!release) throw new Error("vault-open-elsewhere");
      const poolUtil = await pool();
      const raw = new poolUtil.OpfsSAHPoolDb(vaultFilename(vaultId));
      const db = wasmSqlDb(raw);
      prepareLocalDb(db);
      setState(db, "vault_id", vaultId);
      current = { vaultId, db, release };
    }
    return { stats: catalogStats(current.db), storage: await ensurePersistence() };
  },

  /** Releases the tab's exclusive lock without deleting anything. */
  async close(): Promise<void> {
    current?.release();
    current = null;
  },

  /** "Sign out & wipe" (§3.4): deletes only this vault's OPFS file. */
  async wipe(vaultId: string): Promise<void> {
    if (current?.vaultId === vaultId) {
      current.release();
      current = null;
    }
    (await pool()).unlink(vaultFilename(vaultId));
  },

  async search(query: string, options: { limit?: number; offset?: number } = {}): Promise<FileHit[]> {
    return searchFiles(requireDb(), query, options);
  },

  async stats(): Promise<CatalogStats> {
    return catalogStats(requireDb());
  },

  async previewArchive(zipBytes: Uint8Array): Promise<ArchivePreview> {
    return previewArchive(requireDb(), zipBytes);
  },

  /** `resolutions` maps a colliding disc_no to how to handle it; unlisted collisions are skipped. */
  async importArchive(zipBytes: Uint8Array, resolutions: Record<number, CollisionResolution> = {}): Promise<ImportResult> {
    return importArchive(requireDb(), zipBytes, { resolve: (discNo) => resolutions[discNo] ?? "skip" });
  },

  async exportArchive(): Promise<ExportResult> {
    return exportArchive(requireDb());
  },

  async sync(): Promise<SyncReport> {
    return new SyncEngine(requireDb(), httpTransport()).sync();
  },

  /** Stable per-device id, stored in the vault's own DB so it survives across sign-ins here. */
  async deviceId(): Promise<string> {
    const db = requireDb();
    let id = getState(db, "device_id");
    if (!id) {
      id = uuidv7();
      setState(db, "device_id", id);
    }
    return id;
  },
};

export type VaultWorkerApi = typeof api;
export type { ArchiveDiscPreview };

expose(api);
