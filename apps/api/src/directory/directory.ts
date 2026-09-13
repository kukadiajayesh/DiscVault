import { GLOBAL_GUARDS, type OpsUsageResponse, SIGNUP_MODES, type SignupMode } from "@discvault/sync-protocol";
import type { Env } from "../env.js";
import { utcDay } from "../time.js";
import type { PurgeKey } from "../vault/vault-store.js";

/**
 * The directory (D1): accounts, vaults, sign-up settings and shared free-tier guards.
 * It never stores catalog data.
 */

// ── Sign-up ─────────────────────────────────────────────────────────────
export async function signupSettings(env: Env): Promise<{ mode: SignupMode; maxUsers: number }> {
  const rows = await env.DIRECTORY.prepare("SELECT key, value FROM app_config WHERE key IN ('signup_mode', 'max_users')").all<{
    key: string;
    value: string;
  }>();
  const config = new Map(rows.results.map((r) => [r.key, r.value]));
  const rawMode = config.get("signup_mode") ?? env.DEFAULT_SIGNUP_MODE;
  const mode = (SIGNUP_MODES as readonly string[]).includes(rawMode) ? (rawMode as SignupMode) : "invite";
  const maxUsers = Number(config.get("max_users") ?? GLOBAL_GUARDS.defaultMaxUsers);
  return { mode, maxUsers };
}

export type SignupDecision = { ok: true } | { ok: false; reason: "closed" | "invite_only" | "full" | "unverified" };

export async function decideSignup(env: Env, email: string, emailVerified: boolean): Promise<SignupDecision> {
  if (!emailVerified) return { ok: false, reason: "unverified" };
  const { mode, maxUsers } = await signupSettings(env);
  if (mode === "closed") return { ok: false, reason: "closed" };
  if (mode === "invite") {
    const invite = await env.DIRECTORY.prepare("SELECT email FROM invite WHERE email = ?").bind(email).first();
    if (!invite) return { ok: false, reason: "invite_only" };
  }
  const users = await env.DIRECTORY.prepare('SELECT count(*) AS n FROM "user"').first<{ n: number }>();
  if ((users?.n ?? 0) >= maxUsers) return { ok: false, reason: "full" };
  return { ok: true };
}

/** Creates the user's personal vault and owner membership. Safe to call again. */
export async function provisionVault(env: Env, userId: string, vaultId: string, email?: string): Promise<void> {
  const now = new Date().toISOString();
  const statements = [
    env.DIRECTORY.prepare("INSERT OR IGNORE INTO vault (id, owner_id, created_at) VALUES (?, ?, ?)").bind(vaultId, userId, now),
    env.DIRECTORY.prepare("INSERT OR IGNORE INTO vault_member (vault_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(
      vaultId,
      userId,
      now,
    ),
  ];
  if (email) {
    statements.push(env.DIRECTORY.prepare("UPDATE invite SET used_at = ? WHERE email = ? AND used_at IS NULL").bind(now, email));
  }
  await env.DIRECTORY.batch(statements);
}

export async function vaultOf(env: Env, userId: string): Promise<{ id: string; name: string } | null> {
  return env.DIRECTORY.prepare("SELECT id, name FROM vault WHERE owner_id = ? AND deleted_at IS NULL")
    .bind(userId)
    .first<{ id: string; name: string }>();
}

export async function vaultExists(env: Env, vaultId: string): Promise<boolean> {
  const row = await env.DIRECTORY.prepare("SELECT 1 AS ok FROM vault WHERE id = ? AND deleted_at IS NULL").bind(vaultId).first();
  return row !== null;
}

export async function isOperator(env: Env, userId: string): Promise<boolean> {
  const subs = env.OPERATOR_SUBS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (subs.length === 0) return false;
  const account = await env.DIRECTORY.prepare(`SELECT "accountId" AS sub FROM account WHERE "userId" = ? AND "providerId" = 'google'`)
    .bind(userId)
    .first<{ sub: string }>();
  return account !== null && subs.includes(account.sub);
}

// ── Shared free-tier guards ─────────────────────────────────────────────
/**
 * Reserves one KV write and `bytes` of KV storage against the account-wide guards.
 * Returns false (reserving nothing) when either guard is reached.
 */
export async function reserveKvWrite(env: Env, bytes: number): Promise<boolean> {
  const storage = await env.DIRECTORY.prepare(
    "UPDATE usage_total SET value = value + ?1 WHERE key = 'kv_bytes' AND value + ?1 <= ?2 RETURNING value",
  )
    .bind(bytes, GLOBAL_GUARDS.kvBytes)
    .first();
  if (!storage) return false;
  const writes = await env.DIRECTORY.prepare(
    `INSERT INTO usage_daily (day, kv_writes) VALUES (?1, 1)
     ON CONFLICT (day) DO UPDATE SET kv_writes = kv_writes + 1 WHERE kv_writes < ?2
     RETURNING kv_writes`,
  )
    .bind(utcDay(), GLOBAL_GUARDS.kvWritesPerDay)
    .first();
  if (!writes) {
    await releaseKvBytes(env, bytes);
    return false;
  }
  return true;
}

export async function releaseKvBytes(env: Env, bytes: number): Promise<void> {
  await env.DIRECTORY.prepare("UPDATE usage_total SET value = max(0, value - ?) WHERE key = 'kv_bytes'").bind(bytes).run();
}

/** Queues KV keys for the daily purge cron. */
export async function enqueuePurge(env: Env, keys: PurgeKey[], deleteAfter: Date): Promise<void> {
  if (keys.length === 0) return;
  const at = deleteAfter.toISOString();
  for (let i = 0; i < keys.length; i += 500) {
    await env.DIRECTORY.prepare(
      `INSERT OR IGNORE INTO purge_queue (kv_key, bytes, delete_after)
       SELECT value ->> 'kv_key', value ->> 'bytes', ? FROM json_each(?)`,
    )
      .bind(at, JSON.stringify(keys.slice(i, i + 500)))
      .run();
  }
}

/** Deletes due KV keys, staying under the daily KV delete guard. Runs from the cron trigger. */
export async function purgeDueKeys(env: Env, now = new Date()): Promise<number> {
  const day = utcDay(now);
  const used = await env.DIRECTORY.prepare("SELECT kv_deletes FROM usage_daily WHERE day = ?").bind(day).first<{ kv_deletes: number }>();
  const budget = Math.min(100, GLOBAL_GUARDS.kvDeletesPerDay - (used?.kv_deletes ?? 0));
  if (budget <= 0) return 0;
  const due = await env.DIRECTORY.prepare("SELECT kv_key, bytes FROM purge_queue WHERE delete_after <= ? ORDER BY delete_after LIMIT ?")
    .bind(now.toISOString(), budget)
    .all<PurgeKey>();
  if (due.results.length === 0) return 0;
  await Promise.all(due.results.map((k) => env.PACKS.delete(k.kv_key)));
  const bytes = due.results.reduce((sum, k) => sum + Number(k.bytes), 0);
  await env.DIRECTORY.batch([
    env.DIRECTORY.prepare("DELETE FROM purge_queue WHERE kv_key IN (SELECT value FROM json_each(?))").bind(
      JSON.stringify(due.results.map((k) => k.kv_key)),
    ),
    env.DIRECTORY.prepare(
      `INSERT INTO usage_daily (day, kv_deletes) VALUES (?1, ?2)
       ON CONFLICT (day) DO UPDATE SET kv_deletes = kv_deletes + ?2`,
    ).bind(day, due.results.length),
    env.DIRECTORY.prepare("UPDATE usage_total SET value = max(0, value - ?) WHERE key = 'kv_bytes'").bind(bytes),
  ]);
  return due.results.length;
}

// ── Devices ─────────────────────────────────────────────────────────────
export async function registerDevice(
  env: Env,
  input: { id: string; name: string; userId: string; vaultId: string; sessionId: string | null },
): Promise<boolean> {
  const existing = await env.DIRECTORY.prepare("SELECT user_id FROM device WHERE id = ?").bind(input.id).first<{ user_id: string }>();
  if (existing && existing.user_id !== input.userId) return false;
  await env.DIRECTORY.prepare(
    `INSERT INTO device (id, user_id, vault_id, session_id, name, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (id) DO UPDATE SET session_id = ?4, name = ?5, last_seen_at = ?6, revoked_at = NULL`,
  )
    .bind(input.id, input.userId, input.vaultId, input.sessionId, input.name, new Date().toISOString())
    .run();
  return true;
}

export async function listDevices(env: Env, userId: string) {
  const rows = await env.DIRECTORY.prepare(
    "SELECT id, name, session_id, last_seen_at, revoked_at FROM device WHERE user_id = ? ORDER BY last_seen_at DESC",
  )
    .bind(userId)
    .all<{ id: string; name: string | null; session_id: string | null; last_seen_at: string | null; revoked_at: string | null }>();
  return rows.results;
}

/** Revokes one of the user's own devices and signs out its session. */
export async function revokeDevice(env: Env, userId: string, deviceId: string): Promise<boolean> {
  const device = await env.DIRECTORY.prepare("SELECT session_id FROM device WHERE id = ? AND user_id = ?")
    .bind(deviceId, userId)
    .first<{ session_id: string | null }>();
  if (!device) return false;
  await env.DIRECTORY.batch([
    env.DIRECTORY.prepare("UPDATE device SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), deviceId),
    env.DIRECTORY.prepare('DELETE FROM session WHERE id = ? AND "userId" = ?').bind(device.session_id, userId),
  ]);
  return true;
}

// ── Account deletion ────────────────────────────────────────────────────
export async function deleteAccountRows(env: Env, userId: string, vaultId: string): Promise<void> {
  await env.DIRECTORY.batch([
    env.DIRECTORY.prepare("DELETE FROM device WHERE user_id = ?").bind(userId),
    env.DIRECTORY.prepare("DELETE FROM vault_member WHERE vault_id = ?").bind(vaultId),
    env.DIRECTORY.prepare("DELETE FROM vault WHERE id = ?").bind(vaultId),
    env.DIRECTORY.prepare('DELETE FROM session WHERE "userId" = ?').bind(userId),
    env.DIRECTORY.prepare('DELETE FROM account WHERE "userId" = ?').bind(userId),
    env.DIRECTORY.prepare('DELETE FROM "user" WHERE id = ?').bind(userId),
  ]);
}

// ── Operator ────────────────────────────────────────────────────────────
export async function opsUsage(env: Env): Promise<OpsUsageResponse> {
  const day = utcDay();
  const [users, vaults, today, kvBytes, purge, settings] = await Promise.all([
    env.DIRECTORY.prepare('SELECT count(*) AS n FROM "user"').first<{ n: number }>(),
    env.DIRECTORY.prepare("SELECT count(*) AS n FROM vault WHERE deleted_at IS NULL").first<{ n: number }>(),
    env.DIRECTORY.prepare("SELECT kv_writes, kv_deletes FROM usage_daily WHERE day = ?")
      .bind(day)
      .first<{ kv_writes: number; kv_deletes: number }>(),
    env.DIRECTORY.prepare("SELECT value FROM usage_total WHERE key = 'kv_bytes'").first<{ value: number }>(),
    env.DIRECTORY.prepare("SELECT count(*) AS n FROM purge_queue").first<{ n: number }>(),
    signupSettings(env),
  ]);
  return {
    users: users?.n ?? 0,
    vaults: vaults?.n ?? 0,
    signupMode: settings.mode,
    maxUsers: settings.maxUsers,
    today: { day, kvWrites: today?.kv_writes ?? 0, kvDeletes: today?.kv_deletes ?? 0 },
    kvBytes: kvBytes?.value ?? 0,
    purgeQueue: purge?.n ?? 0,
  };
}

export async function setConfig(env: Env, key: "signup_mode" | "max_users", value: string): Promise<void> {
  await env.DIRECTORY.prepare("INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function listVaultIds(env: Env): Promise<string[]> {
  const rows = await env.DIRECTORY.prepare("SELECT id FROM vault WHERE deleted_at IS NULL ORDER BY id").all<{ id: string }>();
  return rows.results.map((r) => r.id);
}
