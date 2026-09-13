import { env } from "cloudflare:workers";
import { PROTOCOL_HEADER, PROTOCOL_VERSION, uuidv7 } from "@discvault/sync-protocol";
import { createApp } from "../../src/app.js";
import { provisionVault } from "../../src/directory/directory.js";
import type { Env, Scope } from "../../src/env.js";

export interface TestUser extends Scope {
  googleSub: string;
}

/** App wired with a header-based session stub; production uses Better Auth (src/index.ts). */
export const app = createApp({
  authHandler: async () => new Response("auth disabled in tests", { status: 404 }),
  async resolveScope(c) {
    const userId = c.req.header("x-test-user");
    if (!userId) return null;
    const row = await c.env.DIRECTORY.prepare('SELECT u.id, u.email, u.name, u."vaultId" AS vault_id FROM "user" u WHERE u.id = ?')
      .bind(userId)
      .first<{ id: string; email: string; name: string; vault_id: string }>();
    return row ? { userId: row.id, vaultId: row.vault_id, email: row.email, name: row.name, image: null, sessionId: null } : null;
  },
});

export async function createUser(name: string, googleSub = `google-${name}`): Promise<TestUser> {
  const id = uuidv7();
  const vaultId = uuidv7();
  const email = `${name.toLowerCase()}@example.com`;
  const now = new Date().toISOString();
  await env.DIRECTORY.batch([
    env.DIRECTORY.prepare(
      `INSERT INTO "user" (id, name, email, "emailVerified", "vaultId", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?, ?)`,
    ).bind(id, name, email, vaultId, now, now),
    env.DIRECTORY.prepare(
      `INSERT INTO account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") VALUES (?, ?, 'google', ?, ?, ?)`,
    ).bind(uuidv7(), googleSub, id, now, now),
  ]);
  await provisionVault(env as unknown as Env, id, vaultId);
  return { userId: id, vaultId, email, name, image: null, sessionId: null, googleSub };
}

export async function call(
  user: TestUser | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: {
      [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
      ...(user ? { "x-test-user": user.userId } : {}),
      ...(body !== undefined && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
  };
  if (body instanceof Uint8Array) init.body = body;
  else if (body !== undefined) init.body = JSON.stringify(body);
  return app.fetch(new Request(`http://localhost/api${path}`, init), env);
}

export function entry(table: string, rowId: string, op: string, fields: Record<string, unknown> = {}, baseVersion = 0) {
  return { id: uuidv7(), table, rowId, op, fields, baseVersion, createdAt: new Date().toISOString() };
}
