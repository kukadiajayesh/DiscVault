import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../app/session.js";
import { vaultWorker } from "../db/rpc.js";
import { pickDirectory, type ScanResult, scanDirectory, supportsDirectoryPicker } from "../scan/scan-folder.js";
import { formatCount, formatSizeKb } from "../ui/format.js";

type Mode = "new" | "rescan";
type Step = 1 | 2 | 3 | 4;

const MEDIA_TYPES = ["DVD-5", "DVD-9", "CD-R", "Blu-ray"];
const STEP_LABELS = ["Disc info", "Pick folder", "Preview", "Save"];

/** §8 screen 7: add / re-scan disc wizard, trimmed to what the local scan engine actually does. */
export default function Scan() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refreshStats } = useSession();
  const presetDisc = useRouterState({ select: (s) => (s.location.search as Record<string, unknown>).disc });

  const discsQuery = useQuery({ queryKey: ["discs-recent"], queryFn: () => vaultWorker().listDiscs() });
  const missingQuery = useQuery({ queryKey: ["missing-discs"], queryFn: () => vaultWorker().missingDiscNumbers() });

  const [mode, setMode] = useState<Mode>(typeof presetDisc === "number" || typeof presetDisc === "string" ? "rescan" : "new");
  const [step, setStep] = useState<Step>(1);
  const [discNoInput, setDiscNoInput] = useState(presetDisc != null ? String(presetDisc) : "");
  const [title, setTitle] = useState("");
  const [mediaType, setMediaType] = useState(MEDIA_TYPES[0]!);
  const [locationSlot, setLocationSlot] = useState("");

  const [dirName, setDirName] = useState<string | null>(null);
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ folder_count: number; file_count: number; total_kb: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const discNo = Number(discNoInput);
  const validDiscNo = Number.isInteger(discNo) && discNo >= 1;

  const existing = useMemo(() => (discsQuery.data ?? []).find((d) => d.disc_no === discNo), [discsQuery.data, discNo]);
  const discQuery = useQuery({
    queryKey: ["disc", discNo],
    queryFn: () => vaultWorker().getDisc(discNo),
    enabled: mode === "rescan" && validDiscNo,
  });

  useEffect(() => {
    if (mode !== "rescan") return;
    const d = discQuery.data ?? existing;
    if (d) {
      setTitle(d.title ?? "");
      setMediaType(d.media_type ?? MEDIA_TYPES[0]!);
      setLocationSlot(d.location_slot ?? "");
    }
  }, [mode, discQuery.data, existing]);

  const nextFree = useMemo(() => {
    const used = new Set((discsQuery.data ?? []).map((d) => d.disc_no));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }, [discsQuery.data]);

  useEffect(() => {
    if (mode === "new" && !discNoInput) setDiscNoInput(String(nextFree));
  }, [nextFree, mode, discNoInput]);

  const capKb = /9$/.test(mediaType) || /Blu-ray/.test(mediaType) ? 8_500_000 : 4_700_000;

  const choose = async () => {
    setScanError(null);
    const handle = await pickDirectory();
    if (!handle) return;
    setDirHandle(handle);
    setDirName(handle.name);
  };

  const runScan = async () => {
    if (!dirHandle) return;
    setScanning(true);
    setScanCount(0);
    setScanError(null);
    try {
      const result = await scanDirectory(dirHandle, setScanCount);
      setScanResult(result);
      setStep(3);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Could not read that folder");
    } finally {
      setScanning(false);
    }
  };

  const save = async () => {
    if (!scanResult || !validDiscNo) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await vaultWorker().commitScannedPack(
        discNo,
        { title: title || null, media_type: mediaType, location_slot: locationSlot || null, status: "available" },
        scanResult.folders,
        scanResult.files,
      );
      setSaved(result);
      await refreshStats();
      await queryClient.invalidateQueries({ queryKey: ["discs-recent"] });
      await queryClient.invalidateQueries({ queryKey: ["missing-discs"] });
      setStep(4);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save this scan");
    } finally {
      setSaving(false);
    }
  };

  const bigFiles = (scanResult?.files ?? []).filter((f) => (f.size_kb ?? 0) > 4 * 1024 * 1024);

  return (
    <div style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 22, padding: "26px 24px 40px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span
            style={{
              font: "500 11px/1 'JetBrains Mono', monospace",
              letterSpacing: ".1em",
              color: "var(--dv-text-3)",
              textTransform: "uppercase",
            }}
          >
            {mode === "new" ? "Add disc" : `Re-scan disc #${discNo || "?"}`} · step {step} of 4
          </span>
          <span style={{ font: "700 26px/1.15 'Instrument Sans', system-ui, sans-serif", letterSpacing: "-.02em" }}>
            {mode === "new" ? "Add a new disc to the catalog" : title || "Re-scan this disc"}
          </span>
          <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
            <button type="button" onClick={() => setMode("new")} style={modeBtnStyle(mode === "new")}>
              New disc
            </button>
            <button type="button" onClick={() => setMode("rescan")} style={modeBtnStyle(mode === "rescan")}>
              Re-scan existing
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: "/discs" })}
          style={{
            flex: "none",
            minHeight: 32,
            padding: "0 12px",
            border: "1px solid var(--dv-border-2)",
            borderRadius: 8,
            background: "var(--dv-bg-sub)",
            font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: "14px 16px",
          border: "1px solid var(--dv-border)",
          borderRadius: 12,
          background: "var(--dv-bg-sub)",
        }}
      >
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as Step;
          const state = n < step ? "done" : n === step ? "active" : "todo";
          return (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  flex: "none",
                  borderRadius: "50%",
                  border: `1.5px solid ${state === "todo" ? "var(--dv-border-2)" : "var(--dv-accent)"}`,
                  background: state === "done" ? "var(--dv-accent)" : "transparent",
                  color: state === "done" ? "#fff" : state === "active" ? "var(--dv-accent)" : "var(--dv-text-3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  font: "500 11px/1 'JetBrains Mono', monospace",
                }}
              >
                {state === "done" ? "✓" : n}
              </span>
              <span
                style={{
                  font: "500 13px/1.2 'Instrument Sans', system-ui, sans-serif",
                  color: state === "todo" ? "var(--dv-text-3)" : "var(--dv-text)",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <span className="dv-mono" style={{ fontSize: 13, color: "var(--dv-text-3)", margin: "0 2px" }}>
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 16, padding: 22, border: "1px solid var(--dv-border)", borderRadius: 12 }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={fieldLabel}>Disc number</span>
              <input
                value={discNoInput}
                onChange={(e) => setDiscNoInput(e.target.value)}
                disabled={mode === "rescan" && typeof presetDisc !== "undefined"}
                placeholder={String(nextFree)}
                style={fieldInput}
              />
              {mode === "new" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: "var(--dv-accent-soft)",
                      color: "var(--dv-accent)",
                      font: "500 11px/1.4 'JetBrains Mono', monospace",
                    }}
                  >
                    Next free: {nextFree}
                  </span>
                  {(missingQuery.data?.length ?? 0) > 0 && (
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 6,
                        background: "var(--dv-warn-soft)",
                        color: "var(--dv-warn)",
                        font: "500 11px/1.4 'JetBrains Mono', monospace",
                      }}
                    >
                      Fill a gap: {missingQuery.data?.[0]}
                    </span>
                  )}
                </div>
              )}
              {mode === "rescan" && validDiscNo && !existing && !discQuery.isLoading && (
                <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-warn)" }}>
                  No disc #{discNo} yet — this will create it.
                </span>
              )}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={fieldLabel}>Media type</span>
              <select value={mediaType} onChange={(e) => setMediaType(e.target.value)} style={fieldInput}>
                {MEDIA_TYPES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={fieldLabel}>Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Movies — Van Helsing & Constantine"
                style={fieldInput}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={fieldLabel}>Location</span>
              <input
                value={locationSlot}
                onChange={(e) => setLocationSlot(e.target.value)}
                placeholder="Living room · Shelf A · Wallet 1, page 5"
                style={fieldInput}
              />
            </label>
          </div>
        </div>
      )}

      {step === 2 && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 14, padding: 22, border: "1px solid var(--dv-border)", borderRadius: 12 }}
        >
          {supportsDirectoryPicker() ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                onClick={choose}
                style={{
                  alignSelf: "flex-start",
                  minHeight: 40,
                  padding: "0 16px",
                  border: 0,
                  borderRadius: 9,
                  background: "var(--dv-accent)",
                  color: "#fff",
                  font: "600 14px/1 'Instrument Sans', system-ui, sans-serif",
                  cursor: "pointer",
                }}
              >
                {dirName ? `Chosen: ${dirName}` : "Choose disc drive"}
              </button>
              <span style={{ font: "400 12px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
                Reads file names, sizes and dates from the folder you pick. Nothing leaves this device until you sync.
              </span>
            </div>
          ) : (
            <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
              This browser can't read a folder directly. Use Chrome or Edge on this device, or import a{" "}
              <span className="dv-mono">.dvault</span> archive from Settings instead.
            </span>
          )}
          <div style={{ height: 1, background: "var(--dv-border)" }} />
          <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Deep-scan options</span>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, opacity: 0.6 }}>
            <input type="checkbox" disabled style={{ width: 15, height: 15, marginTop: 2 }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ font: "500 13px/1.3 'Instrument Sans', system-ui, sans-serif" }}>Read photo / audio / video details</span>
              <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
                Coming in a later pass (§8.00) — not part of this scan.
              </span>
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, opacity: 0.6 }}>
            <input type="checkbox" disabled style={{ width: 15, height: 15, marginTop: 2 }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ font: "500 13px/1.3 'Instrument Sans', system-ui, sans-serif" }}>Generate thumbnails</span>
              <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
                Coming in a later pass (§8.00) — not part of this scan.
              </span>
            </span>
          </label>
          {scanError && (
            <span style={{ font: "500 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-err)" }}>{scanError}</span>
          )}
          {scanning && (
            <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text-2)" }}>
              Reading… {formatCount(scanCount)} files so far
            </span>
          )}
        </div>
      )}

      {step === 3 && scanResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            {[
              { label: "Folders", value: formatCount(scanResult.folders.length) },
              { label: "Files", value: formatCount(scanResult.files.length) },
              { label: "Size", value: formatSizeKb(scanResult.totalKb) },
            ].map((s) => (
              <div
                key={s.label}
                style={{ padding: "14px 15px", border: "1px solid var(--dv-border)", borderRadius: 11, background: "var(--dv-bg-sub)" }}
              >
                <span
                  style={{
                    display: "block",
                    font: "400 11px/1 'JetBrains Mono', monospace",
                    color: "var(--dv-text-3)",
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                  }}
                >
                  {s.label}
                </span>
                <span className="dv-mono" style={{ fontSize: 22, fontWeight: 700 }}>
                  {s.value}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                font: "400 12px/1 'JetBrains Mono', monospace",
                color: "var(--dv-text-2)",
              }}
            >
              <span>
                {formatSizeKb(scanResult.totalKb)} of {formatSizeKb(capKb)} capacity
              </span>
              <span>{Math.min(100, Math.round((scanResult.totalKb / capKb) * 100))}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: "var(--dv-border)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.min(100, (scanResult.totalKb / capKb) * 100)}%`,
                  height: "100%",
                  background: scanResult.totalKb > capKb ? "var(--dv-err)" : "var(--dv-accent)",
                }}
              />
            </div>
          </div>
          <div style={{ border: "1px solid var(--dv-border)", borderRadius: 11, overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 90px 100px",
                gap: 10,
                padding: "0 14px",
                height: 30,
                alignItems: "center",
                background: "var(--dv-bg-sub)",
                borderBottom: "1px solid var(--dv-border)",
                font: "500 10px/1 'JetBrains Mono', monospace",
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--dv-text-3)",
              }}
            >
              <span>Name</span>
              <span style={{ textAlign: "right" }}>Size</span>
              <span>Date</span>
            </div>
            {scanResult.files.slice(0, 200).map((f) => (
              <div
                key={`${f.folder}:${f.name}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 90px 100px",
                  gap: 10,
                  padding: "0 14px",
                  height: 32,
                  alignItems: "center",
                  borderBottom: "1px solid var(--dv-border)",
                  font: "400 12px/1 'Instrument Sans', system-ui, sans-serif",
                  overflow: "hidden",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <span className="dv-mono" style={{ textAlign: "right" }}>
                  {formatSizeKb(f.size_kb)}
                </span>
                <span className="dv-mono" style={{ color: "var(--dv-text-3)" }}>
                  {f.created?.slice(0, 10) ?? "—"}
                </span>
              </div>
            ))}
          </div>
          {bigFiles.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 13px",
                borderRadius: 9,
                background: "var(--dv-warn-soft)",
                border: "1px solid var(--dv-warn)",
              }}
            >
              <span className="dv-mono" style={{ fontSize: 13, color: "var(--dv-warn)" }}>
                ⚠
              </span>
              <span style={{ font: "500 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-warn)" }}>
                {bigFiles.length} file{bigFiles.length === 1 ? "" : "s"} over 4 GB
              </span>
            </div>
          )}
          {saveError && (
            <span style={{ font: "500 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-err)" }}>{saveError}</span>
          )}
        </div>
      )}

      {step === 4 && saved && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            padding: "40px 20px",
            border: "1px solid var(--dv-border)",
            borderRadius: 12,
            textAlign: "center",
          }}
        >
          <span
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "var(--dv-ok-soft)",
              color: "var(--dv-ok)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: "700 22px/1 'JetBrains Mono', monospace",
            }}
          >
            ✓
          </span>
          <span style={{ font: "700 20px/1.2 'Instrument Sans', system-ui, sans-serif" }}>Saved on this device</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "5px 11px",
              borderRadius: 99,
              background: "var(--dv-warn-soft)",
              color: "var(--dv-warn)",
              font: "500 12px/1 'JetBrains Mono', monospace",
            }}
          >
            ▲ Pending upload
          </span>
          <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)", maxWidth: 420 }}>
            {formatCount(saved.file_count)} files across {formatCount(saved.folder_count)} folders are searchable on this device right now.
            It uploads to your other devices the next time you're online.
          </span>
          <button
            type="button"
            onClick={() => navigate({ to: "/discs/$no", params: { no: String(discNo) } })}
            style={{
              marginTop: 6,
              minHeight: 42,
              padding: "0 20px",
              border: 0,
              borderRadius: 9,
              background: "var(--dv-accent)",
              color: "#fff",
              font: "600 14px/1 'Instrument Sans', system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            Go to disc #{discNo}
          </button>
        </div>
      )}

      {step < 4 && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button
            type="button"
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
            disabled={step === 1}
            style={{
              minHeight: 40,
              padding: "0 18px",
              border: "1px solid var(--dv-border-2)",
              borderRadius: 9,
              background: "var(--dv-bg-sub)",
              font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
              cursor: "pointer",
              opacity: step === 1 ? 0.5 : 1,
            }}
          >
            Back
          </button>
          {step === 1 && (
            <button type="button" onClick={() => setStep(2)} disabled={!validDiscNo} style={nextBtnStyle(validDiscNo)}>
              Next
            </button>
          )}
          {step === 2 && (
            <button type="button" onClick={runScan} disabled={!dirHandle || scanning} style={nextBtnStyle(!!dirHandle && !scanning)}>
              {scanning ? "Reading…" : "Scan folder"}
            </button>
          )}
          {step === 3 && (
            <button type="button" onClick={save} disabled={saving} style={nextBtnStyle(!saving)}>
              {saving ? "Saving…" : "Save to catalog"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const fieldLabel = { font: "500 12px/1 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" } as const;
const fieldInput = {
  height: 38,
  padding: "0 12px",
  border: "1px solid var(--dv-border-2)",
  borderRadius: 8,
  background: "var(--dv-bg)",
  outline: "none",
  font: "400 14px/1 'JetBrains Mono', monospace",
} as const;

function modeBtnStyle(active: boolean) {
  return {
    minHeight: 28,
    padding: "0 11px",
    border: "1px solid var(--dv-border)",
    borderRadius: 7,
    background: active ? "var(--dv-accent-soft)" : "transparent",
    color: active ? "var(--dv-accent)" : "var(--dv-text)",
    font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
    cursor: "pointer",
  } as const;
}

function nextBtnStyle(enabled: boolean) {
  return {
    minHeight: 40,
    padding: "0 20px",
    border: 0,
    borderRadius: 9,
    background: "var(--dv-accent)",
    color: "#fff",
    font: "600 14px/1 'Instrument Sans', system-ui, sans-serif",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.5,
  } as const;
}
