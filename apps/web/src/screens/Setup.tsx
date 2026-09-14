import { useNavigate } from "@tanstack/react-router";
import { type ChangeEvent, useRef, useState } from "react";
import { useSession } from "../app/session.js";
import { vaultWorker } from "../db/rpc.js";
import { formatSizeKb } from "../ui/format.js";
import { Meter } from "../ui/primitives.js";

type ImportStage = "idle" | "reading" | "importing" | "done" | "error";

/** §8 screen 2: new account picks a starting point; an existing account on a new device downloads its catalog. */
export default function Setup() {
  const { stats, refreshStats, syncing, syncNow } = useSession();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importStage, setImportStage] = useState<ImportStage>("idle");
  const [importError, setImportError] = useState<string | null>(null);

  const isNewAccount = (stats?.discs ?? 0) === 0;

  const onPickArchive = () => fileInput.current?.click();

  const onArchiveChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportStage("reading");
    setImportError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const preview = await vaultWorker().previewArchive(bytes);
      setImportStage("importing");
      const resolutions = Object.fromEntries(preview.collisions.map((n) => [n, "skip" as const]));
      await vaultWorker().importArchive(bytes, resolutions);
      await refreshStats();
      setImportStage("done");
      navigate({ to: "/discs" });
    } catch (err) {
      setImportStage("error");
      setImportError(err instanceof Error ? err.message : "Could not read that archive");
    }
  };

  const onSync = async () => {
    await syncNow(true);
    navigate({ to: "/" });
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--dv-bg)", display: "flex", justifyContent: "center", padding: "54px 32px 72px" }}>
      <div style={{ width: "100%", maxWidth: 680, display: "flex", flexDirection: "column", gap: 26 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span
            style={{
              font: "500 11px/1 'JetBrains Mono', monospace",
              letterSpacing: ".1em",
              color: "var(--dv-text-3)",
              textTransform: "uppercase",
            }}
          >
            {isNewAccount ? "Welcome" : "New device"}
          </span>
          <span style={{ font: "700 30px/1.15 'Instrument Sans', system-ui, sans-serif", letterSpacing: "-.025em" }}>
            {isNewAccount ? "Set up your catalog" : "Bring this device up to date"}
          </span>
          <span style={{ font: "400 15px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
            {isNewAccount
              ? "Start with an empty catalog, or bring one over from another device."
              : "Your account already has a catalog. Download it here to search offline on this device too."}
          </span>
        </div>

        {isNewAccount ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <button
              type="button"
              onClick={() => navigate({ to: "/scan" })}
              style={{
                textAlign: "left",
                padding: 22,
                border: "1px solid var(--dv-border)",
                borderRadius: 14,
                background: "var(--dv-bg-sub)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 9,
                minHeight: 170,
              }}
            >
              <span style={{ font: "400 22px/1 'JetBrains Mono', monospace", color: "var(--dv-accent)" }}>＋</span>
              <span style={{ font: "600 17px/1.2 'Instrument Sans', system-ui, sans-serif" }}>Start empty (scan your first disc)</span>
              <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
                Give the disc a number, say where it lives, then drop in its file listing.
              </span>
            </button>
            <button
              type="button"
              onClick={onPickArchive}
              disabled={importStage === "reading" || importStage === "importing"}
              style={{
                textAlign: "left",
                padding: 22,
                border: "1px solid var(--dv-border)",
                borderRadius: 14,
                background: "var(--dv-bg-sub)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 9,
                minHeight: 170,
              }}
            >
              <span style={{ font: "400 22px/1 'JetBrains Mono', monospace", color: "var(--dv-accent)" }}>⤓</span>
              <span style={{ font: "600 17px/1.2 'Instrument Sans', system-ui, sans-serif" }}>
                {importStage === "reading"
                  ? "Reading archive…"
                  : importStage === "importing"
                    ? "Importing…"
                    : "Import archive (.dvault file)"}
              </span>
              <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
                Bring over a catalog exported from another device or an older tool.
              </span>
            </button>
            <input ref={fileInput} type="file" accept=".dvault" onChange={onArchiveChosen} style={{ display: "none" }} />
            {importError && (
              <span style={{ gridColumn: "1 / -1", font: "500 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-err)" }}>
                {importError}
              </span>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 11,
                padding: 20,
                border: "1px solid var(--dv-border)",
                borderRadius: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <span style={{ font: "600 16px/1.2 'Instrument Sans', system-ui, sans-serif" }}>
                  {syncing ? "Downloading your catalog…" : `${stats?.discs ?? 0} discs on this device`}
                </span>
                <span className="dv-mono" style={{ fontSize: 13, color: "var(--dv-text-2)" }}>
                  {stats ? formatSizeKb(stats.totalKb) : "—"}
                </span>
              </div>
              <Meter pct={syncing ? 60 : 100} height={7} />
              <span style={{ font: "400 12px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
                You can start searching as soon as the first sync finishes. The rest keeps syncing in the background.
              </span>
            </div>
            <div
              style={{
                padding: 20,
                border: "1px dashed var(--dv-border-2)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <span style={{ font: "600 15px/1.2 'Instrument Sans', system-ui, sans-serif" }}>Install the app</span>
              <span style={{ font: "400 13px/1.55 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
                Installed, DiscVault opens full screen and works with no internet at all.
              </span>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: 9, background: "var(--dv-bg-sub)" }}
              >
                <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text-2)" }}>
                  iOS · Safari
                </span>
                <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text)" }}>
                  Share → Add to Home Screen
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onSync}
              disabled={syncing}
              style={{
                alignSelf: "flex-start",
                minHeight: 42,
                padding: "0 20px",
                border: 0,
                borderRadius: 9,
                background: "var(--dv-accent)",
                color: "#fff",
                font: "600 14px/1 'Instrument Sans', system-ui, sans-serif",
                cursor: syncing ? "default" : "pointer",
                opacity: syncing ? 0.7 : 1,
              }}
            >
              {syncing ? "Syncing…" : "Continue to DiscVault"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
