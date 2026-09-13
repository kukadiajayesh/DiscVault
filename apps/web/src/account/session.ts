import { API_PREFIX, PROTOCOL_HEADER, PROTOCOL_VERSION } from "@discvault/sync-protocol";
import { vaultWorker } from "../db/rpc.js";
import { signOut as authSignOut } from "./auth-client.js";
import { forgetAccount, rememberAccount } from "./local-accounts.js";

export interface AccountResponse {
  user: { id: string; name: string | null; email: string; image: string | null };
  vault: { id: string; name: string };
  operator: boolean;
}

async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

/**
 * Runs once the session cookie is set, whether that's right after the Google redirect or on a
 * normal app start while already signed in (§3.3, §3.4): confirms the account and vault with the
 * server, opens that vault's local DB, and registers this device.
 */
export async function bootstrapAccount(): Promise<AccountResponse> {
  const account = await apiRequest<AccountResponse>("GET", "/account");
  await vaultWorker().open(account.vault.id);

  const deviceId = await vaultWorker().deviceId();
  const deviceName = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 100) : "DiscVault device";
  await apiRequest("POST", "/devices", { id: deviceId, name: deviceName });

  rememberAccount({
    userId: account.user.id,
    vaultId: account.vault.id,
    email: account.user.email,
    name: account.user.name,
    image: account.user.image,
  });
  return account;
}

/** Signs out of Google and deletes this device's copy of that vault only (§3.4). */
export async function signOutAndWipe(userId: string, vaultId: string): Promise<void> {
  await authSignOut();
  await vaultWorker().wipe(vaultId);
  forgetAccount(userId);
}
