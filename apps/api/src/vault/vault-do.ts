import { DurableObject } from "cloudflare:workers";
import { migrate, type SqlDb, VAULT_MIGRATIONS } from "@discvault/schema";
import {
  type ChangesResponse,
  LIMITS,
  type ManifestResponse,
  type PushEntry,
  packHashOf,
  type ReservePack,
  type ReserveResult,
  sha256Hex,
  type VaultQuotas,
  type VaultUsage,
} from "@discvault/sync-protocol";
import { enqueuePurge, releaseKvBytes, reserveKvWrite } from "../directory/directory.js";
import type { Env } from "../env.js";
import { secondsUntilUtcMidnight } from "../time.js";
import { durableSqlDb, tableVersionStore } from "./durable-sql.js";
import { type PurgeKey, type PushOutcome, VaultError, VaultStore } from "./vault-store.js";

export type VaultResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "not_found" | "bad_request" | "quota_exceeded" | "free_limit"; message: string; retryAfter?: number };

/**
 * One user's database: a SQLite-backed Durable Object addressed by `idFromName(vault_id)`.
 * The Worker only ever reaches it with the vault id from the signed-in session.
 */
export class VaultDO extends DurableObject<Env> {
  private readonly db: SqlDb;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = durableSqlDb(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.db, VAULT_MIGRATIONS, tableVersionStore(this.db));
    });
  }

  /** Binds this object to its vault id on first use and refuses any other id afterwards. */
  private store(vaultId: string): VaultStore {
    const bound = this.db.get<{ value: string }>("SELECT value FROM vault_meta WHERE key = 'vault_id'")?.value;
    if (!bound) {
      this.db.run("INSERT INTO vault_meta (key, value) VALUES ('vault_id', ?)", [vaultId]);
    } else if (bound !== vaultId) {
      throw new Error("vault id mismatch");
    }
    return new VaultStore(this.db, vaultId);
  }

  async head(vaultId: string): Promise<number> {
    return this.store(vaultId).head();
  }

  async manifest(vaultId: string): Promise<ManifestResponse> {
    return this.store(vaultId).manifest();
  }

  async changes(vaultId: string, since: number, limit: number): Promise<ChangesResponse> {
    return this.store(vaultId).changes(since, limit);
  }

  async summary(vaultId: string): Promise<{ quotas: VaultQuotas; usage: VaultUsage }> {
    const store = this.store(vaultId);
    return { quotas: store.quotas(), usage: store.usage() };
  }

  async setQuotas(vaultId: string, overrides: Partial<VaultQuotas>): Promise<VaultQuotas> {
    return this.store(vaultId).setQuotas(overrides);
  }

  async push(vaultId: string, input: { userId: string; deviceId: string; entries: PushEntry[] }): Promise<Omit<PushOutcome, "purge">> {
    const { purge, ...rest } = this.store(vaultId).push(input);
    await this.queuePurge(purge, LIMITS.replacedPackRetentionDays);
    return rest;
  }

  async reservePacks(vaultId: string, packs: ReservePack[]): Promise<ReserveResult[]> {
    const verified: ReservePack[] = [];
    const rejected: ReserveResult[] = [];
    for (const pack of packs) {
      if ((await packHashOf(pack.parts.map((p) => p.hash))) === pack.pack_hash) verified.push(pack);
      else
        rejected.push({
          disc_no: pack.disc_no,
          pack_hash: pack.pack_hash,
          status: "rejected",
          missingParts: [],
          error: "pack_hash does not match its parts",
        });
    }
    const { results, purge } = this.store(vaultId).reservePacks(verified);
    await this.queuePurge(purge, 0);
    return [...results, ...rejected];
  }

  /** Verifies and stores one pack part in KV under this vault's prefix. */
  async uploadPart(
    vaultId: string,
    discNo: number,
    packHash: string,
    part: number,
    data: ArrayBuffer,
  ): Promise<VaultResult<{ remainingParts: number }>> {
    return this.guard(async () => {
      const store = this.store(vaultId);
      const info = store.part(discNo, packHash, part);
      if (!info.uploaded) {
        store.assertUploadAllowed();
        if (data.byteLength !== info.bytes) throw new VaultError("bad_request", "part size does not match reservation");
        if ((await sha256Hex(data)) !== info.part_hash) throw new VaultError("bad_request", "part hash does not match");
        if (!(await reserveKvWrite(this.env, info.bytes))) {
          return { ok: false, code: "free_limit", message: "shared free storage limit reached", retryAfter: secondsUntilUtcMidnight() };
        }
        try {
          await this.env.PACKS.put(store.kvKey(discNo, packHash, part), data);
        } catch (error) {
          await releaseKvBytes(this.env, info.bytes);
          throw error;
        }
      }
      return { ok: true, value: { remainingParts: store.markUploaded(discNo, packHash, part) } };
    });
  }

  async exportPage(vaultId: string, cursor: string | null): Promise<{ head: number; sql: string; cursor: string | null }> {
    return this.store(vaultId).exportPage(cursor);
  }

  /** Deletes the whole vault database. Pack keys are queued for the purge cron first. */
  async wipe(vaultId: string): Promise<number> {
    const keys = this.store(vaultId).allPackKeys();
    await this.queuePurge(keys, 0);
    await this.ctx.storage.deleteAll();
    return keys.length;
  }

  private async queuePurge(keys: PurgeKey[], afterDays: number): Promise<void> {
    await enqueuePurge(this.env, keys, new Date(Date.now() + afterDays * 86_400_000));
  }

  private async guard<T>(fn: () => Promise<VaultResult<T>>): Promise<VaultResult<T>> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof VaultError) {
        return { ok: false, code: error.code, message: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) };
      }
      throw error;
    }
  }
}
