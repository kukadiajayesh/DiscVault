import { createApp } from "./app.js";
import { createAuth } from "./auth/better-auth.js";
import { provisionVault, purgeDueKeys, vaultOf } from "./directory/directory.js";
import type { Env } from "./env.js";

export { VaultDO } from "./vault/vault-do.js";

const app = createApp({
  authHandler: (request, env) => createAuth(env).handler(request),
  async resolveScope(c) {
    const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
    if (!session) return null;
    const user = session.user as typeof session.user & { vaultId?: string | null };
    let vaultId = user.vaultId ?? null;
    if (!vaultId) {
      // Only if provisioning after sign-up failed: recover the vault from the directory.
      vaultId = (await vaultOf(c.env, user.id))?.id ?? crypto.randomUUID();
      await provisionVault(c.env, user.id, vaultId);
    }
    return {
      userId: user.id,
      vaultId,
      email: user.email,
      name: user.name,
      image: user.image ?? null,
      sessionId: session.session.id,
    };
  },
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(purgeDueKeys(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
