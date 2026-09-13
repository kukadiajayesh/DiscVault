import type { SqlDb, SqlValue } from "@discvault/schema";
import {
  type Change,
  type ChangesResponse,
  DEFAULT_VAULT_QUOTAS,
  LIMITS,
  type ManifestResponse,
  PackCommitFields,
  type PushEntry,
  type PushResult,
  type ReservePack,
  type ReserveResult,
  SYNCED_TABLE_NAMES,
  SYNCED_TABLES,
  type SyncedTableDef,
  type SyncedTableName,
  type VaultQuotas,
  type VaultUsage,
  validateFields,
  validateRowId,
} from "@discvault/sync-protocol";
import { secondsUntilUtcMidnight, utcDay } from "../time.js";

type Row = Record<string, SqlValue>;

/** A KV key the directory should delete later (replaced or abandoned pack parts). */
export interface PurgeKey {
  kv_key: string;
  bytes: number;
}

/** Who made a change, recorded in the audit log. Cascaded changes have no outbox id. */
interface ChangeContext {
  outboxId: string | null;
  userId: string;
  deviceId: string;
}

export interface PushOutcome {
  results: PushResult[];
  head: number;
  purge: PurgeKey[];
}

export interface ReserveOutcome {
  results: ReserveResult[];
  purge: PurgeKey[];
}

export interface PartInfo {
  part_hash: string;
  bytes: number;
  uploaded: boolean;
}

/** Thrown for problems the caller should report as a 4xx/429 rather than a crash. */
export class VaultError extends Error {
  constructor(
    readonly code: "not_found" | "bad_request" | "quota_exceeded",
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Children that disappear (required reference) or are detached (optional reference) on delete. */
const DEPENDENTS: { table: SyncedTableName; column: string; parent: SyncedTableName; required: boolean }[] = SYNCED_TABLE_NAMES.flatMap(
  (table) =>
    Object.entries(SYNCED_TABLES[table].columns)
      .filter(([, col]) => col.references)
      .map(([column, col]) => ({
        table,
        column,
        parent: col.references as SyncedTableName,
        required: Boolean(col.required),
      })),
);

const STALE_RESERVATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Everything one vault's database does, independent of the Durable Object runtime so it can be
 * tested against any SQLite. The database belongs to exactly one vault; nothing here can reach
 * another user's data.
 */
export class VaultStore {
  constructor(
    private readonly db: SqlDb,
    private readonly vaultId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Settings ───────────────────────────────────────────────────────────
  quotas(): VaultQuotas {
    const raw = this.meta("quotas");
    return raw ? { ...DEFAULT_VAULT_QUOTAS, ...(JSON.parse(raw) as Partial<VaultQuotas>) } : DEFAULT_VAULT_QUOTAS;
  }

  setQuotas(overrides: Partial<VaultQuotas>): VaultQuotas {
    this.setMeta("quotas", JSON.stringify(overrides));
    return this.quotas();
  }

  // ── Reads ──────────────────────────────────────────────────────────────
  head(): number {
    return Number(this.db.get<{ seq: number }>("SELECT seq FROM sqlite_sequence WHERE name = 'change_log'")?.seq ?? 0);
  }

  manifest(): ManifestResponse {
    const discs = this.db.all<{
      disc_no: number;
      pack_hash: string | null;
      pack_parts: number;
      pack_bytes: number;
      version: number;
      deleted_at: string | null;
    }>("SELECT disc_no, pack_hash, pack_parts, pack_bytes, version, deleted_at FROM disc ORDER BY disc_no");
    return {
      seq: this.head(),
      discs: discs.map((d) => ({
        disc_no: d.disc_no,
        pack_hash: d.pack_hash,
        parts: d.pack_parts,
        bytes: d.pack_bytes,
        version: d.version,
        deleted: d.deleted_at !== null,
      })),
    };
  }

  /** Latest state of every row changed after `since`, oldest first. */
  changes(since: number, limit: number = LIMITS.changesPageSize): ChangesResponse {
    const pageSize = Math.max(1, Math.min(limit, LIMITS.changesPageSize));
    const candidates: Change[] = [];
    for (const table of SYNCED_TABLE_NAMES) {
      const def = SYNCED_TABLES[table];
      const rows = this.db.all<Row>(`SELECT * FROM ${table} WHERE version > ? ORDER BY version LIMIT ?`, [since, pageSize + 1]);
      for (const row of rows) {
        candidates.push({
          seq: Number(row.version),
          table,
          rowId: String(row[def.primaryKey]),
          op: row.deleted_at ? "delete" : "upsert",
          row,
          at: String(row.updated_at),
        });
      }
    }
    candidates.sort((a, b) => a.seq - b.seq);
    const changes = candidates.slice(0, pageSize);
    const hasMore = candidates.length > pageSize;
    const head = this.head();
    const last = changes[changes.length - 1];
    return { changes, hasMore, head, next: hasMore && last ? last.seq : Math.max(head, since) };
  }

  usage(): VaultUsage {
    const day = utcDay(this.now());
    const q = this.db.get<{ meta_writes: number; pack_uploads: number }>(
      "SELECT meta_writes, pack_uploads FROM quota_usage WHERE day = ?",
      [day],
    );
    return {
      day,
      metaWrites: Number(q?.meta_writes ?? 0),
      packUploads: Number(q?.pack_uploads ?? 0),
      packBytes: this.packBytes(),
      discs: Number(this.db.get<{ n: number }>("SELECT count(*) AS n FROM disc WHERE deleted_at IS NULL")?.n ?? 0),
    };
  }

  // ── Push (row sync) ────────────────────────────────────────────────────
  push(input: { userId: string; deviceId: string; entries: PushEntry[] }): PushOutcome {
    const results: PushResult[] = [];
    const purge: PurgeKey[] = [];
    for (const entry of input.entries) {
      const duplicate = this.db.get<{ seq: number }>("SELECT seq FROM change_log WHERE outbox_id = ?", [entry.id]);
      if (duplicate) {
        results.push({ id: entry.id, status: "duplicate", seq: duplicate.seq });
        continue;
      }
      const quotas = this.quotas();
      if (this.metaWritesToday() >= quotas.maxMetaWritesPerDay) {
        results.push({
          id: entry.id,
          status: "deferred",
          error: "daily metadata write quota reached",
          retryAfter: secondsUntilUtcMidnight(this.now()),
        });
        continue;
      }
      try {
        const result = this.db.transaction(() => this.applyEntry(entry, input, quotas, purge));
        results.push(result);
      } catch (error) {
        if (error instanceof VaultError) {
          results.push({ id: entry.id, status: "rejected", error: error.message });
        } else {
          throw error;
        }
      }
    }
    this.pruneChangeLog();
    return { results, head: this.head(), purge };
  }

  private applyEntry(entry: PushEntry, ctx: { userId: string; deviceId: string }, quotas: VaultQuotas, purge: PurgeKey[]): PushResult {
    const def = SYNCED_TABLES[entry.table];
    const rowId = validateRowId(entry.table, entry.rowId);
    if (!rowId.ok) throw new VaultError("bad_request", rowId.error);
    const existing = this.db.get<Row>(`SELECT * FROM ${def.name} WHERE ${def.primaryKey} = ?`, [rowId.value]);
    const log: ChangeContext = { outboxId: entry.id, userId: ctx.userId, deviceId: ctx.deviceId };

    if (entry.op === "delete") {
      if (!existing) throw new VaultError("not_found", `${entry.table} ${entry.rowId} does not exist`);
      if (existing.deleted_at) return { id: entry.id, status: "applied", version: Number(existing.version) };
      const seq = this.tombstone(def, rowId.value, log);
      return { id: entry.id, status: "applied", seq, version: seq };
    }

    if (entry.op === "pack_commit") {
      if (entry.table !== "disc") throw new VaultError("bad_request", "pack_commit only applies to disc");
      return this.commitPack(entry, rowId.value as number, existing, log, purge);
    }

    const validated = validateFields(entry.table, entry.fields);
    if (!validated.ok) throw new VaultError("bad_request", validated.error);
    const values = validated.value.values;
    this.checkReferences(def, values);

    if (!existing) {
      if (def.name === "disc" && this.usage().discs >= quotas.maxDiscs) {
        throw new VaultError("quota_exceeded", "disc limit reached for this vault");
      }
      this.insertRow(def, rowId.value, values, entry.createdAt);
      const seq = this.recordChange(def, rowId.value, "upsert", null, log);
      return { id: entry.id, status: "applied", seq, version: seq };
    }

    if (existing.deleted_at && entry.baseVersion < Number(existing.version)) {
      throw new VaultError("not_found", `${entry.table} ${entry.rowId} was deleted`);
    }
    if (!existing.deleted_at && def.name === "disc" && entry.baseVersion === 0) {
      return { id: entry.id, status: "conflict", error: "disc_exists", theirs: existing };
    }

    // Last write wins per field; values this write overwrites without having seen them are kept.
    const overwritten: Row = {};
    if (Number(existing.version) > entry.baseVersion) {
      for (const [column, value] of Object.entries(values)) {
        if (existing[column] !== value) overwritten[column] = existing[column] ?? null;
      }
    }
    const sets = Object.keys(values).map((c) => `${c} = ?`);
    this.db.run(`UPDATE ${def.name} SET ${[...sets, "deleted_at = NULL"].join(", ")} WHERE ${def.primaryKey} = ?`, [
      ...Object.values(values),
      rowId.value,
    ]);
    const seq = this.recordChange(def, rowId.value, "upsert", Object.keys(overwritten).length > 0 ? overwritten : null, log);
    return { id: entry.id, status: "applied", seq, version: seq };
  }

  private commitPack(entry: PushEntry, discNo: number, existing: Row | undefined, log: ChangeContext, purge: PurgeKey[]): PushResult {
    const parsed = PackCommitFields.safeParse(entry.fields);
    if (!parsed.success) throw new VaultError("bad_request", "invalid pack_commit fields");
    const fields = parsed.data;
    if (!existing || existing.deleted_at) throw new VaultError("not_found", `disc ${discNo} does not exist`);
    if (existing.pack_hash === fields.pack_hash) {
      return { id: entry.id, status: "applied", version: Number(existing.version) };
    }

    const parts = this.db.all<{ part: number; bytes: number; uploaded_at: string | null }>(
      "SELECT part, bytes, uploaded_at FROM pack_part WHERE disc_no = ? AND pack_hash = ? ORDER BY part",
      [discNo, fields.pack_hash],
    );
    const complete =
      parts.length === fields.pack_parts &&
      parts.every((p, i) => p.part === i + 1 && p.uploaded_at !== null) &&
      parts.reduce((sum, p) => sum + p.bytes, 0) === fields.pack_bytes;
    if (!complete) throw new VaultError("bad_request", `pack for disc ${discNo} is not fully uploaded`);

    const now = this.now().toISOString();
    const oldHash = existing.pack_hash as string | null;
    if (oldHash) {
      for (const old of this.db.all<{ part: number; bytes: number }>(
        "SELECT part, bytes FROM pack_part WHERE disc_no = ? AND pack_hash = ? AND uploaded_at IS NOT NULL",
        [discNo, oldHash],
      )) {
        purge.push({ kv_key: this.kvKey(discNo, oldHash, old.part), bytes: old.bytes });
      }
      this.db.run("DELETE FROM pack_part WHERE disc_no = ? AND pack_hash = ?", [discNo, oldHash]);
    }
    this.db.run("UPDATE pack_part SET committed_at = ? WHERE disc_no = ? AND pack_hash = ?", [now, discNo, fields.pack_hash]);
    this.db.run(
      `UPDATE disc SET pack_hash = ?, pack_parts = ?, pack_bytes = ?, pack_version = ?, folder_count = ?,
         file_count = ?, total_kb = ?, scanned_at = ?, prev_pack_hash = ? WHERE disc_no = ?`,
      [
        fields.pack_hash,
        fields.pack_parts,
        fields.pack_bytes,
        fields.pack_version,
        fields.folder_count,
        fields.file_count,
        fields.total_kb,
        fields.scanned_at,
        oldHash,
        discNo,
      ],
    );
    this.db.run("INSERT INTO scan_job (id, disc_no, source, pack_hash, device_id, at) VALUES (?, ?, 'upload', ?, ?, ?)", [
      entry.id,
      discNo,
      fields.pack_hash,
      log.deviceId,
      now,
    ]);
    const seq = this.recordChange(SYNCED_TABLES.disc, discNo, "pack_commit", null, log);
    return { id: entry.id, status: "applied", seq, version: seq };
  }

  private checkReferences(def: SyncedTableDef, values: Record<string, SqlValue>): void {
    for (const [column, value] of Object.entries(values)) {
      const target = def.columns[column]?.references;
      if (!target || value === null) continue;
      const targetDef = SYNCED_TABLES[target];
      const row = this.db.get<{ deleted_at: string | null }>(`SELECT deleted_at FROM ${target} WHERE ${targetDef.primaryKey} = ?`, [value]);
      if (!row || row.deleted_at) throw new VaultError("not_found", `${def.name}.${column} points at a missing ${target}`);
    }
  }

  private insertRow(def: SyncedTableDef, rowId: SqlValue, values: Record<string, SqlValue>, createdAt: string): void {
    const row: Row = { [def.primaryKey]: rowId };
    for (const [column, col] of Object.entries(def.columns)) {
      if (column in values) row[column] = values[column] ?? null;
      else if (col.default !== undefined) row[column] = col.default;
      else if (col.required) throw new VaultError("bad_request", `${def.name}.${column} is required`);
    }
    const now = this.now().toISOString();
    row.created_at = createdAt;
    row.updated_at = now;
    const columns = Object.keys(row);
    this.db.run(
      `INSERT INTO ${def.name} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      columns.map((c) => row[c] ?? null),
    );
  }

  /** Soft-deletes a row, then cascades to rows that point at it. */
  private tombstone(def: SyncedTableDef, rowId: SqlValue, log: ChangeContext): number {
    const now = this.now().toISOString();
    this.db.run(`UPDATE ${def.name} SET deleted_at = ? WHERE ${def.primaryKey} = ?`, [now, rowId]);
    const seq = this.recordChange(def, rowId, "delete", null, log);
    const cascade: ChangeContext = { ...log, outboxId: null };
    for (const dep of DEPENDENTS.filter((d) => d.parent === def.name)) {
      const childDef = SYNCED_TABLES[dep.table];
      const children = this.db.all<Row>(
        `SELECT ${childDef.primaryKey} AS id FROM ${dep.table} WHERE ${dep.column} = ? AND deleted_at IS NULL`,
        [rowId],
      );
      for (const child of children) {
        if (dep.required) {
          this.tombstone(childDef, child.id ?? null, cascade);
        } else {
          this.db.run(`UPDATE ${dep.table} SET ${dep.column} = NULL WHERE ${childDef.primaryKey} = ?`, [child.id ?? null]);
          this.recordChange(childDef, child.id ?? null, "upsert", { [dep.column]: rowId }, cascade);
        }
      }
    }
    return seq;
  }

  /** Appends to the audit log and stamps the row with the new sequence number as its version. */
  private recordChange(
    def: SyncedTableDef,
    rowId: SqlValue,
    op: "upsert" | "delete" | "pack_commit",
    overwritten: Row | null,
    log: ChangeContext,
  ): number {
    const now = this.now().toISOString();
    const inserted = this.db.get<{ seq: number }>(
      `INSERT INTO change_log (table_name, row_id, op, overwritten_json, user_id, device_id, outbox_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
      [def.name, String(rowId), op, overwritten ? JSON.stringify(overwritten) : null, log.userId, log.deviceId, log.outboxId, now],
    );
    const seq = Number(inserted?.seq);
    this.db.run(`UPDATE ${def.name} SET version = ?, updated_at = ? WHERE ${def.primaryKey} = ?`, [seq, now, rowId]);
    const row = this.db.get<Row>(`SELECT * FROM ${def.name} WHERE ${def.primaryKey} = ?`, [rowId]);
    this.db.run("UPDATE change_log SET row_json = ? WHERE seq = ?", [JSON.stringify(row), seq]);
    this.db.run(
      `INSERT INTO quota_usage (day, meta_writes) VALUES (?, 1)
       ON CONFLICT (day) DO UPDATE SET meta_writes = meta_writes + 1`,
      [utcDay(this.now())],
    );
    return seq;
  }

  private metaWritesToday(): number {
    return Number(this.db.get<{ n: number }>("SELECT meta_writes AS n FROM quota_usage WHERE day = ?", [utcDay(this.now())])?.n ?? 0);
  }

  private pruneChangeLog(): void {
    const cutoff = new Date(this.now().getTime() - LIMITS.changeLogRetentionDays * 86_400_000).toISOString();
    this.db.run("DELETE FROM change_log WHERE seq IN (SELECT seq FROM change_log WHERE at < ? ORDER BY seq LIMIT 500)", [cutoff]);
  }

  // ── Packs ──────────────────────────────────────────────────────────────
  /** Reserves uploads. `pack_hash` must already be verified against the part hashes by the caller. */
  reservePacks(packs: ReservePack[]): ReserveOutcome {
    const purge = this.dropStaleReservations();
    const results: ReserveResult[] = [];
    const quotas = this.quotas();
    const now = this.now().toISOString();
    for (const pack of packs) {
      const base = { disc_no: pack.disc_no, pack_hash: pack.pack_hash };
      const committed = this.db.get<{ pack_hash: string | null }>("SELECT pack_hash FROM disc WHERE disc_no = ?", [pack.disc_no]);
      if (committed?.pack_hash === pack.pack_hash) {
        results.push({ ...base, status: "reserved", missingParts: [] });
        continue;
      }
      const existing = this.db.all<{ part: number; part_hash: string; uploaded_at: string | null }>(
        "SELECT part, part_hash, uploaded_at FROM pack_part WHERE disc_no = ? AND pack_hash = ? ORDER BY part",
        [pack.disc_no, pack.pack_hash],
      );
      if (existing.length > 0) {
        const same = existing.length === pack.parts.length && existing.every((p, i) => p.part_hash === pack.parts[i]?.hash);
        results.push(
          same
            ? { ...base, status: "reserved", missingParts: existing.filter((p) => !p.uploaded_at).map((p) => p.part) }
            : { ...base, status: "rejected", missingParts: [], error: "pack already reserved with different parts" },
        );
        continue;
      }
      const bytes = pack.parts.reduce((sum, p) => sum + p.bytes, 0);
      if (pack.parts.some((p) => p.bytes > LIMITS.packPartMaxBytes)) {
        results.push({ ...base, status: "rejected", missingParts: [], error: "pack part too large" });
        continue;
      }
      if (this.packBytes() + bytes > quotas.maxPackBytes) {
        results.push({ ...base, status: "rejected", missingParts: [], error: "quota_exceeded: pack storage" });
        continue;
      }
      this.db.transaction(() => {
        for (const [i, part] of pack.parts.entries()) {
          this.db.run("INSERT INTO pack_part (disc_no, pack_hash, part, part_hash, bytes, reserved_at) VALUES (?, ?, ?, ?, ?, ?)", [
            pack.disc_no,
            pack.pack_hash,
            i + 1,
            part.hash,
            part.bytes,
            now,
          ]);
        }
      });
      results.push({ ...base, status: "reserved", missingParts: pack.parts.map((_, i) => i + 1) });
    }
    return { results, purge };
  }

  part(discNo: number, packHash: string, part: number): PartInfo {
    const row = this.db.get<{ part_hash: string; bytes: number; uploaded_at: string | null }>(
      "SELECT part_hash, bytes, uploaded_at FROM pack_part WHERE disc_no = ? AND pack_hash = ? AND part = ?",
      [discNo, packHash, part],
    );
    if (!row) throw new VaultError("not_found", "pack part not reserved");
    return { part_hash: row.part_hash, bytes: row.bytes, uploaded: row.uploaded_at !== null };
  }

  /** Throws `quota_exceeded` when today's upload quota is used up. */
  assertUploadAllowed(): void {
    if (this.usage().packUploads >= this.quotas().maxPackUploadsPerDay) {
      throw new VaultError("quota_exceeded", "daily pack upload quota reached", secondsUntilUtcMidnight(this.now()));
    }
  }

  markUploaded(discNo: number, packHash: string, part: number): number {
    this.db.transaction(() => {
      this.db.run("UPDATE pack_part SET uploaded_at = ? WHERE disc_no = ? AND pack_hash = ? AND part = ? AND uploaded_at IS NULL", [
        this.now().toISOString(),
        discNo,
        packHash,
        part,
      ]);
      this.db.run(
        `INSERT INTO quota_usage (day, pack_uploads) VALUES (?, 1)
         ON CONFLICT (day) DO UPDATE SET pack_uploads = pack_uploads + 1`,
        [utcDay(this.now())],
      );
    });
    return Number(
      this.db.get<{ n: number }>("SELECT count(*) AS n FROM pack_part WHERE disc_no = ? AND pack_hash = ? AND uploaded_at IS NULL", [
        discNo,
        packHash,
      ])?.n ?? 0,
    );
  }

  /** Every uploaded pack key of this vault (for account deletion). */
  allPackKeys(): PurgeKey[] {
    return this.db
      .all<{ disc_no: number; pack_hash: string; part: number; bytes: number }>(
        "SELECT disc_no, pack_hash, part, bytes FROM pack_part WHERE uploaded_at IS NOT NULL",
      )
      .map((p) => ({ kv_key: this.kvKey(p.disc_no, p.pack_hash, p.part), bytes: p.bytes }));
  }

  kvKey(discNo: number, packHash: string, part: number): string {
    return `v:${this.vaultId}:pack:${discNo}:${packHash}:${part}`;
  }

  private packBytes(): number {
    return Number(this.db.get<{ n: number }>("SELECT coalesce(sum(bytes), 0) AS n FROM pack_part")?.n ?? 0);
  }

  private dropStaleReservations(): PurgeKey[] {
    const cutoff = new Date(this.now().getTime() - STALE_RESERVATION_MS).toISOString();
    const stale = this.db.all<{ disc_no: number; pack_hash: string; part: number; bytes: number; uploaded_at: string | null }>(
      "SELECT disc_no, pack_hash, part, bytes, uploaded_at FROM pack_part WHERE committed_at IS NULL AND reserved_at < ?",
      [cutoff],
    );
    if (stale.length === 0) return [];
    this.db.run("DELETE FROM pack_part WHERE committed_at IS NULL AND reserved_at < ?", [cutoff]);
    return stale.filter((p) => p.uploaded_at).map((p) => ({ kv_key: this.kvKey(p.disc_no, p.pack_hash, p.part), bytes: p.bytes }));
  }

  // ── Backup export ──────────────────────────────────────────────────────
  /** One page of `INSERT` statements. Cursor is `table:rowid`; returns `cursor: null` when done. */
  exportPage(cursor: string | null, pageSize = 2000): { head: number; sql: string; cursor: string | null } {
    const tables = [...SYNCED_TABLE_NAMES, "change_log", "scan_job", "quota_usage", "pack_part", "vault_meta"];
    let [table, after] = cursor ? [cursor.split(":")[0] ?? "", Number(cursor.split(":")[1] ?? 0)] : [tables[0] ?? "", 0];
    let index = tables.indexOf(table);
    if (index < 0) throw new VaultError("bad_request", "invalid export cursor");
    const lines: string[] = cursor ? [] : [`-- DiscVault vault ${this.vaultId} export, head ${this.head()}`];
    let remaining = pageSize;
    while (index < tables.length && remaining > 0) {
      table = tables[index] ?? "";
      const rows = this.db.all<Row>(`SELECT rowid AS _rowid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`, [after, remaining]);
      for (const row of rows) {
        const { _rowid, ...data } = row;
        after = Number(_rowid);
        const cols = Object.keys(data);
        lines.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => sqlValue(data[c] ?? null)).join(", ")});`);
      }
      remaining -= rows.length;
      if (remaining > 0) {
        index += 1;
        after = 0;
      }
    }
    const done = index >= tables.length;
    return { head: this.head(), sql: lines.join("\n"), cursor: done ? null : `${tables[index]}:${after}` };
  }

  // ── Internals ──────────────────────────────────────────────────────────
  private meta(key: string): string | undefined {
    return this.db.get<{ value: string }>("SELECT value FROM vault_meta WHERE key = ?", [key])?.value;
  }

  private setMeta(key: string, value: string): void {
    this.db.run("INSERT INTO vault_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, value]);
  }
}

function sqlValue(value: SqlValue): string {
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array) return `X'${Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("")}'`;
  return `'${value.replace(/'/g, "''")}'`;
}
