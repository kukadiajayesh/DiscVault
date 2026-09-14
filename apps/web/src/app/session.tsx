import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type AccountResponse, bootstrapAccount, signOutAndWipe } from "../account/session.js";
import { vaultWorker } from "../db/rpc.js";
import type { CatalogStats } from "../db/search.js";

type SessionStatus = "loading" | "signed-in" | "signed-out" | "error" | "open-elsewhere";

interface SessionContextValue {
  status: SessionStatus;
  account: AccountResponse | null;
  stats: CatalogStats | null;
  error: string | null;
  online: boolean;
  refreshStats: () => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [attempt, setAttempt] = useState(0);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await vaultWorker().stats());
    } catch {
      // Vault not open yet (e.g. before bootstrap finishes) — the next successful bootstrap refreshes it.
    }
  }, []);

  // `attempt` is a deliberate re-run trigger for retry() and isn't read in the body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally forces a re-run
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    bootstrapAccount()
      .then(async (acc) => {
        if (cancelled) return;
        setAccount(acc);
        setStatus("signed-in");
        await refreshStats();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        // A 401/network failure while signed out is expected, not an app error.
        if (/401|Failed to fetch/.test(message)) {
          setStatus("signed-out");
        } else if (message.includes("vault-open-elsewhere")) {
          setStatus("open-elsewhere");
        } else {
          setStatus("error");
        }
        setError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, refreshStats]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const signOut = useCallback(async () => {
    if (!account) return;
    await signOutAndWipe(account.user.id, account.vault.id);
    setAccount(null);
    setStats(null);
    setStatus("signed-out");
  }, [account]);

  const value = useMemo<SessionContextValue>(
    () => ({ status, account, stats, error, online, refreshStats, signOut, retry: () => setAttempt((n) => n + 1) }),
    [status, account, stats, error, online, refreshStats, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
