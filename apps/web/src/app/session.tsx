import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type AccountResponse, bootstrapAccount, signOutAndWipe } from "../account/session.js";
import { vaultWorker } from "../db/rpc.js";
import type { CatalogStats } from "../db/search.js";
import type { SyncReport, SyncStatus } from "../sync/engine.js";

/** §6.3: re-check every 15 minutes while the app is visible; nothing runs in the background. */
const SYNC_INTERVAL_MS = 15 * 60_000;
/** Local edits are pushed shortly after they're made, batched if several come in quick succession. */
const LOCAL_WRITE_SYNC_DELAY_MS = 5_000;

type SessionStatus = "loading" | "signed-in" | "signed-out" | "error";

interface SessionContextValue {
  status: SessionStatus;
  account: AccountResponse | null;
  stats: CatalogStats | null;
  error: string | null;
  online: boolean;
  /** Outcome of the last sync attempt; `null` until the first one after sign-in finishes. */
  syncStatus: SyncStatus | null;
  syncing: boolean;
  /** `force` runs a full sync; otherwise it's skipped when nothing changed on either side. */
  syncNow: (force?: boolean) => Promise<SyncReport | null>;
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const queryClient = useQueryClient();

  const refreshStats = useCallback(async () => {
    try {
      setStats(await vaultWorker().stats());
    } catch {
      // Vault not open yet (e.g. before bootstrap finishes) — the next successful bootstrap refreshes it.
    }
  }, []);

  const syncRef = useRef<Promise<SyncReport | null> | null>(null);
  const syncNow = useCallback(
    (force = false): Promise<SyncReport | null> => {
      // Coalesce triggers that fire together (focus + online + visibility) into one call.
      if (syncRef.current) return syncRef.current;
      const run = (async () => {
        setSyncing(true);
        try {
          const report = await (force ? vaultWorker().sync() : vaultWorker().syncIfNeeded());
          setSyncStatus(report.status);
          if (force || report.pulled > 0 || report.pushed > 0 || report.packsDownloaded > 0 || report.conflicts > 0) {
            await refreshStats();
            await queryClient.invalidateQueries();
          }
          return report;
        } catch (err) {
          // Worker/leader-channel failure (not an HTTP error — the engine reports those as a status).
          setSyncStatus({ state: "error", message: err instanceof Error ? err.message : String(err) });
          return null;
        } finally {
          setSyncing(false);
          syncRef.current = null;
        }
      })();
      syncRef.current = run;
      return run;
    },
    [queryClient, refreshStats],
  );

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

  // Automatic sync (§6.3): on sign-in/app open, when the network returns, when the tab regains
  // focus or becomes visible, and every 15 minutes while visible. Each is a 1-row head check
  // unless something actually changed, so a new device (e.g. a second browser) pulls the catalog
  // without anyone pressing "Sync now".
  useEffect(() => {
    if (status !== "signed-in") return;
    const trigger = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void syncNow();
    };
    trigger();
    const interval = setInterval(trigger, SYNC_INTERVAL_MS);
    window.addEventListener("online", trigger);
    window.addEventListener("focus", trigger);
    document.addEventListener("visibilitychange", trigger);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", trigger);
      window.removeEventListener("focus", trigger);
      document.removeEventListener("visibilitychange", trigger);
    };
  }, [status, syncNow]);

  // Push local writes soon after they happen (screens call refreshStats() after writing).
  const pendingChanges = stats?.pendingChanges ?? 0;
  useEffect(() => {
    if (status !== "signed-in" || pendingChanges === 0 || !online) return;
    const timer = setTimeout(() => void syncNow(), LOCAL_WRITE_SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, pendingChanges, online, syncNow]);

  const signOut = useCallback(async () => {
    if (!account) return;
    await signOutAndWipe(account.user.id, account.vault.id);
    setAccount(null);
    setStats(null);
    setSyncStatus(null);
    setStatus("signed-out");
  }, [account]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      account,
      stats,
      error,
      online,
      syncStatus,
      syncing,
      syncNow,
      refreshStats,
      signOut,
      retry: () => setAttempt((n) => n + 1),
    }),
    [status, account, stats, error, online, syncStatus, syncing, syncNow, refreshStats, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
