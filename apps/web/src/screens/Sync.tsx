import type { VaultQuotas, VaultUsage } from "@discvault/sync-protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../account/session.js";
import { useSession } from "../app/session.js";
import { vaultWorker } from "../db/rpc.js";
import { formatDate, formatSizeKb } from "../ui/format.js";
import { ConfirmDialog, Meter } from "../ui/primitives.js";

interface DeviceInfo {
  id: string;
  name: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  current: boolean;
}

function bytesToMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** §8 screen 8: sync status, pending changes, conflicts, storage, devices, usage, backups. */
export default function Sync() {
  const { online, stats, account, refreshStats, signOut } = useSession();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [exporting, setExporting] = useState(false);

  const storageQuery = useQuery({ queryKey: ["storage-estimate"], queryFn: () => vaultWorker().storageEstimate() });
  const outboxQuery = useQuery({ queryKey: ["outbox"], queryFn: () => vaultWorker().listOutbox() });
  const conflictsQuery = useQuery({ queryKey: ["conflicts"], queryFn: () => vaultWorker().listConflicts() });
  const devicesQuery = useQuery({
    queryKey: ["devices"],
    queryFn: () => apiRequest<{ devices: DeviceInfo[] }>("GET", "/devices").then((r) => r.devices),
  });
  const usageQuery = useQuery({
    queryKey: ["usage"],
    queryFn: () => apiRequest<{ quotas: VaultQuotas; usage: VaultUsage }>("GET", "/usage"),
  });

  const syncNow = async () => {
    setSyncing(true);
    try {
      await vaultWorker().sync();
      setLastSyncAt(new Date().toISOString());
      await refreshStats();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["outbox"] }),
        queryClient.invalidateQueries({ queryKey: ["conflicts"] }),
      ]);
    } finally {
      setSyncing(false);
    }
  };

  const discard = async (id: string) => {
    await vaultWorker().discardOutboxEntry(id);
    await queryClient.invalidateQueries({ queryKey: ["outbox"] });
    await refreshStats();
  };

  const keepTheirs = async (id: string) => {
    await vaultWorker().keepTheirs(id);
    await queryClient.invalidateQueries({ queryKey: ["conflicts"] });
  };

  const dismissConflict = async (id: string) => {
    await vaultWorker().dismissConflict(id);
    await queryClient.invalidateQueries({ queryKey: ["conflicts"] });
  };

  const revokeDevice = async (id: string) => {
    await apiRequest("DELETE", `/devices/${id}`);
    await queryClient.invalidateQueries({ queryKey: ["devices"] });
  };

  const exportBackup = async () => {
    setExporting(true);
    try {
      const { zip } = await vaultWorker().exportArchive();
      const blob = new Blob([new Uint8Array(zip)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `discvault-backup-${new Date().toISOString().slice(0, 10)}.dvault`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const doWipe = async () => {
    if (!account) return;
    await signOut();
    setConfirmWipe(false);
  };

  const quota = storageQuery.data;
  const usagePct = quota && quota.quota > 0 ? Math.min(100, (quota.usage / quota.quota) * 100) : 0;

  return (
    <div style={{ padding: "22px 24px 48px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <span style={{ font: "700 20px/1.2 'Instrument Sans', system-ui, sans-serif", letterSpacing: "-.02em" }}>Sync & storage</span>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          padding: "16px 18px",
          border: "1px solid var(--dv-border)",
          borderRadius: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span
            style={{ font: "500 13px/1 'Instrument Sans', system-ui, sans-serif", color: online ? "var(--dv-ok)" : "var(--dv-text-3)" }}
          >
            {online ? "Online" : "Offline"}
          </span>
          {lastSyncAt && (
            <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text-3)" }}>
              Last sync {formatDate(lastSyncAt)}
            </span>
          )}
          <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text-3)" }}>
            {stats?.pendingChanges ?? 0} pending change{stats?.pendingChanges === 1 ? "" : "s"}
          </span>
        </div>
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing || !online}
          style={{
            minHeight: 34,
            padding: "0 14px",
            border: 0,
            borderRadius: 8,
            background: "var(--dv-accent)",
            color: "#fff",
            font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
            cursor: syncing || !online ? "default" : "pointer",
            opacity: syncing || !online ? 0.6 : 1,
          }}
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <div style={{ border: "1px solid var(--dv-border)", borderRadius: 12, overflow: "hidden" }}>
          <div
            style={{
              padding: "12px 15px",
              borderBottom: "1px solid var(--dv-border)",
              font: "600 13px/1 'Instrument Sans', system-ui, sans-serif",
            }}
          >
            Pending changes
          </div>
          {(outboxQuery.data ?? []).length === 0 && (
            <div style={{ padding: "14px 15px", font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
              Nothing pending.
            </div>
          )}
          {(outboxQuery.data ?? []).map((p) => (
            <div
              key={p.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderBottom: "1px solid var(--dv-border)" }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    font: "400 12px/1.3 'Instrument Sans', system-ui, sans-serif",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.op} {p.table_name} {p.row_id}
                </span>
                <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
                  {formatDate(p.created_at)} · {p.attempts} retries
                </span>
              </div>
              <button type="button" onClick={syncNow} style={smallBtn}>
                Retry
              </button>
              <button type="button" onClick={() => discard(p.id)} style={smallBtn}>
                Discard
              </button>
            </div>
          ))}
          {(conflictsQuery.data?.length ?? 0) > 0 && (
            <div
              style={{ padding: "10px 15px", borderTop: "1px solid var(--dv-border)", display: "flex", flexDirection: "column", gap: 8 }}
            >
              {conflictsQuery.data?.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-warn)" }}>
                    ⚠ {c.table_name} {c.row_id} — {c.reason}
                  </span>
                  <button type="button" onClick={() => keepTheirs(c.id)} style={smallBtn}>
                    Keep theirs
                  </button>
                  <button type="button" onClick={() => dismissConflict(c.id)} style={smallBtn}>
                    Keep mine
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div
          style={{
            padding: "16px 18px",
            border: "1px solid var(--dv-border)",
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Devices signed in</span>
          {(devicesQuery.data ?? [])
            .filter((d) => !d.revokedAt)
            .map((d) => (
              <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ font: "500 13px/1.3 'Instrument Sans', system-ui, sans-serif" }}>
                    {d.name}
                    {d.current ? " (this device)" : ""}
                  </span>
                  <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
                    Last seen {d.lastSeenAt ? formatDate(d.lastSeenAt) : "never"}
                  </span>
                </div>
                {!d.current && (
                  <button type="button" onClick={() => revokeDevice(d.id)} style={smallBtn}>
                    Revoke
                  </button>
                )}
              </div>
            ))}
        </div>
      </div>

      {usageQuery.data && (
        <div
          style={{
            padding: "16px 18px",
            border: "1px solid var(--dv-border)",
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Usage vs. this catalog's quotas</span>
          {[
            { label: "Discs", value: usageQuery.data.usage.discs, max: usageQuery.data.quotas.maxDiscs },
            { label: "Pack uploads today", value: usageQuery.data.usage.packUploads, max: usageQuery.data.quotas.maxPackUploadsPerDay },
            { label: "Meta writes today", value: usageQuery.data.usage.metaWrites, max: usageQuery.data.quotas.maxMetaWritesPerDay },
          ].map((m) => (
            <div key={m.label} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", font: "400 12px/1 'Instrument Sans', system-ui, sans-serif" }}
              >
                <span style={{ color: "var(--dv-text-2)" }}>{m.label}</span>
                <span className="dv-mono" style={{ color: "var(--dv-text-3)" }}>
                  {m.value} / {m.max}
                </span>
              </div>
              <Meter pct={m.max > 0 ? (m.value / m.max) * 100 : 0} />
            </div>
          ))}
          <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
            Pack bytes uploaded today: {formatSizeKb(usageQuery.data.usage.packBytes / 1024)}
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <div
          style={{
            padding: "16px 18px",
            border: "1px solid var(--dv-border)",
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Storage</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", font: "400 12px/1 'JetBrains Mono', monospace" }}>
              <span style={{ color: "var(--dv-text-2)" }}>Local database</span>
              <span>{quota ? bytesToMb(quota.usage) : "—"}</span>
            </div>
            <Meter pct={usagePct} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ font: "400 12px/1.3 'Instrument Sans', system-ui, sans-serif" }}>Persistent storage</span>
            <span className="dv-mono" style={{ fontSize: 11, color: quota?.persisted ? "var(--dv-ok)" : "var(--dv-text-3)" }}>
              {quota ? (quota.persisted ? "Granted" : "Not granted") : "…"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setConfirmWipe(true)}
            style={{
              alignSelf: "flex-start",
              minHeight: 32,
              padding: "0 12px",
              border: "1px solid var(--dv-err)",
              borderRadius: 8,
              background: "transparent",
              color: "var(--dv-err)",
              font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            Sign out & wipe this device
          </button>
        </div>
        <div
          style={{
            padding: "16px 18px",
            border: "1px solid var(--dv-border)",
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Backups</span>
          <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text-3)" }}>
            Export this device's full catalog as a portable archive.
          </span>
          <button
            type="button"
            onClick={exportBackup}
            disabled={exporting}
            style={{
              alignSelf: "flex-start",
              minHeight: 32,
              padding: "0 13px",
              border: "1px solid var(--dv-border-2)",
              borderRadius: 8,
              background: "var(--dv-bg-sub)",
              font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            {exporting ? "Building…" : "Export full backup (.dvault)"}
          </button>
        </div>
      </div>

      {confirmWipe && (
        <ConfirmDialog
          title="Sign out & wipe this device?"
          description="Deletes this device's local copy of your catalog. Your account and catalog stay safe on the server."
          matchText={account?.user.email ?? ""}
          matchLabel={account?.user.email ?? ""}
          confirmLabel="Sign out & wipe"
          onConfirm={doWipe}
          onCancel={() => setConfirmWipe(false)}
        />
      )}
    </div>
  );
}

const smallBtn = {
  minHeight: 26,
  padding: "0 9px",
  border: "1px solid var(--dv-border-2)",
  borderRadius: 6,
  background: "var(--dv-bg-sub)",
  font: "500 11px/1 'Instrument Sans', system-ui, sans-serif",
  cursor: "pointer",
} as const;
