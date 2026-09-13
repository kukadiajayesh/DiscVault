const STORAGE_KEY = "discvault:accounts";

export interface LocalAccount {
  userId: string;
  vaultId: string;
  email: string;
  name: string | null;
  image: string | null;
  lastUsedAt: string;
}

/**
 * Which accounts have been opened on this device (§3.4), so the app can open offline straight to
 * an account picker instead of forcing a sign-in round trip. Convenience only, never the source of
 * truth: `GET /api/account` after sign-in is what confirms a vault id.
 */
function readAll(): LocalAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalAccount[]) : [];
  } catch {
    return [];
  }
}

function writeAll(accounts: LocalAccount[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    // Private browsing or storage disabled: the picker just stays empty.
  }
}

export function listLocalAccounts(): LocalAccount[] {
  return readAll().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

export function rememberAccount(account: Omit<LocalAccount, "lastUsedAt">): void {
  const accounts = readAll().filter((a) => a.userId !== account.userId);
  accounts.push({ ...account, lastUsedAt: new Date().toISOString() });
  writeAll(accounts);
}

export function forgetAccount(userId: string): void {
  writeAll(readAll().filter((a) => a.userId !== userId));
}
