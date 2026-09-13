import {
  API_PREFIX,
  DeleteAccountRequest,
  isSha256Hex,
  LIMITS,
  MIN_PROTOCOL_VERSION,
  OpsConfigRequest,
  OpsInviteRequest,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  PushRequest,
  Quotas,
  RegisterDeviceRequest,
  ReserveRequest,
  sha256Hex,
} from "@discvault/sync-protocol";
import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  deleteAccountRows,
  isOperator,
  listDevices,
  listVaultIds,
  opsUsage,
  provisionVault,
  registerDevice,
  revokeDevice,
  setConfig,
  vaultExists,
  vaultOf,
} from "./directory/directory.js";
import type { AppEnv, Env, Scope } from "./env.js";
import { apiError, readJson, vaultResponse, vaultStub } from "./http.js";

export interface AppDeps {
  /** Resolves the signed-in user and their vault from the request, or null when signed out. */
  resolveScope(c: Context<AppEnv>): Promise<Scope | null>;
  /** Handles `/api/auth/*` (Better Auth in production). */
  authHandler(request: Request, env: Env): Promise<Response>;
}

const DISC_RE = /^\d{1,9}$/;
const PART_RE = /^\d{1,4}$/;

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath(API_PREFIX);

  // ── Protocol version + CSRF: every non-auth write must send DV-Protocol ─
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith(`${API_PREFIX}/auth/`)) return next();
    const header = c.req.header(PROTOCOL_HEADER);
    const isRead = c.req.method === "GET" || c.req.method === "HEAD";
    if (header === undefined) {
      if (!isRead) return apiError(c, "bad_request", `missing ${PROTOCOL_HEADER} header`);
    } else {
      const version = Number(header);
      if (!Number.isInteger(version) || version < MIN_PROTOCOL_VERSION || version > PROTOCOL_VERSION) {
        return apiError(c, "protocol_unsupported", "please update DiscVault");
      }
    }
    c.header("Cache-Control", "no-store");
    return next();
  });

  app.on(["GET", "POST"], "/auth/*", (c) => deps.authHandler(c.req.raw, c.env));

  // ── Backup workflow (secret token). The only routes that take a vault id. ─
  const requireOpsToken = createMiddleware<AppEnv>(async (c, next) => {
    const token = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
    if (!c.env.OPS_TOKEN || !(await safeEqual(token, c.env.OPS_TOKEN))) return apiError(c, "not_found", "not found");
    return next();
  });

  app.get("/ops/vaults", requireOpsToken, async (c) => c.json({ vaults: await listVaultIds(c.env) }));

  app.get("/ops/vaults/:id/export", requireOpsToken, async (c) => {
    if (!(await vaultExists(c.env, c.req.param("id")))) return apiError(c, "not_found", "not found");
    const ns = c.env.VAULT;
    const stub = ns.get(ns.idFromName(c.req.param("id")));
    const cursor = c.req.query("cursor") ?? null;
    const ifHead = c.req.query("ifHead");
    if (!cursor && ifHead !== undefined && Number(ifHead) === (await stub.head(c.req.param("id")))) {
      return c.body(null, 304);
    }
    return c.json(await stub.exportPage(c.req.param("id"), cursor));
  });

  // ── Everything below needs a signed-in user ───────────────────────────
  const requireScope = createMiddleware<AppEnv>(async (c, next) => {
    const scope = await deps.resolveScope(c);
    if (!scope) return apiError(c, "unauthorized", "sign in with Google");
    c.set("scope", scope);
    return next();
  });
  app.use("/account", requireScope);
  app.use("/devices/*", requireScope);
  app.use("/devices", requireScope);
  app.use("/sync/*", requireScope);
  app.use("/packs/*", requireScope);
  app.use("/usage", requireScope);

  // ── Account ────────────────────────────────────────────────────────────
  app.get("/account", async (c) => {
    const scope = c.get("scope");
    let vault = await vaultOf(c.env, scope.userId);
    if (!vault) {
      await provisionVault(c.env, scope.userId, scope.vaultId);
      vault = { id: scope.vaultId, name: "My discs" };
    }
    const { stub, vaultId } = vaultStub(c);
    const summary = await stub.summary(vaultId);
    return c.json({
      user: { id: scope.userId, name: scope.name, email: scope.email, image: scope.image },
      vault: { id: vault.id, name: vault.name, ...summary },
      operator: await isOperator(c.env, scope.userId),
    });
  });

  app.delete("/account", async (c) => {
    const body = await readJson(c, DeleteAccountRequest);
    if (!body.ok) return body.response;
    const scope = c.get("scope");
    if (body.data.confirmEmail.toLowerCase() !== scope.email.toLowerCase()) {
      return apiError(c, "bad_request", "confirmation email does not match");
    }
    const { stub, vaultId } = vaultStub(c);
    const packs = await stub.wipe(vaultId);
    await deleteAccountRows(c.env, scope.userId, vaultId);
    return c.json({ deleted: true, packsQueuedForDeletion: packs });
  });

  // ── Devices ────────────────────────────────────────────────────────────
  app.get("/devices", async (c) => {
    const scope = c.get("scope");
    const devices = await listDevices(c.env, scope.userId);
    return c.json({
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        lastSeenAt: d.last_seen_at,
        revokedAt: d.revoked_at,
        current: d.session_id !== null && d.session_id === scope.sessionId,
      })),
    });
  });

  app.post("/devices", async (c) => {
    const body = await readJson(c, RegisterDeviceRequest);
    if (!body.ok) return body.response;
    const scope = c.get("scope");
    const ok = await registerDevice(c.env, { ...body.data, userId: scope.userId, vaultId: scope.vaultId, sessionId: scope.sessionId });
    return ok ? c.json({ registered: true }) : apiError(c, "not_found", "not found");
  });

  app.delete("/devices/:id", async (c) => {
    const ok = await revokeDevice(c.env, c.get("scope").userId, c.req.param("id"));
    return ok ? c.json({ revoked: true }) : apiError(c, "not_found", "not found");
  });

  // ── Sync ───────────────────────────────────────────────────────────────
  app.get("/sync/head", async (c) => {
    const { stub, vaultId } = vaultStub(c);
    return c.json({ seq: await stub.head(vaultId), protocol: PROTOCOL_VERSION });
  });

  app.get("/sync/manifest", async (c) => {
    const { stub, vaultId } = vaultStub(c);
    return c.json(await stub.manifest(vaultId));
  });

  app.get("/sync/changes", async (c) => {
    const since = Number(c.req.query("since") ?? 0);
    const limit = Number(c.req.query("limit") ?? LIMITS.changesPageSize);
    if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(limit) || limit < 1) {
      return apiError(c, "bad_request", "since and limit must be non-negative integers");
    }
    const { stub, vaultId } = vaultStub(c);
    return c.json(await stub.changes(vaultId, since, limit));
  });

  app.post("/sync/push", async (c) => {
    const body = await readJson(c, PushRequest);
    if (!body.ok) return body.response;
    const { stub, vaultId } = vaultStub(c);
    const outcome = await stub.push(vaultId, { userId: c.get("scope").userId, ...body.data });
    return c.json(outcome);
  });

  // ── Packs ──────────────────────────────────────────────────────────────
  app.post("/packs/reserve", async (c) => {
    const body = await readJson(c, ReserveRequest);
    if (!body.ok) return body.response;
    const { stub, vaultId } = vaultStub(c);
    return c.json({ results: await stub.reservePacks(vaultId, body.data.packs) });
  });

  app.put("/packs/:disc/:hash/:part", async (c) => {
    const { disc, hash, part } = c.req.param();
    if (!DISC_RE.test(disc) || !isSha256Hex(hash) || !PART_RE.test(part)) return apiError(c, "bad_request", "invalid pack path");
    const length = Number(c.req.header("Content-Length") ?? 0);
    if (length > LIMITS.packPartMaxBytes) return apiError(c, "bad_request", "pack part too large");
    const data = await c.req.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > LIMITS.packPartMaxBytes) return apiError(c, "bad_request", "invalid pack part size");
    const { stub, vaultId } = vaultStub(c);
    return vaultResponse(c, await stub.uploadPart(vaultId, Number(disc), hash, Number(part), data));
  });

  app.get("/packs/:disc/:hash/:part", async (c) => {
    const { disc, hash, part } = c.req.param();
    if (!DISC_RE.test(disc) || !isSha256Hex(hash) || !PART_RE.test(part)) return apiError(c, "bad_request", "invalid pack path");
    // The key is built from the session's vault id, so another vault's pack can never be read.
    const key = `v:${c.get("scope").vaultId}:pack:${Number(disc)}:${hash}:${Number(part)}`;
    const body = await c.env.PACKS.get(key, "stream");
    if (!body) return apiError(c, "not_found", "not found");
    return new Response(body, {
      headers: { "Content-Type": "application/gzip", "Cache-Control": "private, max-age=31536000, immutable" },
    });
  });

  app.get("/usage", async (c) => {
    const { stub, vaultId } = vaultStub(c);
    return c.json(await stub.summary(vaultId));
  });

  // ── Operator (session whose Google sub is in OPERATOR_SUBS) ────────────
  const requireOperator = createMiddleware<AppEnv>(async (c, next) => {
    const scope = await deps.resolveScope(c);
    if (!scope || !(await isOperator(c.env, scope.userId))) return apiError(c, "not_found", "not found");
    c.set("scope", scope);
    return next();
  });

  app.get("/ops/usage", requireOperator, async (c) => c.json(await opsUsage(c.env)));

  app.put("/ops/config", requireOperator, async (c) => {
    const body = await readJson(c, OpsConfigRequest);
    if (!body.ok) return body.response;
    if (body.data.signupMode) await setConfig(c.env, "signup_mode", body.data.signupMode);
    if (body.data.maxUsers) await setConfig(c.env, "max_users", String(body.data.maxUsers));
    return c.json(await opsUsage(c.env));
  });

  app.post("/ops/invites", requireOperator, async (c) => {
    const body = await readJson(c, OpsInviteRequest);
    if (!body.ok) return body.response;
    await c.env.DIRECTORY.prepare("INSERT OR IGNORE INTO invite (email, created_at) VALUES (?, ?)")
      .bind(body.data.email.toLowerCase(), new Date().toISOString())
      .run();
    return c.json({ invited: body.data.email.toLowerCase() });
  });

  app.delete("/ops/invites/:email", requireOperator, async (c) => {
    await c.env.DIRECTORY.prepare("DELETE FROM invite WHERE email = ?").bind(c.req.param("email")).run();
    return c.json({ removed: true });
  });

  app.put("/ops/vaults/:id/quotas", requireOperator, async (c) => {
    const body = await readJson(c, Quotas.partial());
    if (!body.ok) return body.response;
    if (!(await vaultExists(c.env, c.req.param("id")))) return apiError(c, "not_found", "not found");
    const ns = c.env.VAULT;
    return c.json({ quotas: await ns.get(ns.idFromName(c.req.param("id"))).setQuotas(c.req.param("id"), body.data) });
  });

  app.notFound((c) => apiError(c, "not_found", "not found"));
  app.onError((error, c) => {
    console.error(error);
    return apiError(c, "internal", "internal error");
  });

  return app;
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}
