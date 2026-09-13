import type { SqlDb } from "@discvault/schema";
import {
  LIMITS,
  type PushEntry,
  type PushResult,
  parsePackPart,
  SYNCED_TABLES,
  sha256Hex,
  uuidv7,
  validateRowId,
} from "@discvault/sync-protocol";
import { getState, nowIso, setState } from "../db/local-db.js";
import { importPackParts, removeDiscCatalog } from "../db/packs.js";
import { applyChanges, type OutboxRow } from "../db/rows.js";
import { SyncHttpError, type SyncTransport } from "./transport.js";

export type SyncStatus =
  | { state: "synced"; lastSyncAt: string | null }
  | { state: "offline" }
  | { state: "paused"; until: string; reason: string }
  | { state: "signed_out" }
  | { state: "update_required" }
  | { state: "error"; message: string };

export interface SyncReport {
  status: SyncStatus;
  pulled: number;
  pushed: number;
  packsDownloaded: number;
  packsUploaded: number;
  conflicts: number;
  pending: number;
}

export type SyncProgress = (event: { phase: "pull" | "packs" | "upload" | "push"; done: number; total: number }) => void;

const PACK_DOWNLOAD_CONCURRENCY = 4;

/**
 * Offline-first sync for one vault's local database (§6.3): pull row changes, load changed disc
 * packs, upload pending packs, push the outbox. Every step is resumable; nothing here is lost if
 * the network drops or a daily limit is hit.
 */
export class SyncEngine {
  constructor(
    private readonly db: SqlDb,
    private readonly transport: SyncTransport,
  ) {}

  deviceId(): string {
    let id = getState(this.db, "device_id");
    if (!id) {
      id = uuidv7();
      setState(this.db, "device_id", id);
    }
    return id;
  }

  async sync(onProgress?: SyncProgress): Promise<SyncReport> {
    const report: SyncReport = {
      status: { state: "synced", lastSyncAt: null },
      pulled: 0,
      pushed: 0,
      packsDownloaded: 0,
      packsUploaded: 0,
      conflicts: 0,
      pending: 0,
    };
    const pausedUntil = getState(this.db, "paused_until");
    if (pausedUntil && Date.parse(pausedUntil) > Date.now()) {
      report.status = { state: "paused", until: pausedUntil, reason: getState(this.db, "last_error") ?? "daily free limit" };
      report.pending = this.pendingCount();
      return report;
    }
    try {
      // Push first so the pull that follows already includes this device's accepted edits.
      report.packsUploaded = await this.uploadPendingPacks(onProgress);
      const pushed = await this.pushOutbox(onProgress);
      report.pushed = pushed.pushed;
      report.conflicts = pushed.conflicts;
      if (pushed.deferredUntil) this.pause(pushed.deferredUntil, "daily metadata write quota");
      report.pulled = await this.pull(onProgress);
      report.packsDownloaded = await this.loadChangedPacks(onProgress);
      const at = nowIso();
      setState(this.db, "last_sync_at", at);
      setState(this.db, "last_error", null);
      report.status = pushed.deferredUntil
        ? { state: "paused", until: pushed.deferredUntil, reason: "daily metadata write quota" }
        : { state: "synced", lastSyncAt: at };
    } catch (error) {
      report.status = this.statusFor(error);
    }
    report.pending = this.pendingCount();
    return report;
  }

  /** Cheap check (1 row read on the server): has anything changed since the last pull? */
  async hasRemoteChanges(): Promise<boolean> {
    const head = await this.transport.head();
    return head.seq > Number(getState(this.db, "last_seq") ?? 0);
  }

  pendingCount(): number {
    return Number(this.db.get<{ n: number }>("SELECT count(*) AS n FROM outbox WHERE blocked = 0")?.n ?? 0);
  }

  // ── Pull ───────────────────────────────────────────────────────────────
  async pull(onProgress?: SyncProgress): Promise<number> {
    let since = Number(getState(this.db, "last_seq") ?? 0);
    let applied = 0;
    for (;;) {
      const page = await this.transport.changes(since, LIMITS.changesPageSize);
      applied += applyChanges(this.db, page.changes).applied;
      since = page.next;
      setState(this.db, "last_seq", since);
      onProgress?.({ phase: "pull", done: since, total: page.head });
      if (!page.hasMore) return applied;
    }
  }

  /** Discs whose server pack differs from the files loaded on this device, or that were deleted. */
  private discsNeedingPacks(): { disc_no: number; pack_hash: string | null; pack_parts: number; deleted: number }[] {
    return this.db.all(
      `SELECT d.disc_no, d.pack_hash, d.pack_parts, d.deleted_at IS NOT NULL AS deleted
       FROM disc d LEFT JOIN local_pack lp ON lp.disc_no = d.disc_no
       WHERE (d.deleted_at IS NOT NULL AND lp.disc_no IS NOT NULL)
          OR (d.deleted_at IS NULL AND d.pack_hash IS NOT NULL AND lp.pack_hash IS NOT d.pack_hash
              AND NOT EXISTS (SELECT 1 FROM pending_pack_part p WHERE p.disc_no = d.disc_no))`,
    );
  }

  private async loadChangedPacks(onProgress?: SyncProgress): Promise<number> {
    const discs = this.discsNeedingPacks();
    let done = 0;
    let loaded = 0;
    const queue = [...discs];
    const worker = async () => {
      for (let disc = queue.shift(); disc; disc = queue.shift()) {
        if (disc.deleted) {
          removeDiscCatalog(this.db, disc.disc_no);
        } else if (disc.pack_hash) {
          const parts = [];
          for (let part = 1; part <= disc.pack_parts; part++) {
            parts.push(await parsePackPart(await this.transport.downloadPart(disc.disc_no, disc.pack_hash, part)));
          }
          importPackParts(this.db, disc.disc_no, disc.pack_hash, parts);
          loaded++;
        }
        onProgress?.({ phase: "packs", done: ++done, total: discs.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PACK_DOWNLOAD_CONCURRENCY, discs.length) }, worker));
    return loaded;
  }

  // ── Pack uploads ───────────────────────────────────────────────────────
  private async uploadPendingPacks(onProgress?: SyncProgress): Promise<number> {
    const packs = this.db.all<{ disc_no: number; pack_hash: string }>(
      "SELECT DISTINCT disc_no, pack_hash FROM pending_pack_part WHERE uploaded = 0 ORDER BY disc_no",
    );
    let uploaded = 0;
    for (let i = 0; i < packs.length; i += LIMITS.reserveBatchSize) {
      const batch = packs.slice(i, i + LIMITS.reserveBatchSize);
      const reserve = await this.transport.reserve({
        packs: batch.map((p) => ({
          disc_no: p.disc_no,
          pack_hash: p.pack_hash,
          parts: this.db
            .all<{ part_hash: string; bytes: number }>(
              "SELECT part_hash, bytes FROM pending_pack_part WHERE disc_no = ? AND pack_hash = ? ORDER BY part",
              [p.disc_no, p.pack_hash],
            )
            .map((part) => ({ hash: part.part_hash, bytes: part.bytes })),
        })),
      });
      for (const result of reserve.results) {
        if (result.status === "rejected") {
          this.blockPackCommit(result.disc_no, result.pack_hash, result.error ?? "pack rejected");
          continue;
        }
        const missing = new Set(result.missingParts);
        for (const part of this.db.all<{ part: number; data: Uint8Array }>(
          "SELECT part, data FROM pending_pack_part WHERE disc_no = ? AND pack_hash = ? AND uploaded = 0 ORDER BY part",
          [result.disc_no, result.pack_hash],
        )) {
          if (missing.has(part.part)) {
            await this.transport.uploadPart(result.disc_no, result.pack_hash, part.part, part.data);
          }
          this.db.run("UPDATE pending_pack_part SET uploaded = 1 WHERE disc_no = ? AND pack_hash = ? AND part = ?", [
            result.disc_no,
            result.pack_hash,
            part.part,
          ]);
        }
        onProgress?.({ phase: "upload", done: ++uploaded, total: packs.length });
      }
    }
    return uploaded;
  }

  private blockPackCommit(discNo: number, packHash: string, error: string): void {
    this.db.run(
      `UPDATE outbox SET blocked = 1, last_error = ?
       WHERE op = 'pack_commit' AND row_id = ? AND json_extract(payload, '$.pack_hash') = ?`,
      [error, String(discNo), packHash],
    );
  }

  // ── Push ───────────────────────────────────────────────────────────────
  private async pushOutbox(onProgress?: SyncProgress): Promise<{ pushed: number; conflicts: number; deferredUntil: string | null }> {
    let pushed = 0;
    let conflicts = 0;
    const total = this.pendingCount();
    const deviceId = this.deviceId();
    for (;;) {
      const batch = this.nextBatch();
      if (batch.length === 0) return { pushed, conflicts, deferredUntil: null };
      for (const entry of batch) this.db.run("UPDATE outbox SET attempts = attempts + 1 WHERE id = ?", [entry.id]);

      const response = await this.transport.push({
        deviceId,
        entries: batch.map(
          (e): PushEntry => ({
            id: e.id,
            table: e.table_name,
            rowId: e.row_id,
            op: e.op,
            fields: JSON.parse(e.payload) as Record<string, unknown>,
            baseVersion: e.base_version,
            createdAt: e.created_at,
          }),
        ),
      });

      let deferredUntil: string | null = null;
      for (const result of response.results) {
        const entry = batch.find((e) => e.id === result.id);
        if (!entry) continue;
        if (result.status === "deferred") {
          deferredUntil = new Date(Date.now() + (result.retryAfter ?? 3600) * 1000).toISOString();
          continue;
        }
        this.handleResult(entry, result);
        if (result.status === "applied" || result.status === "duplicate") pushed++;
        if (result.status === "conflict") conflicts++;
      }
      onProgress?.({ phase: "push", done: pushed, total });
      if (deferredUntil) return { pushed, conflicts, deferredUntil };
    }
  }

  /** Oldest unblocked entries, never two for the same row (so each carries the right base version). */
  private nextBatch(): OutboxRow[] {
    const candidates = this.db.all<OutboxRow>(`SELECT * FROM outbox WHERE blocked = 0 ORDER BY rowid LIMIT ${LIMITS.pushBatchSize * 2}`);
    const batch: OutboxRow[] = [];
    const rows = new Set<string>();
    for (const entry of candidates) {
      const key = `${entry.table_name}:${entry.row_id}`;
      if (rows.has(key)) break;
      if (entry.op === "pack_commit" && this.hasUnuploadedParts(entry)) break;
      rows.add(key);
      batch.push(entry);
      if (batch.length === LIMITS.pushBatchSize) break;
    }
    return batch;
  }

  private hasUnuploadedParts(entry: OutboxRow): boolean {
    const hash = (JSON.parse(entry.payload) as { pack_hash?: string }).pack_hash ?? "";
    return Boolean(
      this.db.get("SELECT 1 FROM pending_pack_part WHERE disc_no = ? AND pack_hash = ? AND uploaded = 0", [Number(entry.row_id), hash]),
    );
  }

  private handleResult(entry: OutboxRow, result: PushResult): void {
    const def = SYNCED_TABLES[entry.table_name];
    const rowId = validateRowId(entry.table_name, entry.row_id);
    this.db.transaction(() => {
      switch (result.status) {
        case "applied":
        case "duplicate": {
          this.db.run("DELETE FROM outbox WHERE id = ?", [entry.id]);
          const version = result.version ?? result.seq;
          if (version !== undefined && rowId.ok) {
            // Later edits of the same row were made on top of this one.
            this.db.run("UPDATE outbox SET base_version = ? WHERE table_name = ? AND row_id = ? AND base_version < ?", [
              version,
              entry.table_name,
              entry.row_id,
              version,
            ]);
          }
          if (entry.op === "pack_commit") {
            const hash = (JSON.parse(entry.payload) as { pack_hash: string }).pack_hash;
            this.db.run("DELETE FROM pending_pack_part WHERE disc_no = ? AND pack_hash = ?", [Number(entry.row_id), hash]);
          }
          break;
        }
        case "conflict":
          this.db.run("UPDATE outbox SET blocked = 1, last_error = ? WHERE id = ?", [result.error ?? "conflict", entry.id]);
          this.db.run(
            `INSERT INTO conflict (id, outbox_id, table_name, row_id, mine_json, theirs_json, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              uuidv7(),
              entry.id,
              def.name,
              entry.row_id,
              entry.payload,
              JSON.stringify(result.theirs ?? null),
              result.error ?? null,
              nowIso(),
            ],
          );
          break;
        case "rejected":
          this.db.run("UPDATE outbox SET blocked = 1, last_error = ? WHERE id = ?", [result.error ?? "rejected", entry.id]);
          break;
      }
    });
  }

  // ── Errors ─────────────────────────────────────────────────────────────
  private pause(until: string, reason: string): void {
    setState(this.db, "paused_until", until);
    setState(this.db, "last_error", reason);
  }

  private statusFor(error: unknown): SyncStatus {
    if (error instanceof SyncHttpError) {
      if (error.code === "network") return { state: "offline" };
      if (error.status === 401) return { state: "signed_out" };
      if (error.status === 426) return { state: "update_required" };
      if (error.status === 429) {
        const until = new Date(Date.now() + (error.retryAfter ?? 3600) * 1000).toISOString();
        this.pause(until, error.message);
        return { state: "paused", until, reason: error.message };
      }
      setState(this.db, "last_error", error.message);
      return { state: "error", message: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    setState(this.db, "last_error", message);
    return { state: "error", message };
  }
}

/** Verifies downloaded or imported bytes against the expected part hash. */
export async function verifyPart(data: Uint8Array, expectedHash: string): Promise<boolean> {
  return (await sha256Hex(data)) === expectedHash;
}
