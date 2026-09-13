import type { VaultDO } from "./vault/vault-do.js";

export interface Env {
  DIRECTORY: D1Database;
  VAULT: DurableObjectNamespace<VaultDO>;
  PACKS: KVNamespace;
  ASSETS: Fetcher;
  PUBLIC_ORIGIN: string;
  DEFAULT_SIGNUP_MODE: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  OPS_TOKEN: string;
  /** Comma-separated Google `sub`s allowed to use /api/ops. */
  OPERATOR_SUBS: string;
}

/** The signed-in user and the only vault their requests can reach. Always from the session. */
export interface Scope {
  userId: string;
  vaultId: string;
  email: string;
  name: string;
  image: string | null;
  sessionId: string | null;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { scope: Scope };
}
