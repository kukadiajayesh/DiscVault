import type { ErrorCode } from "@discvault/sync-protocol";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv, Scope } from "./env.js";
import type { VaultResult } from "./vault/vault-do.js";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  not_found: 404,
  bad_request: 400,
  protocol_unsupported: 426,
  quota_exceeded: 429,
  free_limit: 429,
  signup_closed: 403,
  conflict: 409,
  internal: 500,
};

export function apiError(c: Context<AppEnv>, code: ErrorCode, message: string, retryAfter?: number) {
  if (retryAfter !== undefined) c.header("Retry-After", String(retryAfter));
  return c.json({ error: { code, message, ...(retryAfter !== undefined ? { retryAfter } : {}) } }, STATUS[code]);
}

export function vaultResponse<T>(c: Context<AppEnv>, result: VaultResult<T>) {
  return result.ok ? c.json(result.value as object) : apiError(c, result.code, result.message, result.retryAfter);
}

/** The only way routes reach a vault: by the id in the signed-in session. */
export function vaultStub(c: Context<AppEnv>) {
  const scope: Scope = c.get("scope");
  const ns = c.env.VAULT;
  return { vaultId: scope.vaultId, stub: ns.get(ns.idFromName(scope.vaultId)) };
}

export async function readJson<T>(
  c: Context<AppEnv>,
  schema: { safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } } },
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, response: apiError(c, "bad_request", "invalid JSON body") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: apiError(c, "bad_request", parsed.error.message) };
  return { ok: true, data: parsed.data };
}
